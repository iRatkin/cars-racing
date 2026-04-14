import type { ClientSession, MongoClient } from "mongodb";
import { randomUUID } from "node:crypto";

import type {
  EnterSeasonAtomicResult,
  FinishSeasonRaceAtomicResult
} from "../../modules/seasons/season-atomic.js";
import type { Season, SeasonEntry } from "../../modules/seasons/seasons-domain.js";
import { mapSeasonEntryDocument, type MongoSeasonEntryDocument } from "./season-entries-repository.js";
import { mapUserDocument, type MongoUserDocument } from "./users-repository.js";
import type { MongoRaceRunDocument } from "./race-runs-repository.js";

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === 11000
  );
}

async function runMongoTransaction<T>(
  client: MongoClient,
  handler: (session: ClientSession) => Promise<T>
): Promise<T> {
  const session = client.startSession();
  try {
    return await session.withTransaction(() => handler(session));
  } finally {
    await session.endSession();
  }
}

export async function enterSeasonAtomicallyInMongo(
  client: MongoClient,
  input: {
    season: Season;
    userId: string;
  }
): Promise<EnterSeasonAtomicResult> {
  const db = client.db();
  const usersColl = db.collection<MongoUserDocument>("users");
  const entriesColl = db.collection<MongoSeasonEntryDocument>("seasonEntries");
  const fee = input.season.entryFee;
  const seasonId = input.season.seasonId;
  const userId = input.userId;

  const existingOutside = await entriesColl.findOne({ seasonId, userId });
  if (existingOutside) {
    return { kind: "already-entered" };
  }

  try {
    return await runMongoTransaction(client, async (session) => {
      const existing = await entriesColl.findOne({ seasonId, userId }, { session });
      if (existing) {
        return { kind: "already-entered" };
      }

      const userAfterSpend = await usersColl.findOneAndUpdate(
        { userId, raceCoinsBalance: { $gte: fee } },
        { $inc: { raceCoinsBalance: -fee }, $set: { updatedAt: new Date() } },
        { session, includeResultMetadata: false, returnDocument: "after" }
      );

      if (!userAfterSpend) {
        return { kind: "insufficient-balance" };
      }

      const now = new Date();
      const entryId = `entry_${randomUUID()}`;
      const entryDoc: MongoSeasonEntryDocument = {
        entryId,
        seasonId,
        userId,
        bestScore: 0,
        totalRaces: 0,
        entryFeeSnapshot: fee,
        createdAt: now,
        updatedAt: now
      };

      await entriesColl.insertOne(entryDoc, { session });

      const entry: SeasonEntry = mapSeasonEntryDocument(entryDoc);
      return {
        kind: "success",
        entry,
        user: mapUserDocument(userAfterSpend)
      };
    });
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      return { kind: "already-entered" };
    }
    throw error;
  }
}

export async function finishSeasonRaceAtomicallyInMongo(
  client: MongoClient,
  input: {
    raceId: string;
    score: number;
    entry: SeasonEntry;
  }
): Promise<FinishSeasonRaceAtomicResult> {
  const db = client.db();
  const racesColl = db.collection<MongoRaceRunDocument>("raceRuns");
  const entriesColl = db.collection<MongoSeasonEntryDocument>("seasonEntries");
  const { raceId, score, entry } = input;
  const entryId = entry.entryId;
  const oldBest = entry.bestScore;
  const isNewBest = score > oldBest;
  const bestScore = isNewBest ? score : oldBest;

  return runMongoTransaction(client, async (session) => {
    const finishedAt = new Date();
    const raceAfter = await racesColl.findOneAndUpdate(
      { raceId, status: "started" },
      { $set: { status: "finished", score, finishedAt } },
      { session, includeResultMetadata: false, returnDocument: "after" }
    );

    if (!raceAfter) {
      const current = await racesColl.findOne({ raceId }, { session });
      if (current?.status === "finished") {
        return { kind: "already-finished" };
      }
      return { kind: "already-finished" };
    }

    const now = new Date();
    await entriesColl.updateOne(
      { entryId },
      {
        $inc: { totalRaces: 1 },
        $max: { bestScore: score },
        $set: { updatedAt: now }
      },
      { session }
    );

    return {
      kind: "success",
      raceRun: {
        raceId: raceAfter.raceId,
        seasonId: raceAfter.seasonId,
        userId: raceAfter.userId,
        seed: raceAfter.seed,
        score: raceAfter.score,
        status: raceAfter.status,
        startedAt: raceAfter.startedAt,
        finishedAt: raceAfter.finishedAt
      },
      isNewBest,
      bestScore
    };
  });
}

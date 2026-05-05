import { describe, expect, test } from "vitest";

import { finishTrainingRaceAtomicallyInMongo } from "../../../src/infra/mongo/season-mongo-transactions.js";
import type { MongoRaceRunDocument } from "../../../src/infra/mongo/race-runs-repository.js";
import type { MongoSeasonTrainingEntryDocument } from "../../../src/infra/mongo/season-training-entries-repository.js";
import type { MongoUserDocument } from "../../../src/infra/mongo/users-repository.js";

describe("finishTrainingRaceAtomicallyInMongo", () => {
  test("stores training result details and credits earned race coins", async () => {
    const race: MongoRaceRunDocument = {
      raceId: "race_1",
      seasonId: "season_1",
      userId: "user_1",
      seed: "seed_1",
      mode: "training",
      score: 0,
      status: "started",
      startedAt: new Date("2026-05-05T09:00:00.000Z")
    };
    const user: MongoUserDocument = {
      userId: "user_1",
      telegramUserId: "1001",
      ownedCarIds: [],
      garageRevision: 0,
      raceCoinsBalance: 7
    };
    const client = new FakeMongoClient({
      raceRuns: [race],
      seasonTrainingEntries: [],
      users: [user]
    });

    const result = await finishTrainingRaceAtomicallyInMongo(client as never, {
      raceId: "race_1",
      score: 1234,
      seasonId: "season_1",
      userId: "user_1",
      timeSeconds: 52.31,
      raceCoinsEarned: 13
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.raceRun.score).toBe(1234);
    expect(result.raceRun.timeSeconds).toBe(52.31);
    expect(result.raceRun.raceCoinsEarned).toBe(13);
    expect(result.raceCoinsEarned).toBe(13);
    expect(result.user.raceCoinsBalance).toBe(20);
    expect(client.users[0].raceCoinsBalance).toBe(20);
  });
});

class FakeMongoClient {
  readonly raceRuns: MongoRaceRunDocument[];
  readonly seasonTrainingEntries: MongoSeasonTrainingEntryDocument[];
  readonly users: MongoUserDocument[];

  constructor(input: {
    raceRuns: MongoRaceRunDocument[];
    seasonTrainingEntries: MongoSeasonTrainingEntryDocument[];
    users: MongoUserDocument[];
  }) {
    this.raceRuns = input.raceRuns;
    this.seasonTrainingEntries = input.seasonTrainingEntries;
    this.users = input.users;
  }

  startSession() {
    return {
      withTransaction: async <T>(handler: () => Promise<T>) => handler(),
      endSession: async () => {}
    };
  }

  db() {
    return {
      collection: (name: string) => {
        if (name === "raceRuns") return new FakeCollection(this.raceRuns);
        if (name === "seasonTrainingEntries") {
          return new FakeCollection(this.seasonTrainingEntries);
        }
        if (name === "users") return new FakeCollection(this.users);
        throw new Error(`Unexpected collection: ${name}`);
      }
    };
  }
}

class FakeCollection<T extends object> {
  constructor(private readonly rows: T[]) {}

  async findOne(filter: Record<string, unknown>) {
    return this.rows.find((row) => matches(row as Record<string, unknown>, filter)) ?? null;
  }

  async findOneAndUpdate(
    filter: Record<string, unknown>,
    update: Record<string, Record<string, unknown>>,
    options: { upsert?: boolean }
  ) {
    let row = this.rows.find((candidate) => matches(candidate as Record<string, unknown>, filter));
    if (!row && options.upsert) {
      row = {} as T;
      this.rows.push(row);
      applyUpdate(row as Record<string, unknown>, { $setOnInsert: update.$setOnInsert ?? {} });
    }
    if (!row) return null;
    applyUpdate(row as Record<string, unknown>, update);
    return row;
  }
}

function matches(row: Record<string, unknown>, filter: Record<string, unknown>) {
  return Object.entries(filter).every(([key, value]) => row[key] === value);
}

function applyUpdate(
  row: Record<string, unknown>,
  update: Record<string, Record<string, unknown>>
) {
  for (const [key, value] of Object.entries(update.$set ?? {})) {
    row[key] = value;
  }
  for (const [key, value] of Object.entries(update.$setOnInsert ?? {})) {
    row[key] ??= value;
  }
  for (const [key, value] of Object.entries(update.$inc ?? {})) {
    row[key] = Number(row[key] ?? 0) + Number(value);
  }
  for (const [key, value] of Object.entries(update.$max ?? {})) {
    row[key] = Math.max(Number(row[key] ?? 0), Number(value));
  }
}

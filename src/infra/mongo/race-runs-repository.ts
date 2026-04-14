import type { WithId } from "mongodb";
import { randomUUID } from "node:crypto";

import type { RaceRun } from "../../modules/seasons/seasons-domain.js";
import type {
  CreateRaceRunInput,
  RaceRunsRepository
} from "../../modules/seasons/race-runs-repository.js";

export interface MongoRaceRunDocument {
  raceId: string;
  seasonId: string;
  userId: string;
  seed: string;
  score: number;
  status: "started" | "finished" | "abandoned";
  startedAt: Date;
  finishedAt?: Date;
}

export interface RaceRunsCollection {
  findOne(filter: { raceId: string }): Promise<WithId<MongoRaceRunDocument> | MongoRaceRunDocument | null>;
  insertOne(document: MongoRaceRunDocument): Promise<unknown>;
  findOneAndUpdate(
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
    options: { includeResultMetadata: false; returnDocument: "after" }
  ): Promise<WithId<MongoRaceRunDocument> | MongoRaceRunDocument | null>;
}

export class MongoRaceRunsRepository implements RaceRunsRepository {
  constructor(private readonly collection: RaceRunsCollection) {}

  async createRaceRun(input: CreateRaceRunInput): Promise<RaceRun> {
    const startedAt = new Date();
    const raceId = `race_${randomUUID()}`;
    const document: MongoRaceRunDocument = {
      raceId,
      seasonId: input.seasonId,
      userId: input.userId,
      seed: input.seed,
      score: 0,
      status: "started",
      startedAt
    };
    await this.collection.insertOne(document);
    return mapRaceRunDocument(document);
  }

  async getRaceRunById(raceId: string): Promise<RaceRun | null> {
    const document = await this.collection.findOne({ raceId });
    return document ? mapRaceRunDocument(document) : null;
  }

  async finishRaceRun(raceId: string, score: number): Promise<RaceRun | null> {
    const finishedAt = new Date();
    const document = await this.collection.findOneAndUpdate(
      { raceId, status: "started" },
      { $set: { status: "finished", score, finishedAt } },
      { includeResultMetadata: false, returnDocument: "after" }
    );
    return document ? mapRaceRunDocument(document) : null;
  }
}

function mapRaceRunDocument(
  document: WithId<MongoRaceRunDocument> | MongoRaceRunDocument
): RaceRun {
  return {
    raceId: document.raceId,
    seasonId: document.seasonId,
    userId: document.userId,
    seed: document.seed,
    score: document.score,
    status: document.status,
    startedAt: document.startedAt,
    finishedAt: document.finishedAt
  };
}

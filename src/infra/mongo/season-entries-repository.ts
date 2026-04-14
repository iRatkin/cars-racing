import type { WithId } from "mongodb";
import { randomUUID } from "node:crypto";

import type { SeasonEntry } from "../../modules/seasons/seasons-domain.js";
import type {
  CreateSeasonEntryInput,
  SeasonEntriesRepository
} from "../../modules/seasons/season-entries-repository.js";

export interface MongoSeasonEntryDocument {
  entryId: string;
  seasonId: string;
  userId: string;
  bestScore: number;
  totalRaces: number;
  entryFeeSnapshot: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface SeasonEntriesCollection {
  findOne(filter: Record<string, unknown>): Promise<WithId<MongoSeasonEntryDocument> | MongoSeasonEntryDocument | null>;
  insertOne(document: MongoSeasonEntryDocument): Promise<unknown>;
  updateOne(filter: Record<string, unknown>, update: Record<string, unknown>): Promise<unknown>;
  find(filter: Record<string, unknown>): {
    sort(sort: Record<string, 1 | -1>): {
      limit(limit: number): {
        toArray(): Promise<Array<WithId<MongoSeasonEntryDocument> | MongoSeasonEntryDocument>>;
      };
    };
  };
  countDocuments(filter: Record<string, unknown>): Promise<number>;
}

export class MongoSeasonEntriesRepository implements SeasonEntriesRepository {
  constructor(private readonly collection: SeasonEntriesCollection) {}

  async findEntry(seasonId: string, userId: string): Promise<SeasonEntry | null> {
    const document = await this.collection.findOne({ seasonId, userId });
    return document ? mapSeasonEntryDocument(document) : null;
  }

  async createEntry(input: CreateSeasonEntryInput): Promise<SeasonEntry> {
    const now = new Date();
    const entryId = `entry_${randomUUID()}`;
    const document: MongoSeasonEntryDocument = {
      entryId,
      seasonId: input.seasonId,
      userId: input.userId,
      bestScore: 0,
      totalRaces: 0,
      entryFeeSnapshot: input.entryFeeSnapshot,
      createdAt: now,
      updatedAt: now
    };
    await this.collection.insertOne(document);
    return mapSeasonEntryDocument(document);
  }

  async updateBestScore(entryId: string, newBestScore: number): Promise<void> {
    const now = new Date();
    await this.collection.updateOne(
      { entryId },
      { $set: { bestScore: newBestScore, updatedAt: now } }
    );
  }

  async incrementTotalRaces(entryId: string): Promise<void> {
    const now = new Date();
    await this.collection.updateOne(
      { entryId },
      { $inc: { totalRaces: 1 }, $set: { updatedAt: now } }
    );
  }

  async getLeaderboard(seasonId: string, limit: number): Promise<SeasonEntry[]> {
    const rows = await this.collection
      .find({ seasonId })
      .sort({ bestScore: -1, createdAt: 1, userId: 1 })
      .limit(limit)
      .toArray();
    return rows.map(mapSeasonEntryDocument);
  }

  async getEntryRank(seasonId: string, userId: string): Promise<number | null> {
    const document = await this.collection.findOne({ seasonId, userId });
    if (!document) {
      return null;
    }
    const betterCount = await this.collection.countDocuments({
      seasonId,
      bestScore: { $gt: document.bestScore }
    });
    return betterCount + 1;
  }

  async countEntries(seasonId: string): Promise<number> {
    return this.collection.countDocuments({ seasonId });
  }
}

export function mapSeasonEntryDocument(
  document: WithId<MongoSeasonEntryDocument> | MongoSeasonEntryDocument
): SeasonEntry {
  return {
    entryId: document.entryId,
    seasonId: document.seasonId,
    userId: document.userId,
    bestScore: document.bestScore,
    totalRaces: document.totalRaces,
    entryFeeSnapshot: document.entryFeeSnapshot,
    createdAt: document.createdAt
  };
}

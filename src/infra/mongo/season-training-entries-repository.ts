import type { WithId } from "mongodb";

import type { SeasonTrainingEntry } from "../../modules/seasons/seasons-domain.js";
import type { SeasonTrainingEntriesRepository } from "../../modules/seasons/season-training-entries-repository.js";

export interface MongoSeasonTrainingEntryDocument {
  entryId: string;
  seasonId: string;
  userId: string;
  bestScore: number;
  totalRaces: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface SeasonTrainingEntriesCollection {
  findOne(
    filter: Record<string, unknown>
  ): Promise<WithId<MongoSeasonTrainingEntryDocument> | MongoSeasonTrainingEntryDocument | null>;
}

export class MongoSeasonTrainingEntriesRepository
  implements SeasonTrainingEntriesRepository
{
  constructor(private readonly collection: SeasonTrainingEntriesCollection) {}

  async findEntry(seasonId: string, userId: string): Promise<SeasonTrainingEntry | null> {
    const document = await this.collection.findOne({ seasonId, userId });
    return document ? mapSeasonTrainingEntryDocument(document) : null;
  }
}

export function mapSeasonTrainingEntryDocument(
  document: WithId<MongoSeasonTrainingEntryDocument> | MongoSeasonTrainingEntryDocument
): SeasonTrainingEntry {
  return {
    entryId: document.entryId,
    seasonId: document.seasonId,
    userId: document.userId,
    bestScore: document.bestScore,
    totalRaces: document.totalRaces,
    createdAt: document.createdAt
  };
}

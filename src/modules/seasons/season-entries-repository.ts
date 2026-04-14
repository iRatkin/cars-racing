import type { SeasonEntry } from "./seasons-domain.js";

export interface CreateSeasonEntryInput {
  seasonId: string;
  userId: string;
  entryFeeSnapshot: number;
}

export interface SeasonEntriesRepository {
  findEntry(seasonId: string, userId: string): Promise<SeasonEntry | null>;
  createEntry(input: CreateSeasonEntryInput): Promise<SeasonEntry>;
  updateBestScore(entryId: string, newBestScore: number): Promise<void>;
  incrementTotalRaces(entryId: string): Promise<void>;
  getLeaderboard(seasonId: string, limit: number): Promise<SeasonEntry[]>;
  getEntryRank(seasonId: string, userId: string): Promise<number | null>;
  countEntries(seasonId: string): Promise<number>;
}

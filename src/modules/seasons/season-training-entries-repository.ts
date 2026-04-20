import type { SeasonTrainingEntry } from "./seasons-domain.js";

export interface SeasonTrainingEntriesRepository {
  findEntry(seasonId: string, userId: string): Promise<SeasonTrainingEntry | null>;
}

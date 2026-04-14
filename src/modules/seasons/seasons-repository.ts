import type { Season } from "./seasons-domain.js";

export interface SeasonsRepository {
  getSeasonById(seasonId: string, referenceNow: Date): Promise<Season | null>;
  getActiveAndUpcomingSeasons(referenceNow: Date): Promise<Season[]>;
}

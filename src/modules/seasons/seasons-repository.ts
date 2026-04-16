import type { Season } from "./seasons-domain.js";

export interface CreateSeasonInput {
  title: string;
  mapId: string;
  entryFee: number;
  prizePoolShare: number;
  startsAt: Date;
  endsAt: Date;
}

export interface UpdateSeasonInput {
  title?: string;
  mapId?: string;
  entryFee?: number;
  prizePoolShare?: number;
  startsAt?: Date;
  endsAt?: Date;
}

export interface SeasonsRepository {
  getSeasonById(seasonId: string, referenceNow: Date): Promise<Season | null>;
  getActiveAndUpcomingSeasons(referenceNow: Date): Promise<Season[]>;
  getAllSeasons(referenceNow: Date): Promise<Season[]>;
  createSeason(input: CreateSeasonInput, referenceNow: Date): Promise<Season>;
  updateSeason(seasonId: string, patch: UpdateSeasonInput, referenceNow: Date): Promise<Season | null>;
}

export function validateSeasonDateRange(startsAt: Date, endsAt: Date): void {
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
    throw new Error("Season startsAt and endsAt must be valid dates.");
  }
  if (endsAt.getTime() <= startsAt.getTime()) {
    throw new Error("Season endsAt must be strictly after startsAt.");
  }
}

export type SeasonStatus = "upcoming" | "active" | "finished";

export interface Season {
  seasonId: string;
  title: string;
  mapId: string;
  entryFee: number;
  prizePoolShare: number;
  startsAt: Date;
  endsAt: Date;
  status: SeasonStatus;
}

export interface SeasonEntry {
  entryId: string;
  seasonId: string;
  userId: string;
  bestScore: number;
  totalRaces: number;
  entryFeeSnapshot: number;
  createdAt: Date;
}

export interface SeasonTrainingEntry {
  entryId: string;
  seasonId: string;
  userId: string;
  bestScore: number;
  totalRaces: number;
  createdAt: Date;
}

export type RaceRunMode = "ranked" | "training";

export type RaceRunStatus = "started" | "finished" | "abandoned";

export interface RaceRun {
  raceId: string;
  seasonId: string;
  userId: string;
  seed: string;
  mode: RaceRunMode;
  score: number;
  status: RaceRunStatus;
  startedAt: Date;
  finishedAt?: Date;
}

export interface LeaderboardEntry {
  rank: number;
  userId: string;
  nick: string;
  bestScore: number;
  totalRaces: number;
}

export interface LeaderboardView {
  seasonId: string;
  entries: LeaderboardEntry[];
  currentPlayer?: LeaderboardEntry;
  totalParticipants: number;
}

export function computeSeasonStatus(
  season: { startsAt: Date; endsAt: Date },
  referenceNow: Date
): SeasonStatus {
  if (referenceNow.getTime() < season.startsAt.getTime()) {
    return "upcoming";
  }
  if (referenceNow.getTime() >= season.endsAt.getTime()) {
    return "finished";
  }
  return "active";
}

export function canEnterSeason(season: Season, referenceNow: Date): boolean {
  return computeSeasonStatus(season, referenceNow) === "active";
}

export function canStartRace(season: Season, referenceNow: Date): boolean {
  return computeSeasonStatus(season, referenceNow) === "active";
}

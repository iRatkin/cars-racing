import type { RaceRun } from "./seasons-domain.js";

export interface CreateRaceRunInput {
  seasonId: string;
  userId: string;
  seed: string;
}

export interface RaceRunsRepository {
  createRaceRun(input: CreateRaceRunInput): Promise<RaceRun>;
  getRaceRunById(raceId: string): Promise<RaceRun | null>;
  finishRaceRun(raceId: string, score: number): Promise<RaceRun | null>;
}

import type { AppUser } from "../users/users-repository.js";
import type { RaceRun, SeasonEntry } from "./seasons-domain.js";

export type EnterSeasonAtomicResult =
  | { kind: "already-entered" }
  | { kind: "insufficient-balance" }
  | { kind: "success"; entry: SeasonEntry; user: AppUser };

export type FinishSeasonRaceAtomicResult =
  | { kind: "already-finished" }
  | { kind: "success"; raceRun: RaceRun; isNewBest: boolean; bestScore: number };

export type FinishTrainingRaceAtomicResult =
  | { kind: "already-finished" }
  | { kind: "success"; raceRun: RaceRun; isNewBest: boolean; bestScore: number };

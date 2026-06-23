import { afterEach, describe, expect, test } from "vitest";
import type { FastifyInstance } from "fastify";

import { buildApp } from "../src/app.js";
import type { AppConfig } from "../src/config/config.js";
import type {
  CatalogCar,
  CarsCatalogRepository
} from "../src/modules/cars-catalog/cars-catalog-repository.js";
import type {
  CreateRaceRunInput,
  RaceRunsRepository
} from "../src/modules/seasons/race-runs-repository.js";
import type {
  CreateSeasonEntryInput,
  SeasonEntriesRepository
} from "../src/modules/seasons/season-entries-repository.js";
import type { SeasonTrainingEntriesRepository } from "../src/modules/seasons/season-training-entries-repository.js";
import {
  computeSeasonStatus,
  type RaceRun,
  type Season,
  type SeasonEntry
} from "../src/modules/seasons/seasons-domain.js";
import type {
  CreateSeasonInput,
  SeasonsRepository,
  UpdateSeasonInput
} from "../src/modules/seasons/seasons-repository.js";
import type {
  AppUser,
  UpsertTelegramUserInput,
  UsersRepository,
  UserUtmData,
  UserUtmSourceDetails,
  UtmSourceCount,
  UtmSourceDetailsQuery
} from "../src/modules/users/users-repository.js";

describe("leaderboard routes", () => {
  const apps: FastifyInstance[] = [];

  afterEach(async () => {
    await Promise.all(apps.map((app) => app.close()));
    apps.length = 0;
  });

  test("does not expose the current player when their ranked best score is zero", async () => {
    const season = buildSeason();
    const zeroScoreEntry = buildSeasonEntry({
      seasonId: season.seasonId,
      userId: "usr_1",
      bestScore: 0,
      totalRaces: 1
    });
    const app = buildApp({
      config: testConfig,
      usersRepository: stubUsersRepository,
      carsCatalogRepository: stubCarsCatalogRepository,
      seasonsRepository: new SingleSeasonRepository(season),
      seasonEntriesRepository: new ZeroCurrentPlayerEntriesRepository(zeroScoreEntry),
      seasonTrainingEntriesRepository: stubSeasonTrainingEntriesRepository,
      raceRunsRepository: stubRaceRunsRepository,
      mongoClient: {} as never,
      now: () => new Date("2026-05-27T12:00:00.000Z")
    });
    await app.ready();
    apps.push(app);

    const response = await app.inject({
      method: "GET",
      url: "/v1/seasons/sea_1/leaderboard",
      headers: {
        authorization: `Bearer ${app.jwt.sign({ sub: "usr_1", telegramUserId: "1" })}`
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      seasonId: "sea_1",
      entries: [],
      currentPlayer: null,
      totalParticipants: 0
    });
  });
});

class SingleSeasonRepository implements SeasonsRepository {
  constructor(private readonly season: Season) {}

  async getSeasonById(seasonId: string, referenceNow: Date): Promise<Season | null> {
    return seasonId === this.season.seasonId
      ? cloneSeasonWithStatus(this.season, referenceNow)
      : null;
  }

  async getActiveAndUpcomingSeasons(referenceNow: Date): Promise<Season[]> {
    return [cloneSeasonWithStatus(this.season, referenceNow)];
  }

  async getAllSeasons(referenceNow: Date): Promise<Season[]> {
    return [cloneSeasonWithStatus(this.season, referenceNow)];
  }

  async findSeasonForWindow(): Promise<Season | null> {
    return null;
  }

  async findLatestSeasonBefore(): Promise<Season | null> {
    return null;
  }

  async createSeason(_input: CreateSeasonInput, _referenceNow: Date): Promise<Season> {
    throw new Error("not used");
  }

  async updateSeason(
    _seasonId: string,
    _patch: UpdateSeasonInput,
    _referenceNow: Date
  ): Promise<Season | null> {
    throw new Error("not used");
  }
}

class ZeroCurrentPlayerEntriesRepository implements SeasonEntriesRepository {
  constructor(private readonly entry: SeasonEntry) {}

  async findEntry(seasonId: string, userId: string): Promise<SeasonEntry | null> {
    return seasonId === this.entry.seasonId && userId === this.entry.userId
      ? this.entry
      : null;
  }

  async createEntry(_input: CreateSeasonEntryInput): Promise<SeasonEntry> {
    throw new Error("not used");
  }

  async updateBestScore(): Promise<void> {}

  async incrementTotalRaces(): Promise<void> {}

  async getLeaderboard(): Promise<SeasonEntry[]> {
    return [];
  }

  async getEntryRank(): Promise<number | null> {
    return null;
  }

  async countEntries(): Promise<number> {
    return 0;
  }
}

const stubSeasonTrainingEntriesRepository: SeasonTrainingEntriesRepository = {
  async findEntry() {
    return null;
  }
};

const stubRaceRunsRepository: RaceRunsRepository = {
  async createRaceRun(input: CreateRaceRunInput): Promise<RaceRun> {
    return {
      raceId: "race_1",
      seasonId: input.seasonId,
      userId: input.userId,
      seed: input.seed,
      mode: input.mode,
      score: 0,
      status: "started",
      startedAt: new Date("2026-05-27T12:00:00.000Z")
    };
  },
  async getRaceRunById(): Promise<RaceRun | null> {
    return null;
  },
  async finishRaceRun(): Promise<RaceRun | null> {
    return null;
  }
};

const stubCarsCatalogRepository: CarsCatalogRepository = {
  async getActiveSortedByOrder(): Promise<CatalogCar[]> {
    return [];
  },
  async getById(): Promise<CatalogCar | null> {
    return null;
  },
  async getAllCars(): Promise<CatalogCar[]> {
    return [];
  },
  async upsertCar(car: CatalogCar): Promise<CatalogCar> {
    return car;
  },
  async setCarActive(): Promise<CatalogCar | null> {
    return null;
  },
  async getMaxSortOrder(): Promise<number> {
    return 0;
  }
};

const stubUsersRepository: UsersRepository = {
  async upsertTelegramUser(input: UpsertTelegramUserInput): Promise<AppUser> {
    return buildUser({ telegramUserId: input.telegramUserId });
  },
  async getUserById(userId: string): Promise<AppUser | null> {
    return userId === "usr_1" ? buildUser() : null;
  },
  async getUserByNickNormalized(): Promise<AppUser | null> {
    return null;
  },
  async setInitialNick(): Promise<AppUser | null> {
    return null;
  },
  async setNick(): Promise<AppUser | null> {
    return null;
  },
  async addRaceCoins(): Promise<AppUser> {
    return buildUser();
  },
  async spendRaceCoins(): Promise<AppUser | null> {
    return buildUser();
  },
  async addOwnedCar(): Promise<AppUser | null> {
    return buildUser();
  },
  async setUtmIfNotSet(_telegramUserId: string, _utm: UserUtmData): Promise<void> {},
  async getUserByTelegramId(): Promise<AppUser | null> {
    return null;
  },
  async getUserByUsername(): Promise<AppUser | null> {
    return null;
  },
  async setRaceCoinsBalance(): Promise<AppUser> {
    return buildUser();
  },
  async getUserCount(): Promise<number> {
    return 0;
  },
  async getTopUtmSources(): Promise<UtmSourceCount[]> {
    return [];
  },
  async getAllUtmSources(): Promise<UtmSourceCount[]> {
    return [];
  },
  async getUtmSourcesSince(): Promise<UtmSourceCount[]> {
    return [];
  },
  async getUtmSourceDetails(_query: UtmSourceDetailsQuery): Promise<UserUtmSourceDetails> {
    return {
      utmSource: "direct",
      todayCount: 0,
      yesterdayCount: 0,
      totalCount: 0
    };
  },
  async getAllUsers(): Promise<AppUser[]> {
    return [buildUser()];
  }
};

const testConfig: AppConfig = {
  botToken: "test-bot-token",
  jwtSecret: "test-jwt-secret",
  mongoUri: "mongodb://localhost:27017/test",
  telegramWebhookSecret: "test-webhook-secret",
  miniAppUrl: undefined,
  env: "stage",
  port: 0
};

function buildSeason(): Season {
  const startsAt = new Date("2026-05-27T11:00:00.000Z");
  const endsAt = new Date("2026-05-27T13:00:00.000Z");
  return {
    seasonId: "sea_1",
    title: "Leaderboard Cup",
    mapId: "track_default",
    entryFee: 10,
    prizePoolShare: 0.5,
    startsAt,
    endsAt,
    status: computeSeasonStatus({ startsAt, endsAt }, startsAt)
  };
}

function buildSeasonEntry(overrides: Partial<SeasonEntry>): SeasonEntry {
  return {
    entryId: "entry_1",
    seasonId: "sea_1",
    userId: "usr_1",
    bestScore: 0,
    totalRaces: 0,
    entryFeeSnapshot: 10,
    createdAt: new Date("2026-05-27T11:10:00.000Z"),
    ...overrides
  };
}

function cloneSeasonWithStatus(season: Season, referenceNow: Date): Season {
  return {
    ...season,
    startsAt: new Date(season.startsAt),
    endsAt: new Date(season.endsAt),
    status: computeSeasonStatus(season, referenceNow)
  };
}

function buildUser(overrides: Partial<AppUser> = {}): AppUser {
  return {
    userId: "usr_1",
    telegramUserId: "1",
    nick: "ZeroRacer",
    nickNormalized: "zeroracer",
    ownedCarIds: [],
    garageRevision: 0,
    raceCoinsBalance: 0,
    ...overrides
  };
}

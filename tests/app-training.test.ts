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
  type SeasonEntry,
  type SeasonTrainingEntry
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

describe("training race routes", () => {
  const apps: FastifyInstance[] = [];

  afterEach(async () => {
    await Promise.all(apps.map((app) => app.close()));
    apps.length = 0;
  });

  test("starts a season-specific training race even when the season is finished", async () => {
    const referenceNow = new Date("2026-05-27T12:00:00.000Z");
    const finishedSeason = buildSeason({
      seasonId: "sea_finished",
      mapId: "track_legacy",
      startsAt: new Date("2026-05-20T12:00:00.000Z"),
      endsAt: new Date("2026-05-21T12:00:00.000Z")
    });
    const { app, token, raceRunsRepository } = await buildTrainingTestApp({
      seasons: [finishedSeason],
      now: referenceNow
    });
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/v1/seasons/sea_finished/training-races/start",
      headers: { authorization: `Bearer ${token}` },
      payload: {}
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      raceId: "race_1",
      seed: expect.any(String),
      seasonId: "sea_finished",
      mapId: "track_legacy"
    });
    expect(raceRunsRepository.runs[0]).toMatchObject({
      seasonId: "sea_finished",
      userId: "usr_1",
      mode: "training",
      status: "started"
    });
  });

  test("starts a global training race from the latest finished season when no active season exists", async () => {
    const referenceNow = new Date("2026-05-27T12:00:00.000Z");
    const olderFinishedSeason = buildSeason({
      seasonId: "sea_old",
      mapId: "track_old",
      startsAt: new Date("2026-05-13T12:00:00.000Z"),
      endsAt: new Date("2026-05-14T12:00:00.000Z")
    });
    const latestFinishedSeason = buildSeason({
      seasonId: "sea_latest",
      mapId: "track_latest",
      startsAt: new Date("2026-05-20T12:00:00.000Z"),
      endsAt: new Date("2026-05-21T12:00:00.000Z")
    });
    const { app, token, raceRunsRepository } = await buildTrainingTestApp({
      seasons: [olderFinishedSeason, latestFinishedSeason],
      now: referenceNow
    });
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/v1/training-races/start",
      headers: { authorization: `Bearer ${token}` },
      payload: {}
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      raceId: "race_1",
      seed: expect.any(String),
      seasonId: "sea_latest",
      mapId: "track_latest"
    });
    expect(raceRunsRepository.runs[0]?.seasonId).toBe("sea_latest");
  });

  test("returns the training context without requiring an active season", async () => {
    const referenceNow = new Date("2026-05-27T12:00:00.000Z");
    const latestFinishedSeason = buildSeason({
      seasonId: "sea_latest",
      mapId: "track_latest",
      startsAt: new Date("2026-05-20T12:00:00.000Z"),
      endsAt: new Date("2026-05-21T12:00:00.000Z")
    });
    const { app, token } = await buildTrainingTestApp({
      seasons: [latestFinishedSeason],
      now: referenceNow
    });
    apps.push(app);

    const response = await app.inject({
      method: "GET",
      url: "/v1/training-context",
      headers: { authorization: `Bearer ${token}` }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      seasonId: "sea_latest",
      mapId: "track_latest",
      seasonStatus: "finished",
      training: {
        bestScore: null,
        totalRaces: 0
      }
    });
  });
});

async function buildTrainingTestApp(input: { seasons: Season[]; now: Date }) {
  const seasonsRepository = new InMemorySeasonsRepository(input.seasons);
  const raceRunsRepository = new InMemoryRaceRunsRepository();
  const app = buildApp({
    config: testConfig,
    usersRepository: stubUsersRepository,
    carsCatalogRepository: stubCarsCatalogRepository,
    seasonsRepository,
    seasonEntriesRepository: stubSeasonEntriesRepository,
    seasonTrainingEntriesRepository: stubSeasonTrainingEntriesRepository,
    raceRunsRepository,
    mongoClient: {} as never,
    now: () => input.now
  });
  await app.ready();

  return {
    app,
    token: app.jwt.sign({ sub: "usr_1", telegramUserId: "1" }),
    raceRunsRepository
  };
}

const testConfig: AppConfig = {
  botToken: "test-bot-token",
  jwtSecret: "test-jwt-secret",
  mongoUri: "mongodb://localhost:27017/test",
  telegramWebhookSecret: "test-webhook-secret",
  miniAppUrl: undefined,
  env: "stage",
  port: 0
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

const stubSeasonEntriesRepository: SeasonEntriesRepository = {
  async findEntry(): Promise<SeasonEntry | null> {
    return null;
  },
  async createEntry(_input: CreateSeasonEntryInput): Promise<SeasonEntry> {
    throw new Error("not used");
  },
  async updateBestScore(): Promise<void> {},
  async incrementTotalRaces(): Promise<void> {},
  async getLeaderboard(): Promise<SeasonEntry[]> {
    return [];
  },
  async getEntryRank(): Promise<number | null> {
    return null;
  },
  async countEntries(): Promise<number> {
    return 0;
  }
};

const stubSeasonTrainingEntriesRepository: SeasonTrainingEntriesRepository = {
  async findEntry(): Promise<SeasonTrainingEntry | null> {
    return null;
  }
};

class InMemorySeasonsRepository implements SeasonsRepository {
  constructor(private readonly seasons: Season[]) {}

  async getSeasonById(seasonId: string, referenceNow: Date): Promise<Season | null> {
    const season = this.seasons.find((candidate) => candidate.seasonId === seasonId);
    return season ? cloneSeasonWithStatus(season, referenceNow) : null;
  }

  async getActiveAndUpcomingSeasons(referenceNow: Date): Promise<Season[]> {
    return this.seasons
      .filter((season) => season.endsAt.getTime() > referenceNow.getTime())
      .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
      .map((season) => cloneSeasonWithStatus(season, referenceNow));
  }

  async getAllSeasons(referenceNow: Date): Promise<Season[]> {
    return [...this.seasons]
      .sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime())
      .map((season) => cloneSeasonWithStatus(season, referenceNow));
  }

  async findSeasonForWindow(): Promise<Season | null> {
    return null;
  }

  async findLatestSeasonBefore(windowStart: Date, referenceNow: Date): Promise<Season | null> {
    const season = [...this.seasons]
      .filter((candidate) => candidate.startsAt.getTime() < windowStart.getTime())
      .sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime())[0];
    return season ? cloneSeasonWithStatus(season, referenceNow) : null;
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

class InMemoryRaceRunsRepository implements RaceRunsRepository {
  readonly runs: RaceRun[] = [];

  async createRaceRun(input: CreateRaceRunInput): Promise<RaceRun> {
    const raceRun: RaceRun = {
      raceId: `race_${this.runs.length + 1}`,
      seasonId: input.seasonId,
      userId: input.userId,
      seed: input.seed,
      mode: input.mode,
      score: 0,
      status: "started",
      startedAt: new Date("2026-05-27T12:00:00.000Z")
    };
    this.runs.push(raceRun);
    return raceRun;
  }

  async getRaceRunById(raceId: string): Promise<RaceRun | null> {
    return this.runs.find((raceRun) => raceRun.raceId === raceId) ?? null;
  }

  async finishRaceRun(raceId: string, score: number): Promise<RaceRun | null> {
    const raceRun = this.runs.find((candidate) => candidate.raceId === raceId);
    if (!raceRun || raceRun.status !== "started") {
      return null;
    }
    raceRun.status = "finished";
    raceRun.score = score;
    raceRun.finishedAt = new Date("2026-05-27T12:01:00.000Z");
    return raceRun;
  }
}

function buildSeason(overrides: Partial<Season>): Season {
  const startsAt = overrides.startsAt ?? new Date("2026-05-27T11:00:00.000Z");
  const endsAt = overrides.endsAt ?? new Date("2026-05-27T13:00:00.000Z");
  return {
    seasonId: "sea_1",
    title: "Training Cup",
    mapId: "track_default",
    entryFee: 10,
    prizePoolShare: 0.5,
    startsAt,
    endsAt,
    status: computeSeasonStatus({ startsAt, endsAt }, startsAt),
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
    ownedCarIds: [],
    garageRevision: 0,
    raceCoinsBalance: 0,
    ...overrides
  };
}

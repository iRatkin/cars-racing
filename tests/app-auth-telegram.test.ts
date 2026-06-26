import { createHmac } from "node:crypto";

import { afterEach, describe, expect, test, vi } from "vitest";
import type { FastifyInstance } from "fastify";

import { buildApp } from "../src/app.js";
import type { AppConfig } from "../src/config/config.js";
import type {
  CatalogCar,
  CarsCatalogRepository
} from "../src/modules/cars-catalog/cars-catalog-repository.js";
import type {
  AppUser,
  UsersRepository,
  UserUtmData
} from "../src/modules/users/users-repository.js";

describe("POST /v1/auth/telegram", () => {
  const apps: FastifyInstance[] = [];

  afterEach(async () => {
    await Promise.all(apps.map((app) => app.close()));
    apps.length = 0;
  });

  test("saves UTM data from Mini App start_param during auth", async () => {
    const referenceNow = new Date("2026-06-26T12:00:00.000Z");
    const usersRepository = createUsersRepositoryStub();
    const app = buildApp({
      config: testConfig,
      usersRepository,
      carsCatalogRepository: stubCarsCatalogRepository,
      now: () => referenceNow
    });
    await app.ready();
    apps.push(app);
    const payload = Buffer.from(
      JSON.stringify({
        s: "telegram_ads",
        m: "cpc",
        c: "june_launch",
        cn: "creative_1",
        t: "cars"
      })
    ).toString("base64url");
    const initData = buildSignedInitData(
      {
        user: JSON.stringify({
          id: 42,
          first_name: "Ivan",
          username: "ivan"
        }),
        auth_date: String(Math.floor(referenceNow.getTime() / 1000)),
        start_param: payload
      },
      testConfig.botToken
    );

    const response = await app.inject({
      method: "POST",
      url: "/v1/auth/telegram",
      payload: { initData }
    });

    expect(response.statusCode).toBe(200);
    expect(usersRepository.setUtmIfNotSet).toHaveBeenCalledWith("42", {
      utmSource: "telegram_ads",
      utmMedium: "cpc",
      utmCampaign: "june_launch",
      utmContent: "creative_1",
      utmTerm: "cars"
    });
  });
});

const testConfig: AppConfig = {
  botToken: "test-bot-token",
  jwtSecret: "test-jwt-secret",
  mongoUri: "mongodb://localhost:27017/test",
  telegramWebhookSecret: "test-webhook-secret",
  miniAppUrl: undefined,
  env: "stage",
  port: 0
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

function createUsersRepositoryStub(): UsersRepository {
  const user: AppUser = {
    userId: "usr_42",
    telegramUserId: "42",
    firstName: "Ivan",
    username: "ivan",
    ownedCarIds: [],
    garageRevision: 0,
    raceCoinsBalance: 0
  };

  return {
    upsertTelegramUser: vi.fn(async () => user),
    setUtmIfNotSet: vi.fn(async () => undefined)
  } as unknown as UsersRepository;
}

function buildSignedInitData(
  params: Record<string, string>,
  botToken: string
): string {
  const searchParams = new URLSearchParams(params);
  const dataCheckString = Array.from(searchParams.entries())
    .sort(([leftKey, leftValue], [rightKey, rightValue]) => {
      if (leftKey !== rightKey) return leftKey < rightKey ? -1 : 1;
      if (leftValue !== rightValue) return leftValue < rightValue ? -1 : 1;
      return 0;
    })
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();
  const hash = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");

  searchParams.set("hash", hash);
  return searchParams.toString();
}

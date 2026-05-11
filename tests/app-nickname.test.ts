import { afterEach, describe, expect, test } from "vitest";
import type { FastifyInstance } from "fastify";

import { buildApp } from "../src/app.js";
import type { AppConfig } from "../src/config/config.js";
import type { CatalogCar, CarsCatalogRepository } from "../src/modules/cars-catalog/cars-catalog-repository.js";
import type { AppUser, UserUtmData, UsersRepository, UtmSourceCount } from "../src/modules/users/users-repository.js";

describe("PUT /v1/profile/nick", () => {
  const apps: FastifyInstance[] = [];

  afterEach(async () => {
    await Promise.all(apps.map((app) => app.close()));
    apps.length = 0;
  });

  test("lets a user change an existing nick for free without spending race coins", async () => {
    const user: AppUser = buildUser({
      username: "Pilot42",
      nick: "OldPilot",
      nickNormalized: "oldpilot",
      raceCoinsBalance: 0
    });
    const { app, token } = await buildNickTestApp([user]);
    apps.push(app);

    const response = await app.inject({
      method: "PUT",
      url: "/v1/profile/nick",
      headers: { authorization: `Bearer ${token}` },
      payload: { nick: "CoolPilot" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      nick: "CoolPilot",
      raceCoinsBalance: 0,
      nickChangePrice: 0
    });
  });

  test("lets a user change their nick to the Telegram username", async () => {
    const user: AppUser = buildUser({
      username: "Pilot42",
      nick: "CoolPilot",
      nickNormalized: "coolpilot",
      raceCoinsBalance: 0
    });
    const { app, token } = await buildNickTestApp([user]);
    apps.push(app);

    const response = await app.inject({
      method: "PUT",
      url: "/v1/profile/nick",
      headers: { authorization: `Bearer ${token}` },
      payload: { nick: "Pilot42" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      nick: "Pilot42",
      raceCoinsBalance: 0,
      nickChangePrice: 0
    });
  });

  test("allows browser preflight for the nick PUT endpoint", async () => {
    const user: AppUser = buildUser();
    const { app } = await buildNickTestApp([user]);
    apps.push(app);

    const response = await app.inject({
      method: "OPTIONS",
      url: "/v1/profile/nick",
      headers: {
        origin: "https://thelightone.github.io",
        "access-control-request-method": "PUT",
        "access-control-request-headers": "authorization,content-type"
      }
    });

    expect(response.statusCode).toBe(204);
    expect(response.headers["access-control-allow-methods"]).toContain("PUT");
    expect(response.headers["access-control-allow-headers"]).toContain("authorization");
    expect(response.headers["access-control-allow-headers"]).toContain("content-type");
  });
});

async function buildNickTestApp(initialUsers: AppUser[]) {
  const app = buildApp({
    config: testConfig,
    usersRepository: new InMemoryUsersRepository(initialUsers),
    carsCatalogRepository: stubCarsCatalogRepository
  });
  await app.ready();

  return {
    app,
    token: app.jwt.sign({
      sub: initialUsers[0]?.userId ?? "usr_1",
      telegramUserId: initialUsers[0]?.telegramUserId ?? "1"
    })
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

class InMemoryUsersRepository implements UsersRepository {
  private readonly users = new Map<string, AppUser>();

  constructor(initialUsers: AppUser[]) {
    for (const user of initialUsers) {
      this.users.set(user.userId, { ...user, ownedCarIds: [...user.ownedCarIds] });
    }
  }

  async upsertTelegramUser(): Promise<AppUser> {
    throw new Error("not used");
  }

  async getUserById(userId: string): Promise<AppUser | null> {
    return this.clone(this.users.get(userId));
  }

  async getUserByNickNormalized(nickNormalized: string): Promise<AppUser | null> {
    for (const user of this.users.values()) {
      if (user.nickNormalized === nickNormalized) {
        return this.clone(user);
      }
    }
    return null;
  }

  async setInitialNick(
    userId: string,
    nick: string,
    nickNormalized: string
  ): Promise<AppUser | null> {
    const user = this.users.get(userId);
    if (!user || user.nickNormalized) {
      return null;
    }
    return this.updateNick(user, nick, nickNormalized);
  }

  async setNick(
    userId: string,
    nick: string,
    nickNormalized: string
  ): Promise<AppUser | null> {
    const user = this.users.get(userId);
    if (!user) {
      return null;
    }
    return this.updateNick(user, nick, nickNormalized);
  }

  async addRaceCoins(userId: string, amount: number): Promise<AppUser> {
    const user = this.requiredUser(userId);
    const updated = { ...user, raceCoinsBalance: user.raceCoinsBalance + amount };
    this.users.set(userId, updated);
    return this.clone(updated);
  }

  async spendRaceCoins(userId: string, amount: number): Promise<AppUser | null> {
    const user = this.users.get(userId);
    if (!user || user.raceCoinsBalance < amount) {
      return null;
    }
    const updated = { ...user, raceCoinsBalance: user.raceCoinsBalance - amount };
    this.users.set(userId, updated);
    return this.clone(updated);
  }

  async addOwnedCar(userId: string, carId: string): Promise<AppUser | null> {
    const user = this.users.get(userId);
    if (!user) {
      return null;
    }
    const ownedCarIds = Array.from(new Set([...user.ownedCarIds, carId]));
    const updated = { ...user, ownedCarIds, garageRevision: user.garageRevision + 1 };
    this.users.set(userId, updated);
    return this.clone(updated);
  }

  async setUtmIfNotSet(): Promise<void> {}

  async getUserByTelegramId(telegramUserId: string): Promise<AppUser | null> {
    for (const user of this.users.values()) {
      if (user.telegramUserId === telegramUserId) {
        return this.clone(user);
      }
    }
    return null;
  }

  async getUserByUsername(username: string): Promise<AppUser | null> {
    for (const user of this.users.values()) {
      if (user.username === username) {
        return this.clone(user);
      }
    }
    return null;
  }

  async setRaceCoinsBalance(userId: string, amount: number): Promise<AppUser> {
    const user = this.requiredUser(userId);
    const updated = { ...user, raceCoinsBalance: amount };
    this.users.set(userId, updated);
    return this.clone(updated);
  }

  async getUserCount(): Promise<number> {
    return this.users.size;
  }

  async getTopUtmSources(): Promise<UtmSourceCount[]> {
    return [];
  }

  async getUtmSourcesSince(): Promise<UtmSourceCount[]> {
    return [];
  }

  async getAllUsers(): Promise<AppUser[]> {
    return Array.from(this.users.values(), (user) => this.clone(user));
  }

  private updateNick(
    user: AppUser,
    nick: string,
    nickNormalized: string
  ): AppUser {
    const updated = { ...user, nick, nickNormalized };
    this.users.set(user.userId, updated);
    return this.clone(updated);
  }

  private requiredUser(userId: string): AppUser {
    const user = this.users.get(userId);
    if (!user) {
      throw new Error(`User not found: ${userId}`);
    }
    return user;
  }

  private clone(user: AppUser): AppUser;
  private clone(user: AppUser | undefined): AppUser | null;
  private clone(user: AppUser | undefined): AppUser | null {
    if (!user) {
      return null;
    }
    return { ...user, ownedCarIds: [...user.ownedCarIds], utm: cloneUtm(user.utm) };
  }
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

function cloneUtm(utm: UserUtmData | undefined): UserUtmData | undefined {
  return utm ? { ...utm } : undefined;
}

import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import type { AppUser } from "../../src/modules/users/users-repository.js";
import { buildApp } from "../../src/app.js";
import type { UsersRepository } from "../../src/modules/users/users-repository.js";

const botToken = "123456:test-token";

describe("POST /v1/auth/telegram", () => {
  it("validates Telegram init data and returns a starter profile", async () => {
    const users = new InMemoryUsersRepository();
    const app = buildApp({
      config: testConfig(),
      usersRepository: users,
      now: () => new Date("2026-04-10T10:00:00.000Z")
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/auth/telegram",
      payload: {
        initData: signedInitData({
          authDate: 1775815140,
          user: {
            id: 123456789,
            first_name: "Ivan",
            username: "ivan_dev"
          }
        })
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      accessToken: expect.any(String),
      expiresInSec: 43200,
      profile: {
        userId: "usr_123456789",
        telegramUserId: "123456789",
        firstName: "Ivan",
        username: "ivan_dev",
        ownedCarIds: ["starter_car"],
        garageRevision: 1
      }
    });
  });

  it("rejects invalid Telegram init data", async () => {
    const app = buildApp({
      config: testConfig(),
      usersRepository: new InMemoryUsersRepository(),
      now: () => new Date("2026-04-10T10:00:00.000Z")
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/auth/telegram",
      payload: {
        initData: "auth_date=1775815140&hash=bad"
      }
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      code: "INIT_DATA_INVALID"
    });
  });
});

class InMemoryUsersRepository implements UsersRepository {
  private readonly usersByTelegramId = new Map<string, AppUser>();
  private readonly usersById = new Map<string, AppUser>();

  async upsertTelegramUser(input: {
    telegramUserId: string;
    firstName?: string;
    lastName?: string;
    username?: string;
    languageCode?: string;
    isPremium?: boolean;
    photoUrl?: string;
  }): Promise<AppUser> {
    const existing = this.usersByTelegramId.get(input.telegramUserId);
    const user: AppUser =
      existing ??
      {
        userId: `usr_${input.telegramUserId}`,
        telegramUserId: input.telegramUserId,
        ownedCarIds: [],
        garageRevision: 0
      };

    const updated = {
      ...user,
      firstName: input.firstName,
      lastName: input.lastName,
      username: input.username,
      languageCode: input.languageCode,
      isPremium: input.isPremium,
      photoUrl: input.photoUrl
    };

    this.usersByTelegramId.set(input.telegramUserId, updated);
    this.usersById.set(updated.userId, updated);
    return updated;
  }

  async getUserById(userId: string): Promise<AppUser | null> {
    return this.usersById.get(userId) ?? null;
  }
}

function testConfig() {
  return {
    botToken,
    jwtSecret: "jwt-secret",
    mongoUri: "mongodb://localhost:27017/mafinki",
    telegramWebhookSecret: "webhook-secret",
    env: "dev" as const,
    port: 3000
  };
}

function signedInitData(input: {
  authDate: number;
  user: Record<string, unknown>;
}): string {
  const params = new URLSearchParams({
    auth_date: String(input.authDate),
    user: JSON.stringify(input.user)
  });

  const dataCheckString = Array.from(params.entries())
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();
  const hash = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
  params.set("hash", hash);

  return params.toString();
}

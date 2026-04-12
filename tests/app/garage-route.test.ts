import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import { buildApp } from "../../src/app.js";
import type { AppUser, UsersRepository } from "../../src/modules/users/users-repository.js";

const botToken = "123456:test-token";

describe("GET /v1/garage", () => {
  it("returns server-side garage for the authenticated user", async () => {
    const users = new InMemoryUsersRepository();
    const app = buildApp({
      config: testConfig(),
      usersRepository: users,
      now: () => new Date("2026-04-10T10:00:00.000Z")
    });

    const authResponse = await app.inject({
      method: "POST",
      url: "/v1/auth/telegram",
      payload: {
        initData: signedInitData({
          authDate: 1775815140,
          user: { id: 123456789, first_name: "Ivan" }
        })
      }
    });
    const { accessToken } = authResponse.json() as { accessToken: string };

    const garageResponse = await app.inject({
      method: "GET",
      url: "/v1/garage",
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });

    expect(garageResponse.statusCode).toBe(200);
    expect(garageResponse.json()).toEqual({
      garageRevision: 1,
      cars: [
        {
          carId: "starter_car",
          title: "Starter Car",
          owned: true,
          price: { currency: "XTR", amount: 0 },
          canBuy: false
        },
        {
          carId: "second_car",
          title: "Second Car",
          owned: false,
          price: { currency: "XTR", amount: 250 },
          canBuy: true
        }
      ]
    });
  });

  it("rejects requests without a bearer token", async () => {
    const app = buildApp({
      config: testConfig(),
      usersRepository: new InMemoryUsersRepository()
    });

    const response = await app.inject({
      method: "GET",
      url: "/v1/garage"
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ code: "UNAUTHORIZED" });
  });
});

class InMemoryUsersRepository implements UsersRepository {
  private readonly usersByTelegramId = new Map<string, AppUser>();
  private readonly usersById = new Map<string, AppUser>();

  async upsertTelegramUser(input: {
    telegramUserId: string;
    firstName?: string;
  }): Promise<AppUser> {
    const existing = this.usersByTelegramId.get(input.telegramUserId);
    const user: AppUser =
      existing ??
      {
        userId: `usr_${input.telegramUserId}`,
        telegramUserId: input.telegramUserId,
        firstName: input.firstName,
        ownedCarIds: [],
        garageRevision: 0
      };

    this.save(user);
    return user;
  }

  async getUserById(userId: string): Promise<AppUser | null> {
    return this.usersById.get(userId) ?? null;
  }

  private save(user: AppUser): void {
    this.usersByTelegramId.set(user.telegramUserId, user);
    this.usersById.set(user.userId, user);
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

import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import { buildApp } from "../../src/app.js";
import type { PurchaseIntentRecord, PurchasesRepository } from "../../src/modules/payments/purchases-repository.js";
import type { AppUser, UsersRepository } from "../../src/modules/users/users-repository.js";

const botToken = "123456:test-token";

describe("POST /v1/purchases/car-intents", () => {
  it("creates a car purchase intent using server-side catalog price", async () => {
    const purchases = new InMemoryPurchasesRepository();
    const app = buildApp({
      config: testConfig(),
      usersRepository: new InMemoryUsersRepository(),
      purchasesRepository: purchases,
      createInvoiceLink: async (input) => `https://t.me/invoice/${input.purchaseId}`,
      now: () => new Date("2026-04-10T10:00:00.000Z")
    });
    const accessToken = await login(app);

    const response = await app.inject({
      method: "POST",
      url: "/v1/purchases/car-intents",
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { carId: "second_car" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      purchaseId: "pur_1",
      status: "invoice_ready",
      invoiceUrl: "https://t.me/invoice/pur_1",
      expiresAt: "2026-04-10T10:15:00.000Z",
      price: { currency: "XTR", amount: 250 }
    });
  });

  it("returns the existing active intent on retry", async () => {
    const purchases = new InMemoryPurchasesRepository();
    const app = buildApp({
      config: testConfig(),
      usersRepository: new InMemoryUsersRepository(),
      purchasesRepository: purchases,
      createInvoiceLink: async (input) => `https://t.me/invoice/${input.purchaseId}`,
      now: () => new Date("2026-04-10T10:00:00.000Z")
    });
    const accessToken = await login(app);

    await app.inject({
      method: "POST",
      url: "/v1/purchases/car-intents",
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { carId: "second_car" }
    });
    const retryResponse = await app.inject({
      method: "POST",
      url: "/v1/purchases/car-intents",
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { carId: "second_car" }
    });

    expect(retryResponse.statusCode).toBe(200);
    expect(retryResponse.json()).toMatchObject({
      purchaseId: "pur_1",
      invoiceUrl: "https://t.me/invoice/pur_1"
    });
    expect(purchases.createdCount).toBe(1);
  });
});

class InMemoryUsersRepository implements UsersRepository {
  private readonly usersByTelegramId = new Map<string, AppUser>();
  private readonly usersById = new Map<string, AppUser>();

  async upsertTelegramUser(input: { telegramUserId: string; firstName?: string }): Promise<AppUser> {
    const user =
      this.usersByTelegramId.get(input.telegramUserId) ??
      ({
        userId: `usr_${input.telegramUserId}`,
        telegramUserId: input.telegramUserId,
        firstName: input.firstName,
        ownedCarIds: ["starter_car"],
        selectedCarId: "starter_car",
        garageRevision: 1
      } satisfies AppUser);
    this.usersByTelegramId.set(user.telegramUserId, user);
    this.usersById.set(user.userId, user);
    return user;
  }

  async getUserById(userId: string): Promise<AppUser | null> {
    return this.usersById.get(userId) ?? null;
  }
}

class InMemoryPurchasesRepository implements PurchasesRepository {
  public createdCount = 0;
  private activeIntent: PurchaseIntentRecord | null = null;

  async findActiveIntent(input: { userId: string; carId: string }): Promise<PurchaseIntentRecord | null> {
    return this.activeIntent?.userId === input.userId && this.activeIntent.carId === input.carId
      ? this.activeIntent
      : null;
  }

  async createIntent(input: Omit<PurchaseIntentRecord, "purchaseId" | "invoicePayload" | "status" | "isActiveIntent">): Promise<PurchaseIntentRecord> {
    this.createdCount += 1;
    this.activeIntent = {
      ...input,
      purchaseId: `pur_${this.createdCount}`,
      invoicePayload: `pur_${this.createdCount}`,
      status: "invoice_ready",
      isActiveIntent: true
    };
    return this.activeIntent;
  }

  async setInvoiceUrl(purchaseId: string, invoiceUrl: string): Promise<void> {
    if (this.activeIntent?.purchaseId === purchaseId) {
      this.activeIntent = { ...this.activeIntent, invoiceUrl };
    }
  }

  async expireIntent(purchaseId: string): Promise<void> {
    if (this.activeIntent?.purchaseId === purchaseId) {
      this.activeIntent = {
        ...this.activeIntent,
        status: "expired",
        isActiveIntent: false
      };
    }
  }
}

async function login(app: ReturnType<typeof buildApp>): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/v1/auth/telegram",
    payload: {
      initData: signedInitData({
        authDate: 1775815140,
        user: { id: 123456789, first_name: "Ivan" }
      })
    }
  });
  return (response.json() as { accessToken: string }).accessToken;
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

import { describe, expect, it, vi } from "vitest";

import {
  buildMongoBackedApp,
  type MongoCollectionFactory
} from "../../src/runtime.js";

describe("buildMongoBackedApp", () => {
  it("registers the Telegram webhook route with a default handler", async () => {
    const app = buildMongoBackedApp({
      config: testConfig(),
      db: fakeDb() as unknown as MongoCollectionFactory
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/telegram/webhook",
      headers: {
        "x-telegram-bot-api-secret-token": "webhook-secret"
      },
      payload: { update_id: 1 }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
  });

  it("uses Mongo collections for app repositories", async () => {
    const db = fakeDb();

    buildMongoBackedApp({
      config: testConfig(),
      db: db as unknown as MongoCollectionFactory
    });

    expect(db.collection).toHaveBeenCalledWith("users");
    expect(db.collection).toHaveBeenCalledWith("purchases");
  });
});

function fakeDb() {
  return {
    collection: vi.fn(() => ({
      findOne: vi.fn(),
      findOneAndUpdate: vi.fn(),
      insertOne: vi.fn(),
      updateOne: vi.fn()
    }))
  };
}

function testConfig() {
  return {
    botToken: "123456:test-token",
    jwtSecret: "jwt-secret",
    mongoUri: "mongodb://localhost:27017/mafinki",
    telegramWebhookSecret: "webhook-secret",
    env: "dev" as const,
    port: 3000
  };
}

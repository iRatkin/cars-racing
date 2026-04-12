import { describe, expect, it } from "vitest";

import { loadConfigFromEnv } from "../../src/config/config.js";

describe("config", () => {
  it("loads required environment values", () => {
    const config = loadConfigFromEnv({
      BOT_TOKEN: "123:token",
      JWT_SECRET: "jwt-secret",
      MONGO_URI: "mongodb://localhost:27017/mafinki",
      TELEGRAM_WEBHOOK_SECRET: "webhook-secret"
    });

    expect(config).toEqual({
      botToken: "123:token",
      jwtSecret: "jwt-secret",
      mongoUri: "mongodb://localhost:27017/mafinki",
      telegramWebhookSecret: "webhook-secret",
      env: "dev",
      port: 3000
    });
  });

  it("fails fast when required environment values are missing", () => {
    expect(() => loadConfigFromEnv({})).toThrow(/BOT_TOKEN/);
  });

  it("rejects an invalid port", () => {
    expect(() =>
      loadConfigFromEnv({
        BOT_TOKEN: "123:token",
        JWT_SECRET: "jwt-secret",
        MONGO_URI: "mongodb://localhost:27017/mafinki",
        TELEGRAM_WEBHOOK_SECRET: "webhook-secret",
        PORT: "not-a-port"
      })
    ).toThrow(/PORT/);
  });
});

import { describe, expect, it } from "vitest";

import { buildApp } from "../../src/app.js";

describe("health endpoint", () => {
  it("enables Fastify logging when runtime config is provided", async () => {
    const app = buildApp({
      config: {
        botToken: "123456:test-token",
        jwtSecret: "jwt-secret",
        mongoUri: "mongodb://localhost:27017/mafinki",
        telegramWebhookSecret: "webhook-secret",
        env: "dev",
        port: 3000
      }
    });

    expect(app.log.level).toBe("info");

    await app.close();
  });

  it("returns ok status", async () => {
    const app = buildApp();

    const response = await app.inject({
      method: "GET",
      url: "/health"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
  });
});

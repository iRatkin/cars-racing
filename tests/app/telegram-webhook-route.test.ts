import { describe, expect, it, vi } from "vitest";

import { buildApp } from "../../src/app.js";

describe("POST /v1/telegram/webhook", () => {
  it("rejects requests with an invalid Telegram webhook secret", async () => {
    const app = buildApp({
      config: testConfig(),
      handleTelegramWebhook: vi.fn()
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/telegram/webhook",
      headers: {
        "x-telegram-bot-api-secret-token": "wrong-secret"
      },
      payload: { update_id: 1 }
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ code: "INVALID_WEBHOOK_SECRET" });
  });

  it("passes valid webhook updates to the injected handler", async () => {
    const handleTelegramWebhook = vi.fn(async () => undefined);
    const app = buildApp({
      config: testConfig(),
      handleTelegramWebhook
    });
    const update = {
      update_id: 1,
      pre_checkout_query: {
        id: "pcq_1",
        from: { id: 123456789 },
        currency: "XTR",
        total_amount: 250,
        invoice_payload: "pur_1"
      }
    };

    const response = await app.inject({
      method: "POST",
      url: "/v1/telegram/webhook",
      headers: {
        "x-telegram-bot-api-secret-token": "webhook-secret"
      },
      payload: update
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
    expect(handleTelegramWebhook).toHaveBeenCalledWith(update);
  });
});

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

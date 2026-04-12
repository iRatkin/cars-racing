import { describe, expect, it } from "vitest";

import { createMockAppConfig, createMockProcessEnv, MOCK_PROCESS_ENV } from "./mock-env.js";

describe("mock-env", () => {
  it("exposes stable mock process env", () => {
    expect(MOCK_PROCESS_ENV.BOT_TOKEN).toBe("123456:test-token");
    expect(MOCK_PROCESS_ENV.JWT_SECRET).toBe("jwt-secret");
  });

  it("createMockProcessEnv merges overrides", () => {
    expect(createMockProcessEnv({ PORT: "4000" }).PORT).toBe("4000");
    expect(createMockProcessEnv({ PORT: "4000" }).BOT_TOKEN).toBe("123456:test-token");
  });

  it("createMockAppConfig parses mock env", () => {
    const config = createMockAppConfig();
    expect(config.port).toBe(3000);
    expect(config.env).toBe("dev");
    expect(config.telegramWebhookSecret).toBe("webhook-secret");
  });
});

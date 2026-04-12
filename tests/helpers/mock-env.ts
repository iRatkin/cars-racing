import { loadConfigFromEnv, type AppConfig } from "../../src/config/config.js";

export const MOCK_PROCESS_ENV: NodeJS.ProcessEnv = {
  BOT_TOKEN: "123456:test-token",
  JWT_SECRET: "jwt-secret",
  MONGO_URI: "mongodb://localhost:27017/mafinki",
  TELEGRAM_WEBHOOK_SECRET: "webhook-secret",
  NODE_ENV: "dev",
  PORT: "3000"
};

export function createMockProcessEnv(
  overrides?: Partial<NodeJS.ProcessEnv>
): NodeJS.ProcessEnv {
  return { ...MOCK_PROCESS_ENV, ...overrides };
}

export function createMockAppConfig(overrides?: Partial<NodeJS.ProcessEnv>): AppConfig {
  return loadConfigFromEnv(createMockProcessEnv(overrides));
}

import { parseAdminTelegramIds } from "../modules/admin/admin-config.js";

export interface AppConfig {
  botToken: string;
  jwtSecret: string;
  mongoUri: string;
  telegramWebhookSecret: string;
  miniAppUrl: string | undefined;
  env: "dev" | "stage" | "prod";
  port: number;
  adminConfig?: AdminConfig;
}

export interface AdminConfig {
  adminBotToken: string;
  adminWebhookSecret: string;
  adminTelegramIds: string[];
}

type EnvName = AppConfig["env"];

const validEnvs = new Set<EnvName>(["dev", "stage", "prod"]);

const envAliases: Record<string, EnvName> = {
  production: "prod",
  development: "dev",
  staging: "stage",
};

export function loadConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): AppConfig {
  const botToken = requireEnv(env, "BOT_TOKEN");
  const jwtSecret = requireEnv(env, "JWT_SECRET");
  const mongoUri = requireEnv(env, "MONGO_URI");
  const telegramWebhookSecret = requireEnv(env, "TELEGRAM_WEBHOOK_SECRET");

  const adminBotToken = env.ADMIN_BOT_TOKEN;
  const adminWebhookSecret = env.ADMIN_WEBHOOK_SECRET;
  const adminTelegramIdsRaw = env.ADMIN_TELEGRAM_IDS;

  let adminConfig: AdminConfig | undefined;
  if (adminBotToken && adminWebhookSecret && adminTelegramIdsRaw) {
    adminConfig = {
      adminBotToken,
      adminWebhookSecret,
      adminTelegramIds: parseAdminTelegramIds(adminTelegramIdsRaw),
    };
  }

  return {
    botToken,
    jwtSecret,
    mongoUri,
    telegramWebhookSecret,
    miniAppUrl: env.MINI_APP_URL || "https://thelightone.github.io/DriftHTML/",
    env: parseEnvName(env.NODE_ENV),
    port: parsePort(env.PORT),
    adminConfig,
  };
}

function requireEnv(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key];
  if (!value) {
    throw new Error(`Missing required env var: ${key}`);
  }
  return value;
}

function parseEnvName(value: string | undefined): EnvName {
  if (!value) {
    return "dev";
  }
  if (validEnvs.has(value as EnvName)) {
    return value as EnvName;
  }
  const alias = envAliases[value];
  if (alias) {
    return alias;
  }
  throw new Error(`Invalid NODE_ENV: ${value}`);
}

function parsePort(value: string | undefined): number {
  if (!value) {
    return 3000;
  }

  const port = Number(value);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid PORT: ${value}`);
  }
  return port;
}

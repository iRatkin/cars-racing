import "dotenv/config";
import { MongoClient } from "mongodb";

import { loadConfigFromEnv } from "../config/config.js";
import {
  MongoJobEventsRepository,
  type MongoJobEventDocument
} from "../infra/mongo/job-events-repository.js";
import {
  MongoSeasonEntriesRepository,
  type MongoSeasonEntryDocument
} from "../infra/mongo/season-entries-repository.js";
import {
  MongoSeasonsRepository,
  type MongoSeasonDocument
} from "../infra/mongo/seasons-repository.js";
import {
  MongoUsersRepository,
  type MongoUserDocument
} from "../infra/mongo/users-repository.js";
import { createSeasonAutomationService } from "../modules/season-automation/season-automation-service.js";
import { sendTelegramMessage } from "../modules/telegram/invoice-link.js";

async function main(): Promise<void> {
  const config = loadConfigFromEnv();
  const mongoClient = new MongoClient(config.mongoUri);
  await mongoClient.connect();

  try {
    const db = mongoClient.db();
    const service = createSeasonAutomationService({
      seasonsRepository: new MongoSeasonsRepository(
        db.collection<MongoSeasonDocument>("seasons")
      ),
      seasonEntriesRepository: new MongoSeasonEntriesRepository(
        db.collection<MongoSeasonEntryDocument>("seasonEntries")
      ),
      usersRepository: new MongoUsersRepository(
        db.collection<MongoUserDocument>("users")
      ),
      jobEventsRepository: new MongoJobEventsRepository(
        db.collection<MongoJobEventDocument>("jobEvents")
      ),
      adminTelegramIds: config.adminConfig?.adminTelegramIds ?? [],
      telegram: {
        sendPlayerMessage: ({ chatId, text }) =>
          sendTelegramMessage({ botToken: config.botToken }, { chatId, text }),
        sendAdminMessage: ({ chatId, text }) => {
          if (!config.adminConfig) {
            return Promise.resolve();
          }
          return sendTelegramMessage(
            { botToken: config.adminConfig.adminBotToken },
            { chatId, text }
          );
        }
      },
      logger: consoleLogger
    });

    await service.runOnce(new Date());
  } finally {
    await mongoClient.close();
  }
}

const consoleLogger = {
  info(obj: Record<string, unknown>, msg: string): void {
    console.log(JSON.stringify({ level: "info", msg, ...obj }));
  },
  warn(obj: Record<string, unknown>, msg: string): void {
    console.warn(JSON.stringify({ level: "warn", msg, ...obj }));
  },
  error(obj: Record<string, unknown>, msg: string): void {
    console.error(JSON.stringify({ level: "error", msg, ...obj }));
  }
};

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

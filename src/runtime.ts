import type { Collection, Document, MongoClient } from "mongodb";

import { buildApp, type AppDependencies } from "./app.js";
import type { AppConfig } from "./config/config.js";
import {
  MongoCarsCatalogRepository,
  type MongoCarDocument
} from "./infra/mongo/cars-catalog-repository.js";
import {
  MongoPurchasesRepository,
  type MongoPurchaseDocument
} from "./infra/mongo/purchases-repository.js";
import {
  MongoRaceRunsRepository,
  type MongoRaceRunDocument
} from "./infra/mongo/race-runs-repository.js";
import {
  MongoSeasonEntriesRepository,
  type MongoSeasonEntryDocument
} from "./infra/mongo/season-entries-repository.js";
import {
  MongoSeasonsRepository,
  type MongoSeasonDocument
} from "./infra/mongo/seasons-repository.js";
import {
  MongoUsersRepository,
  type MongoUserDocument
} from "./infra/mongo/users-repository.js";
import {
  createTelegramInvoiceLink,
  type TelegramFetch
} from "./modules/telegram/invoice-link.js";
import { createWebhookHandler } from "./modules/telegram/webhook-handler.js";
import { createAdminBotHandler } from "./modules/admin/admin-bot-handler.js";

export interface MongoCollectionFactory {
  collection<TSchema extends Document = Document>(name: string): Collection<TSchema>;
}

export interface BuildMongoBackedAppInput {
  config: AppConfig;
  db: MongoCollectionFactory;
  mongoClient: MongoClient;
  fetchImpl?: TelegramFetch;
  handleTelegramWebhook?: AppDependencies["handleTelegramWebhook"];
}

export function buildMongoBackedApp(input: BuildMongoBackedAppInput) {
  const usersRepository = new MongoUsersRepository(
    input.db.collection<MongoUserDocument>("users")
  );
  const carsCatalogRepository = new MongoCarsCatalogRepository(
    input.db.collection<MongoCarDocument>("carsCatalog")
  );
  const purchasesRepository = new MongoPurchasesRepository(
    input.db.collection<MongoPurchaseDocument>("purchases")
  );
  const seasonsRepository = new MongoSeasonsRepository(
    input.db.collection<MongoSeasonDocument>("seasons")
  );
  const seasonEntriesRepository = new MongoSeasonEntriesRepository(
    input.db.collection<MongoSeasonEntryDocument>("seasonEntries")
  );
  const raceRunsRepository = new MongoRaceRunsRepository(
    input.db.collection<MongoRaceRunDocument>("raceRuns")
  );

  const telegramOptions = {
    botToken: input.config.botToken,
    fetchImpl: input.fetchImpl
  };

  const webhookHandler = createWebhookHandler({
    purchasesRepository,
    usersRepository,
    telegramOptions,
    miniAppUrl: input.config.miniAppUrl
  });

  let adminBotHandler: AppDependencies["adminHandleTelegramWebhook"] | undefined;
  if (input.config.adminConfig) {
    adminBotHandler = createAdminBotHandler({
      usersRepository,
      carsCatalogRepository,
      seasonsRepository,
      purchasesRepository,
      telegramOptions: {
        botToken: input.config.adminConfig.adminBotToken,
        fetchImpl: input.fetchImpl
      },
      allowedTelegramIds: input.config.adminConfig.adminTelegramIds
    });
  }

  return buildApp({
    config: input.config,
    usersRepository,
    purchasesRepository,
    carsCatalogRepository,
    seasonsRepository,
    seasonEntriesRepository,
    raceRunsRepository,
    mongoClient: input.mongoClient,
    createInvoiceLink: (invoiceInput) =>
      createTelegramInvoiceLink(telegramOptions, invoiceInput),
    handleTelegramWebhook: input.handleTelegramWebhook ?? webhookHandler,
    adminHandleTelegramWebhook: adminBotHandler,
  });
}

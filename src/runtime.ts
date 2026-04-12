import type { Collection, Document } from "mongodb";

import { buildApp, type AppDependencies } from "./app.js";
import type { AppConfig } from "./config/config.js";
import {
  MongoPurchasesRepository,
  type MongoPurchaseDocument
} from "./infra/mongo/purchases-repository.js";
import {
  MongoUsersRepository,
  type MongoUserDocument
} from "./infra/mongo/users-repository.js";
import {
  createTelegramInvoiceLink,
  type TelegramFetch
} from "./modules/telegram/invoice-link.js";

export interface MongoCollectionFactory {
  collection<TSchema extends Document = Document>(name: string): Collection<TSchema>;
}

export interface BuildMongoBackedAppInput {
  config: AppConfig;
  db: MongoCollectionFactory;
  fetchImpl?: TelegramFetch;
  handleTelegramWebhook?: AppDependencies["handleTelegramWebhook"];
}

export function buildMongoBackedApp(input: BuildMongoBackedAppInput) {
  const usersRepository = new MongoUsersRepository(
    input.db.collection<MongoUserDocument>("users")
  );
  const purchasesRepository = new MongoPurchasesRepository(
    input.db.collection<MongoPurchaseDocument>("purchases")
  );

  return buildApp({
    config: input.config,
    usersRepository,
    purchasesRepository,
    createInvoiceLink: (invoiceInput) =>
      createTelegramInvoiceLink(
        { botToken: input.config.botToken, fetchImpl: input.fetchImpl },
        invoiceInput
      ),
    handleTelegramWebhook: input.handleTelegramWebhook ?? ignoreTelegramWebhook
  });
}

async function ignoreTelegramWebhook(): Promise<void> {
  return undefined;
}

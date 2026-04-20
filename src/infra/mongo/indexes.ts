export type IndexDirection = 1 | -1;

export type IndexKeys = Readonly<Record<string, IndexDirection>>;

export interface IndexOptions {
  name: string;
  unique?: boolean;
  partialFilterExpression?: Readonly<Record<string, unknown>>;
}

export interface CollectionIndexDefinition {
  keys: IndexKeys;
  options: IndexOptions;
}

export interface MongoIndexDatabase {
  collection(name: string): {
    createIndex(keys: IndexKeys, options: IndexOptions): Promise<unknown>;
  };
}

export const usersIndexes = [
  {
    keys: { telegramUserId: 1 },
    options: {
      name: "users_telegramUserId_unique",
      unique: true
    }
  },
  {
    keys: { username: 1 },
    options: {
      name: "users_username",
      partialFilterExpression: { username: { $type: "string" } }
    }
  },
  {
    keys: { utmSource: 1 },
    options: {
      name: "users_utmSource",
      partialFilterExpression: { utmSource: { $type: "string" } }
    }
  }
] as const satisfies readonly CollectionIndexDefinition[];

export const carsCatalogIndexes = [
  {
    keys: { carId: 1 },
    options: {
      name: "carsCatalog_carId_unique",
      unique: true
    }
  },
  {
    keys: { active: 1, sortOrder: 1 },
    options: {
      name: "carsCatalog_active_sortOrder"
    }
  }
] as const satisfies readonly CollectionIndexDefinition[];

export const purchasesIndexes = [
  {
    keys: { invoicePayload: 1 },
    options: {
      name: "purchases_invoicePayload_unique",
      unique: true
    }
  },
  {
    keys: { telegramPaymentChargeId: 1 },
    options: {
      name: "purchases_telegramPaymentChargeId_unique",
      partialFilterExpression: {
        telegramPaymentChargeId: { $type: "string" }
      },
      unique: true
    }
  },
  {
    keys: { userId: 1, createdAt: -1 },
    options: {
      name: "purchases_userId_createdAt"
    }
  },
  {
    keys: { userId: 1, bundleId: 1, isActiveIntent: 1 },
    options: {
      name: "purchases_activeIntent_unique",
      partialFilterExpression: { isActiveIntent: true },
      unique: true
    }
  }
] as const satisfies readonly CollectionIndexDefinition[];

export const seasonsIndexes = [
  {
    keys: { seasonId: 1 },
    options: {
      name: "seasons_seasonId_unique",
      unique: true
    }
  },
  {
    keys: { endsAt: 1, startsAt: 1 },
    options: {
      name: "seasons_endsAt_startsAt"
    }
  }
] as const satisfies readonly CollectionIndexDefinition[];

export const seasonEntriesIndexes = [
  {
    keys: { entryId: 1 },
    options: {
      name: "seasonEntries_entryId_unique",
      unique: true
    }
  },
  {
    keys: { seasonId: 1, userId: 1 },
    options: {
      name: "seasonEntries_seasonId_userId_unique",
      unique: true
    }
  },
  {
    keys: { seasonId: 1, bestScore: -1, createdAt: 1, userId: 1 },
    options: {
      name: "seasonEntries_seasonId_bestScore_createdAt_userId"
    }
  }
] as const satisfies readonly CollectionIndexDefinition[];

export const raceRunsIndexes = [
  {
    keys: { raceId: 1 },
    options: {
      name: "raceRuns_raceId_unique",
      unique: true
    }
  },
  {
    keys: { seasonId: 1, userId: 1, startedAt: -1 },
    options: {
      name: "raceRuns_seasonId_userId_startedAt"
    }
  }
] as const satisfies readonly CollectionIndexDefinition[];

export const seasonTrainingEntriesIndexes = [
  {
    keys: { entryId: 1 },
    options: {
      name: "seasonTrainingEntries_entryId_unique",
      unique: true
    }
  },
  {
    keys: { seasonId: 1, userId: 1 },
    options: {
      name: "seasonTrainingEntries_seasonId_userId_unique",
      unique: true
    }
  },
  {
    keys: { seasonId: 1, bestScore: -1, createdAt: 1, userId: 1 },
    options: {
      name: "seasonTrainingEntries_seasonId_bestScore_createdAt_userId"
    }
  }
] as const satisfies readonly CollectionIndexDefinition[];

export const paymentEventsIndexes = [
  {
    keys: { telegramUpdateId: 1 },
    options: {
      name: "paymentEvents_telegramUpdateId_unique",
      unique: true
    }
  },
  {
    keys: { preCheckoutQueryId: 1 },
    options: {
      name: "paymentEvents_preCheckoutQueryId_unique",
      partialFilterExpression: { preCheckoutQueryId: { $type: "string" } },
      unique: true
    }
  },
  {
    keys: { telegramPaymentChargeId: 1 },
    options: {
      name: "paymentEvents_telegramPaymentChargeId_unique",
      partialFilterExpression: {
        telegramPaymentChargeId: { $type: "string" }
      },
      unique: true
    }
  },
  {
    keys: { purchaseId: 1 },
    options: {
      name: "paymentEvents_purchaseId"
    }
  }
] as const satisfies readonly CollectionIndexDefinition[];

export async function ensureMongoIndexes(db: MongoIndexDatabase): Promise<void> {
  await createCollectionIndexes(db, "users", usersIndexes);
  await createCollectionIndexes(db, "carsCatalog", carsCatalogIndexes);
  await createCollectionIndexes(db, "purchases", purchasesIndexes);
  await createCollectionIndexes(db, "paymentEvents", paymentEventsIndexes);
  await createCollectionIndexes(db, "seasons", seasonsIndexes);
  await createCollectionIndexes(db, "seasonEntries", seasonEntriesIndexes);
  await createCollectionIndexes(db, "raceRuns", raceRunsIndexes);
  await createCollectionIndexes(db, "seasonTrainingEntries", seasonTrainingEntriesIndexes);
}

async function createCollectionIndexes(
  db: MongoIndexDatabase,
  collectionName: string,
  indexes: readonly CollectionIndexDefinition[]
): Promise<void> {
  const collection = db.collection(collectionName);

  for (const index of indexes) {
    await collection.createIndex(index.keys, index.options);
  }
}

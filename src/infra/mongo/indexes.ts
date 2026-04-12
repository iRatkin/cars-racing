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
  }
] as const satisfies readonly CollectionIndexDefinition[];

export const carsCatalogIndexes = [
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
    keys: { userId: 1, carId: 1, isActiveIntent: 1 },
    options: {
      name: "purchases_activeIntent_unique",
      partialFilterExpression: { isActiveIntent: true },
      unique: true
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

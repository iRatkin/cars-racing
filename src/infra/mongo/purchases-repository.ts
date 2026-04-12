import { randomUUID } from "node:crypto";
import type { WithId } from "mongodb";

import type {
  CreatePurchaseIntentInput,
  PurchaseIntentRecord,
  PurchasesRepository
} from "../../modules/payments/purchases-repository.js";
import type { PurchaseStatus } from "../../modules/payments/purchase-domain.js";

export interface MongoPurchaseDocument {
  purchaseId: string;
  userId: string;
  telegramUserId: string;
  bundleId: string;
  status: PurchaseStatus;
  isActiveIntent: boolean;
  invoicePayload: string;
  invoiceUrl?: string;
  priceSnapshot: {
    currency: "XTR";
    amount: number;
  };
  coinsAmount: number;
  expiresAt: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface MongoPurchasesRepositoryOptions {
  createPurchaseId?: () => string;
}

export interface PurchasesCollection {
  findOne(
    filter: { userId: string; bundleId: string; isActiveIntent: true }
  ): Promise<WithId<MongoPurchaseDocument> | MongoPurchaseDocument | null>;
  insertOne(document: MongoPurchaseDocument): Promise<unknown>;
  updateOne(filter: { purchaseId: string }, update: Record<string, unknown>): Promise<unknown>;
}

export class MongoPurchasesRepository implements PurchasesRepository {
  private readonly createPurchaseId: () => string;

  constructor(
    private readonly collection: PurchasesCollection,
    options: MongoPurchasesRepositoryOptions = {}
  ) {
    this.createPurchaseId = options.createPurchaseId ?? (() => `pur_${randomUUID()}`);
  }

  async findActiveIntent(input: {
    userId: string;
    bundleId: string;
  }): Promise<PurchaseIntentRecord | null> {
    const document = await this.collection.findOne({
      userId: input.userId,
      bundleId: input.bundleId,
      isActiveIntent: true
    });

    return document ? mapPurchaseDocument(document) : null;
  }

  async createIntent(
    input: CreatePurchaseIntentInput
  ): Promise<PurchaseIntentRecord> {
    const now = new Date();
    const purchaseId = this.createPurchaseId();
    const document: MongoPurchaseDocument = {
      purchaseId,
      userId: input.userId,
      telegramUserId: input.telegramUserId,
      bundleId: input.bundleId,
      status: "invoice_ready",
      isActiveIntent: true,
      invoicePayload: purchaseId,
      priceSnapshot: input.priceSnapshot,
      coinsAmount: input.coinsAmount,
      expiresAt: input.expiresAt,
      createdAt: now,
      updatedAt: now
    };

    await this.collection.insertOne(document);
    return mapPurchaseDocument(document);
  }

  async setInvoiceUrl(purchaseId: string, invoiceUrl: string): Promise<void> {
    await this.collection.updateOne(
      { purchaseId },
      {
        $set: {
          invoiceUrl,
          status: "invoice_ready",
          updatedAt: new Date()
        }
      }
    );
  }

  async expireIntent(purchaseId: string): Promise<void> {
    await this.collection.updateOne(
      { purchaseId },
      {
        $set: {
          status: "expired",
          isActiveIntent: false,
          updatedAt: new Date()
        }
      }
    );
  }
}

function mapPurchaseDocument(
  document: WithId<MongoPurchaseDocument> | MongoPurchaseDocument
): PurchaseIntentRecord {
  return {
    purchaseId: document.purchaseId,
    userId: document.userId,
    telegramUserId: document.telegramUserId,
    bundleId: document.bundleId,
    status: document.status,
    isActiveIntent: document.isActiveIntent,
    invoicePayload: document.invoicePayload,
    invoiceUrl: document.invoiceUrl,
    priceSnapshot: {
      currency: document.priceSnapshot.currency,
      amount: document.priceSnapshot.amount
    },
    coinsAmount: document.coinsAmount,
    expiresAt: document.expiresAt
  };
}

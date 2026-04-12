import { describe, expect, it, vi } from "vitest";

import {
  carsCatalogIndexes,
  ensureMongoIndexes,
  paymentEventsIndexes,
  purchasesIndexes,
  usersIndexes
} from "../../../src/infra/mongo/indexes.js";

describe("mongo index specs", () => {
  it("exports the expected collection index definitions", () => {
    expect(usersIndexes).toEqual([
      {
        keys: { telegramUserId: 1 },
        options: { name: "users_telegramUserId_unique", unique: true }
      }
    ]);

    expect(carsCatalogIndexes).toEqual([
      {
        keys: { active: 1, sortOrder: 1 },
        options: { name: "carsCatalog_active_sortOrder" }
      }
    ]);

    expect(purchasesIndexes).toEqual([
      {
        keys: { invoicePayload: 1 },
        options: { name: "purchases_invoicePayload_unique", unique: true }
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
        options: { name: "purchases_userId_createdAt" }
      },
      {
        keys: { userId: 1, carId: 1, isActiveIntent: 1 },
        options: {
          name: "purchases_activeIntent_unique",
          partialFilterExpression: { isActiveIntent: true },
          unique: true
        }
      }
    ]);

    expect(paymentEventsIndexes).toEqual([
      {
        keys: { telegramUpdateId: 1 },
        options: { name: "paymentEvents_telegramUpdateId_unique", unique: true }
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
        options: { name: "paymentEvents_purchaseId" }
      }
    ]);
  });

  it("does not use sparse indexes for optional payment identifiers", () => {
    const optionalPaymentIndexes = [
      ...purchasesIndexes,
      ...paymentEventsIndexes
    ].filter((index) => {
      return (
        "partialFilterExpression" in (index.options ?? {}) ||
        "telegramPaymentChargeId" in index.keys ||
        "preCheckoutQueryId" in index.keys
      );
    });

    expect(optionalPaymentIndexes.length).toBeGreaterThan(0);

    for (const index of optionalPaymentIndexes) {
      expect(index.options).not.toHaveProperty("sparse");
      expect(index.options).toHaveProperty("partialFilterExpression");
    }
  });

  it("creates every configured index on the matching collection", async () => {
    const createIndex = vi.fn(async () => "created");
    const db = {
      collection: vi.fn(() => ({ createIndex }))
    };

    await ensureMongoIndexes(db);

    expect(db.collection).toHaveBeenCalledWith("users");
    expect(db.collection).toHaveBeenCalledWith("carsCatalog");
    expect(db.collection).toHaveBeenCalledWith("purchases");
    expect(db.collection).toHaveBeenCalledWith("paymentEvents");
    expect(createIndex).toHaveBeenCalledTimes(
      usersIndexes.length +
        carsCatalogIndexes.length +
        purchasesIndexes.length +
        paymentEventsIndexes.length
    );
    expect(createIndex).toHaveBeenCalledWith(
      { telegramUserId: 1 },
      { name: "users_telegramUserId_unique", unique: true }
    );
  });
});

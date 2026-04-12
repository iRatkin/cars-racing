import { describe, expect, it, vi } from "vitest";

import { MongoPurchasesRepository } from "../../../src/infra/mongo/purchases-repository.js";

describe("MongoPurchasesRepository", () => {
  it("creates active invoice-ready purchase intents with deterministic payloads", async () => {
    const collection = {
      findOne: vi.fn(),
      insertOne: vi.fn(async () => ({ acknowledged: true, insertedId: "ignored" })),
      updateOne: vi.fn()
    };
    const repository = new MongoPurchasesRepository(collection, {
      createPurchaseId: () => "pur_test"
    });
    const expiresAt = new Date("2026-04-10T10:15:00.000Z");

    const intent = await repository.createIntent({
      userId: "usr_123456789",
      telegramUserId: "123456789",
      carId: "second_car",
      priceSnapshot: { currency: "XTR", amount: 250 },
      expiresAt
    });

    expect(collection.insertOne).toHaveBeenCalledWith({
      purchaseId: "pur_test",
      userId: "usr_123456789",
      telegramUserId: "123456789",
      carId: "second_car",
      status: "invoice_ready",
      isActiveIntent: true,
      invoicePayload: "pur_test",
      priceSnapshot: { currency: "XTR", amount: 250 },
      expiresAt,
      createdAt: expect.any(Date),
      updatedAt: expect.any(Date)
    });
    expect(intent).toMatchObject({
      purchaseId: "pur_test",
      invoicePayload: "pur_test",
      status: "invoice_ready",
      isActiveIntent: true
    });
  });

  it("finds and maps active purchase intents", async () => {
    const expiresAt = new Date("2026-04-10T10:15:00.000Z");
    const collection = {
      findOne: vi.fn(async () => ({
        purchaseId: "pur_test",
        userId: "usr_123456789",
        telegramUserId: "123456789",
        carId: "second_car",
        status: "invoice_ready" as const,
        isActiveIntent: true,
        invoicePayload: "pur_test",
        invoiceUrl: "https://t.me/invoice/pur_test",
        priceSnapshot: { currency: "XTR" as const, amount: 250 },
        expiresAt
      })),
      insertOne: vi.fn(),
      updateOne: vi.fn()
    };
    const repository = new MongoPurchasesRepository(collection);

    const intent = await repository.findActiveIntent({
      userId: "usr_123456789",
      carId: "second_car"
    });

    expect(collection.findOne).toHaveBeenCalledWith({
      userId: "usr_123456789",
      carId: "second_car",
      isActiveIntent: true
    });
    expect(intent).toEqual({
      purchaseId: "pur_test",
      userId: "usr_123456789",
      telegramUserId: "123456789",
      carId: "second_car",
      status: "invoice_ready",
      isActiveIntent: true,
      invoicePayload: "pur_test",
      invoiceUrl: "https://t.me/invoice/pur_test",
      priceSnapshot: { currency: "XTR", amount: 250 },
      expiresAt
    });
  });

  it("stores invoice URLs and expires released intents", async () => {
    const collection = {
      findOne: vi.fn(),
      insertOne: vi.fn(),
      updateOne: vi.fn(async () => ({ acknowledged: true, matchedCount: 1 }))
    };
    const repository = new MongoPurchasesRepository(collection);

    await repository.setInvoiceUrl("pur_test", "https://t.me/invoice/pur_test");
    await repository.expireIntent("pur_test");

    expect(collection.updateOne).toHaveBeenNthCalledWith(
      1,
      { purchaseId: "pur_test" },
      {
        $set: {
          invoiceUrl: "https://t.me/invoice/pur_test",
          status: "invoice_ready",
          updatedAt: expect.any(Date)
        }
      }
    );
    expect(collection.updateOne).toHaveBeenNthCalledWith(
      2,
      { purchaseId: "pur_test" },
      {
        $set: {
          status: "expired",
          isActiveIntent: false,
          updatedAt: expect.any(Date)
        }
      }
    );
  });
});

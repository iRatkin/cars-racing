import { describe, expect, it } from "vitest";

import {
  classifyPurchaseIntentRetry,
  classifySuccessfulPaymentGrant
} from "../../../src/modules/payments/purchase-domain.js";

describe("purchase domain helpers", () => {
  it("reuses an active non-expired purchase intent", () => {
    const now = new Date("2026-04-10T10:00:00.000Z");
    const intent = {
      purchaseId: "pur_01",
      purchaseStatus: "invoice_ready" as const,
      carId: "second_car",
      isActiveIntent: true,
      expiresAt: new Date("2026-04-10T11:00:00.000Z"),
      invoicePayload: "pur_01"
    };

    const decision = classifyPurchaseIntentRetry(intent, now);

    expect(decision).toEqual({
      kind: "reuse-existing-intent",
      intent
    });
  });

  it("expires an active unpaid intent when it is already expired", () => {
    const now = new Date("2026-04-10T10:00:00.000Z");
    const intent = {
      purchaseId: "pur_02",
      purchaseStatus: "invoice_ready" as const,
      carId: "second_car",
      isActiveIntent: true,
      expiresAt: new Date("2026-04-10T09:00:00.000Z"),
      invoicePayload: "pur_02"
    };

    const decision = classifyPurchaseIntentRetry(intent, now);

    expect(decision).toEqual({
      kind: "expire-and-release-intent",
      releasedIntent: {
        ...intent,
        purchaseStatus: "expired",
        isActiveIntent: false
      }
    });
  });

  it("allows a successful payment grant even when the purchase itself is expired", () => {
    const decision = classifySuccessfulPaymentGrant({
      purchaseId: "pur_03",
      purchaseStatus: "expired",
      invoicePayload: "pur_03",
      telegramPaymentChargeId: "charge_01",
      existingGrantByChargeId: null
    });

    expect(decision).toEqual({
      kind: "grant"
    });
  });

  it("treats a duplicate charge id for the same purchase as already applied", () => {
    const decision = classifySuccessfulPaymentGrant({
      purchaseId: "pur_04",
      purchaseStatus: "granted",
      invoicePayload: "pur_04",
      telegramPaymentChargeId: "charge_02",
      existingGrantByChargeId: {
        purchaseId: "pur_04",
        invoicePayload: "pur_04",
        telegramPaymentChargeId: "charge_02"
      }
    });

    expect(decision).toEqual({
      kind: "already-applied"
    });
  });

  it("treats a duplicate charge id with a different payload as suspicious", () => {
    const decision = classifySuccessfulPaymentGrant({
      purchaseId: "pur_05",
      purchaseStatus: "granted",
      invoicePayload: "pur_05-new",
      telegramPaymentChargeId: "charge_03",
      existingGrantByChargeId: {
        purchaseId: "pur_05",
        invoicePayload: "pur_05-old",
        telegramPaymentChargeId: "charge_03"
      }
    });

    expect(decision).toEqual({
      kind: "suspicious-duplicate",
      conflictingPurchaseId: "pur_05",
      conflictingInvoicePayload: "pur_05-old"
    });
  });
});

export type PurchaseStatus =
  | "created"
  | "invoice_ready"
  | "pre_checkout_approved"
  | "paid"
  | "granted"
  | "cancelled"
  | "expired"
  | "failed";

export interface PurchaseIntentSnapshot {
  purchaseId: string;
  bundleId: string;
  purchaseStatus: PurchaseStatus;
  isActiveIntent: boolean;
  expiresAt: Date;
  invoicePayload: string;
}

export type PurchaseIntentRetryDecision =
  | {
      kind: "reuse-existing-intent";
      intent: PurchaseIntentSnapshot;
    }
  | {
      kind: "expire-and-release-intent";
      releasedIntent: PurchaseIntentSnapshot;
    }
  | {
      kind: "allow-new-intent";
    };

export function classifyPurchaseIntentRetry(
  intent: PurchaseIntentSnapshot,
  now: Date
): PurchaseIntentRetryDecision {
  if (!intent.isActiveIntent) {
    return {
      kind: "allow-new-intent"
    };
  }

  if (intent.expiresAt.getTime() > now.getTime()) {
    return {
      kind: "reuse-existing-intent",
      intent
    };
  }

  if (intent.purchaseStatus !== "paid" && intent.purchaseStatus !== "granted") {
    return {
      kind: "expire-and-release-intent",
      releasedIntent: {
        ...intent,
        purchaseStatus: "expired",
        isActiveIntent: false
      }
    };
  }

  return {
    kind: "allow-new-intent"
  };
}

export interface SuccessfulPaymentGrantRecord {
  purchaseId: string;
  invoicePayload: string;
  telegramPaymentChargeId: string;
}

export interface SuccessfulPaymentGrantInput {
  purchaseId: string;
  purchaseStatus: PurchaseStatus;
  invoicePayload: string;
  telegramPaymentChargeId: string;
  existingGrantByChargeId?: SuccessfulPaymentGrantRecord | null;
}

export type SuccessfulPaymentGrantDecision =
  | {
      kind: "grant";
    }
  | {
      kind: "already-applied";
    }
  | {
      kind: "suspicious-duplicate";
      conflictingPurchaseId: string;
      conflictingInvoicePayload: string;
    };

export function classifySuccessfulPaymentGrant(
  input: SuccessfulPaymentGrantInput
): SuccessfulPaymentGrantDecision {
  if (input.existingGrantByChargeId == null) {
    return {
      kind: "grant"
    };
  }

  if (
    input.existingGrantByChargeId.purchaseId === input.purchaseId &&
    input.existingGrantByChargeId.invoicePayload === input.invoicePayload &&
    input.existingGrantByChargeId.telegramPaymentChargeId === input.telegramPaymentChargeId
  ) {
    return {
      kind: "already-applied"
    };
  }

  return {
    kind: "suspicious-duplicate",
    conflictingPurchaseId: input.existingGrantByChargeId.purchaseId,
    conflictingInvoicePayload: input.existingGrantByChargeId.invoicePayload
  };
}

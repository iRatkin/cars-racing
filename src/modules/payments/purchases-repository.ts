import type { PurchaseStatus } from "./purchase-domain.js";

export interface PurchaseIntentRecord {
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
}

export type CreatePurchaseIntentInput = Omit<
  PurchaseIntentRecord,
  "purchaseId" | "invoicePayload" | "status" | "isActiveIntent" | "invoiceUrl"
>;

export interface PurchasesRepository {
  findActiveIntent(input: {
    userId: string;
    bundleId: string;
  }): Promise<PurchaseIntentRecord | null>;
  findByInvoicePayload(invoicePayload: string): Promise<PurchaseIntentRecord | null>;
  createIntent(input: CreatePurchaseIntentInput): Promise<PurchaseIntentRecord>;
  setInvoiceUrl(purchaseId: string, invoiceUrl: string): Promise<void>;
  updateStatus(purchaseId: string, status: PurchaseStatus): Promise<void>;
  markGranted(purchaseId: string, telegramPaymentChargeId: string): Promise<void>;
  expireIntent(purchaseId: string): Promise<void>;
}

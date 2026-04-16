import { createHash, timingSafeEqual } from "node:crypto";

export type TelegramUserIdentity = {
  id: number | string;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
  [key: string]: unknown;
};

export type TelegramPreCheckoutQuery = {
  id: string;
  from: TelegramUserIdentity;
  currency: string;
  total_amount: number;
  invoice_payload?: string;
  [key: string]: unknown;
};

export type TelegramSuccessfulPayment = {
  currency: string;
  total_amount: number;
  invoice_payload?: string;
  telegram_payment_charge_id?: string;
  provider_payment_charge_id?: string;
  [key: string]: unknown;
};

export type TelegramPreCheckoutWebhookUpdate = {
  update_id: number;
  pre_checkout_query: TelegramPreCheckoutQuery;
};

export type TelegramSuccessfulPaymentWebhookUpdate = {
  update_id: number;
  message: {
    from: TelegramUserIdentity;
    successful_payment: TelegramSuccessfulPayment;
    [key: string]: unknown;
  };
};

export type TelegramBotCommandUpdate = {
  update_id: number;
  message: {
    message_id: number;
    from: TelegramUserIdentity;
    chat: { id: number | string; [key: string]: unknown };
    text: string;
    entities: Array<{ type: string; offset: number; length: number }>;
    [key: string]: unknown;
  };
};

export type SupportedTelegramWebhookUpdate =
  | TelegramPreCheckoutWebhookUpdate
  | TelegramSuccessfulPaymentWebhookUpdate;

export type TelegramPurchasePaymentExpectation = {
  telegramUserId: string;
  invoicePayload: string;
  totalAmount: number;
};

export type ValidatedTelegramPreCheckoutQuery = {
  updateId: number;
  preCheckoutQueryId: string;
  telegramUserId: string;
  invoicePayload: string;
  currency: "XTR";
  totalAmount: number;
};

export type ValidatedTelegramSuccessfulPayment = {
  updateId: number;
  telegramUserId: string;
  invoicePayload: string;
  currency: "XTR";
  totalAmount: number;
  telegramPaymentChargeId: string;
};

export type TelegramWebhookValidationErrorCode =
  | "UNSUPPORTED_UPDATE"
  | "INVALID_UPDATE"
  | "MISSING_INVOICE_PAYLOAD"
  | "MISSING_SUCCESSFUL_PAYMENT_CHARGE_ID"
  | "INVALID_INVOICE_PAYLOAD"
  | "INVALID_CURRENCY"
  | "INVALID_TOTAL_AMOUNT"
  | "INVALID_FROM_ID";

export class TelegramWebhookValidationError extends Error {
  public readonly code: TelegramWebhookValidationErrorCode;

  constructor(code: TelegramWebhookValidationErrorCode, message: string) {
    super(message);
    this.name = "TelegramWebhookValidationError";
    this.code = code;
  }
}

export function isTelegramPreCheckoutWebhookUpdate(
  value: unknown
): value is TelegramPreCheckoutWebhookUpdate {
  return (
    isObject(value) &&
    typeof value.update_id === "number" &&
    isObject(value.pre_checkout_query) &&
    typeof value.pre_checkout_query.id === "string" &&
    isTelegramUserIdentity(value.pre_checkout_query.from) &&
    typeof value.pre_checkout_query.currency === "string" &&
    typeof value.pre_checkout_query.total_amount === "number"
  );
}

export function isTelegramSuccessfulPaymentWebhookUpdate(
  value: unknown
): value is TelegramSuccessfulPaymentWebhookUpdate {
  return (
    isObject(value) &&
    typeof value.update_id === "number" &&
    isObject(value.message) &&
    isTelegramUserIdentity(value.message.from) &&
    isObject(value.message.successful_payment) &&
    typeof value.message.successful_payment.currency === "string" &&
    typeof value.message.successful_payment.total_amount === "number"
  );
}

export function extractStartCommandPayload(text: string): string | undefined {
  const spaceIndex = text.indexOf(" ");
  if (spaceIndex === -1) return undefined;
  const payload = text.slice(spaceIndex + 1).trim();
  return payload.length > 0 ? payload : undefined;
}

export function isTelegramBotCommandUpdate(
  value: unknown,
  command: string
): value is TelegramBotCommandUpdate {
  if (
    !isObject(value) ||
    typeof value.update_id !== "number" ||
    !isObject(value.message) ||
    typeof value.message.text !== "string" ||
    !Array.isArray(value.message.entities)
  ) {
    return false;
  }

  const hasBotCommandEntity = value.message.entities.some(
    (e): e is { type: string; offset: number; length: number } =>
      isObject(e) && e.type === "bot_command" && e.offset === 0
  );

  if (!hasBotCommandEntity) {
    return false;
  }

  const text = value.message.text as string;
  return text === command || text.startsWith(`${command}@`);
}

export function isSupportedTelegramWebhookUpdate(
  value: unknown
): value is SupportedTelegramWebhookUpdate {
  return isTelegramPreCheckoutWebhookUpdate(value) || isTelegramSuccessfulPaymentWebhookUpdate(value);
}

export function assertSupportedTelegramWebhookUpdate(
  value: unknown
): SupportedTelegramWebhookUpdate {
  if (!isSupportedTelegramWebhookUpdate(value)) {
    throw new TelegramWebhookValidationError(
      "UNSUPPORTED_UPDATE",
      "Telegram webhook update type is not supported"
    );
  }

  return value;
}

export function normalizeTelegramUserId(value: number | string | null | undefined): string | null {
  if (typeof value === "number") {
    return Number.isInteger(value) && value >= 0 ? String(value) : null;
  }

  if (typeof value === "string" && /^\d+$/.test(value)) {
    return value;
  }

  return null;
}

export function compareTelegramWebhookSecretToken(
  providedSecretToken: string | null | undefined,
  configuredSecretToken: string
): boolean {
  if (typeof providedSecretToken !== "string" || typeof configuredSecretToken !== "string") {
    return false;
  }

  const providedDigest = createHash("sha256").update(providedSecretToken, "utf8").digest();
  const configuredDigest = createHash("sha256").update(configuredSecretToken, "utf8").digest();

  return timingSafeEqual(providedDigest, configuredDigest);
}

export function validateTelegramPreCheckoutQuery(
  value: unknown,
  expected: TelegramPurchasePaymentExpectation
): ValidatedTelegramPreCheckoutQuery {
  const update = assertSupportedTelegramWebhookUpdate(value);

  if (!isTelegramPreCheckoutWebhookUpdate(update)) {
    throw new TelegramWebhookValidationError(
      "UNSUPPORTED_UPDATE",
      "Telegram webhook update is not a pre_checkout_query"
    );
  }

  const telegramUserId = normalizeTelegramUserId(update.pre_checkout_query.from.id);
  if (!telegramUserId) {
    throw new TelegramWebhookValidationError("INVALID_FROM_ID", "Telegram from.id is invalid");
  }

  const invoicePayload = assertInvoicePayload(update.pre_checkout_query.invoice_payload);
  const currency = update.pre_checkout_query.currency;
  const totalAmount = update.pre_checkout_query.total_amount;

  validatePaymentSnapshot({
    telegramUserId,
    invoicePayload,
    currency,
    totalAmount,
    expected
  });

  return {
    updateId: update.update_id,
    preCheckoutQueryId: update.pre_checkout_query.id,
    telegramUserId,
    invoicePayload,
    currency: "XTR",
    totalAmount
  };
}

export function validateTelegramSuccessfulPayment(
  value: unknown,
  expected: TelegramPurchasePaymentExpectation
): ValidatedTelegramSuccessfulPayment {
  const update = assertSupportedTelegramWebhookUpdate(value);

  if (!isTelegramSuccessfulPaymentWebhookUpdate(update)) {
    throw new TelegramWebhookValidationError(
      "UNSUPPORTED_UPDATE",
      "Telegram webhook update is not a successful_payment message"
    );
  }

  const telegramUserId = normalizeTelegramUserId(update.message.from.id);
  if (!telegramUserId) {
    throw new TelegramWebhookValidationError("INVALID_FROM_ID", "Telegram from.id is invalid");
  }

  const successfulPayment = update.message.successful_payment;
  const invoicePayload = assertInvoicePayload(successfulPayment.invoice_payload);
  const telegramPaymentChargeId = successfulPayment.telegram_payment_charge_id;
  if (!telegramPaymentChargeId) {
    throw new TelegramWebhookValidationError(
      "MISSING_SUCCESSFUL_PAYMENT_CHARGE_ID",
      "Telegram successful_payment is missing telegram_payment_charge_id"
    );
  }

  validatePaymentSnapshot({
    telegramUserId,
    invoicePayload,
    currency: successfulPayment.currency,
    totalAmount: successfulPayment.total_amount,
    expected
  });

  return {
    updateId: update.update_id,
    telegramUserId,
    invoicePayload,
    currency: "XTR",
    totalAmount: successfulPayment.total_amount,
    telegramPaymentChargeId
  };
}

function validatePaymentSnapshot(input: {
  telegramUserId: string;
  invoicePayload: string;
  currency: string;
  totalAmount: number;
  expected: TelegramPurchasePaymentExpectation;
}): void {
  if (input.telegramUserId !== input.expected.telegramUserId) {
    throw new TelegramWebhookValidationError(
      "INVALID_FROM_ID",
      "Telegram from.id does not match the purchase"
    );
  }

  if (input.invoicePayload !== input.expected.invoicePayload) {
    throw new TelegramWebhookValidationError(
      "INVALID_INVOICE_PAYLOAD",
      "Telegram invoice_payload does not match the purchase"
    );
  }

  if (input.currency !== "XTR") {
    throw new TelegramWebhookValidationError("INVALID_CURRENCY", "Telegram currency must be XTR");
  }

  if (input.totalAmount !== input.expected.totalAmount) {
    throw new TelegramWebhookValidationError(
      "INVALID_TOTAL_AMOUNT",
      "Telegram total_amount does not match the purchase snapshot"
    );
  }
}

function assertInvoicePayload(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TelegramWebhookValidationError(
      "MISSING_INVOICE_PAYLOAD",
      "Telegram invoice_payload is missing"
    );
  }

  return value;
}

function isTelegramUserIdentity(value: unknown): value is TelegramUserIdentity {
  return (
    isObject(value) &&
    (typeof value.id === "number" || typeof value.id === "string") &&
    (!("first_name" in value) || typeof value.first_name === "string") &&
    (!("last_name" in value) || typeof value.last_name === "string") &&
    (!("username" in value) || typeof value.username === "string") &&
    (!("language_code" in value) || typeof value.language_code === "string") &&
    (!("is_premium" in value) || typeof value.is_premium === "boolean")
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

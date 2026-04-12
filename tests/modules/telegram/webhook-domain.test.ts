import { describe, expect, it } from "vitest";

import {
  assertSupportedTelegramWebhookUpdate,
  compareTelegramWebhookSecretToken,
  isSupportedTelegramWebhookUpdate,
  normalizeTelegramUserId,
  validateTelegramPreCheckoutQuery,
  validateTelegramSuccessfulPayment,
  TelegramWebhookValidationError
} from "../../../src/modules/telegram/webhook-domain.js";

describe("telegram webhook domain helpers", () => {
  const expected = {
    telegramUserId: "123456789",
    invoicePayload: "pur_01",
    totalAmount: 250
  };

  it("validates a supported pre_checkout_query and normalizes from.id", () => {
    const update = {
      update_id: 42,
      pre_checkout_query: {
        id: "pcq_01",
        from: {
          id: 123456789,
          first_name: "Ivan"
        },
        currency: "XTR",
        total_amount: 250,
        invoice_payload: "pur_01"
      }
    };

    expect(isSupportedTelegramWebhookUpdate(update)).toBe(true);
    expect(normalizeTelegramUserId(123456789)).toBe("123456789");

    const result = validateTelegramPreCheckoutQuery(update, expected);

    expect(result).toEqual({
      updateId: 42,
      preCheckoutQueryId: "pcq_01",
      telegramUserId: "123456789",
      invoicePayload: "pur_01",
      currency: "XTR",
      totalAmount: 250
    });
  });

  it("rejects pre_checkout_query from the wrong user", () => {
    const update = {
      update_id: 43,
      pre_checkout_query: {
        id: "pcq_02",
        from: {
          id: 999999999,
          first_name: "Ivan"
        },
        currency: "XTR",
        total_amount: 250,
        invoice_payload: "pur_01"
      }
    };

    expect(() => validateTelegramPreCheckoutQuery(update, expected)).toThrow(TelegramWebhookValidationError);
  });

  it("rejects pre_checkout_query with the wrong amount", () => {
    const update = {
      update_id: 44,
      pre_checkout_query: {
        id: "pcq_03",
        from: {
          id: 123456789,
          first_name: "Ivan"
        },
        currency: "XTR",
        total_amount: 249,
        invoice_payload: "pur_01"
      }
    };

    expect(() => validateTelegramPreCheckoutQuery(update, expected)).toThrow(TelegramWebhookValidationError);
  });

  it("validates successful_payment and extracts telegramPaymentChargeId", () => {
    const update = {
      update_id: 45,
      message: {
        from: {
          id: "123456789",
          first_name: "Ivan"
        },
        successful_payment: {
          currency: "XTR",
          total_amount: 250,
          invoice_payload: "pur_01",
          telegram_payment_charge_id: "charge_01",
          provider_payment_charge_id: "provider_01"
        }
      }
    };

    const result = validateTelegramSuccessfulPayment(update, expected);

    expect(result).toEqual({
      updateId: 45,
      telegramUserId: "123456789",
      invoicePayload: "pur_01",
      currency: "XTR",
      totalAmount: 250,
      telegramPaymentChargeId: "charge_01"
    });
  });

  it("rejects unsupported updates", () => {
    const update = {
      update_id: 46,
      message: {
        text: "hello",
        from: {
          id: 123456789,
          first_name: "Ivan"
        }
      }
    };

    expect(isSupportedTelegramWebhookUpdate(update)).toBe(false);
    expect(() => assertSupportedTelegramWebhookUpdate(update)).toThrow(TelegramWebhookValidationError);
  });

  it("compares webhook secret tokens in constant time", () => {
    expect(compareTelegramWebhookSecretToken("secret-token", "secret-token")).toBe(true);
    expect(compareTelegramWebhookSecretToken("secret-token", "different-token")).toBe(false);
  });
});

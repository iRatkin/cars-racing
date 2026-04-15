import type { PurchasesRepository } from "../payments/purchases-repository.js";
import type { UsersRepository } from "../users/users-repository.js";
import type { TelegramInvoiceLinkClientOptions } from "./invoice-link.js";
import { answerPreCheckoutQuery, sendTelegramMessage } from "./invoice-link.js";
import {
  isTelegramBotCommandUpdate,
  isTelegramPreCheckoutWebhookUpdate,
  isTelegramSuccessfulPaymentWebhookUpdate,
  normalizeTelegramUserId,
  type TelegramBotCommandUpdate,
  type TelegramPreCheckoutWebhookUpdate,
  type TelegramSuccessfulPaymentWebhookUpdate
} from "./webhook-domain.js";

export interface WebhookHandlerDependencies {
  purchasesRepository: PurchasesRepository;
  usersRepository: UsersRepository;
  telegramOptions: TelegramInvoiceLinkClientOptions;
  miniAppUrl?: string;
  logger?: WebhookLogger;
}

export interface WebhookLogger {
  info(obj: Record<string, unknown>, msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
}

export function createWebhookHandler(deps: WebhookHandlerDependencies) {
  const { purchasesRepository, usersRepository, telegramOptions, miniAppUrl, logger } = deps;

  return async function handleTelegramWebhook(update: unknown): Promise<void> {
    if (isTelegramBotCommandUpdate(update, "/start")) {
      await handleStartCommand(update);
      return;
    }

    if (isTelegramPreCheckoutWebhookUpdate(update)) {
      await handlePreCheckoutQuery(update);
      return;
    }

    if (isTelegramSuccessfulPaymentWebhookUpdate(update)) {
      await handleSuccessfulPayment(update);
      return;
    }

    logger?.info({ update }, "ignoring unsupported webhook update");
  };

  async function handleStartCommand(update: TelegramBotCommandUpdate): Promise<void> {
    const chatId = update.message.chat.id;

    if (miniAppUrl) {
      await sendTelegramMessage(telegramOptions, {
        chatId,
        text: "Welcome! Tap the button below to start racing.",
        replyMarkup: {
          inline_keyboard: [
            [{ text: "Play", web_app: { url: miniAppUrl } }]
          ]
        }
      });
    } else {
      await sendTelegramMessage(telegramOptions, {
        chatId,
        text: "Welcome to Cars Racing!"
      });
    }

    logger?.info({ chatId }, "/start command handled");
  }

  async function handlePreCheckoutQuery(update: TelegramPreCheckoutWebhookUpdate): Promise<void> {
    const query = update.pre_checkout_query;
    const invoicePayload = query.invoice_payload;

    if (!invoicePayload) {
      logger?.warn({ updateId: update.update_id }, "pre_checkout_query missing invoice_payload");
      await answerPreCheckoutQuery(telegramOptions, query.id, false, "Invalid invoice payload");
      return;
    }

    const purchase = await purchasesRepository.findByInvoicePayload(invoicePayload);
    if (!purchase) {
      logger?.warn({ invoicePayload }, "pre_checkout_query: purchase not found");
      await answerPreCheckoutQuery(telegramOptions, query.id, false, "Purchase not found");
      return;
    }

    if (query.currency !== "XTR") {
      logger?.warn({ invoicePayload, currency: query.currency }, "pre_checkout_query: invalid currency");
      await answerPreCheckoutQuery(telegramOptions, query.id, false, "Invalid currency");
      return;
    }

    if (query.total_amount !== purchase.priceSnapshot.amount) {
      logger?.warn({
        invoicePayload,
        expected: purchase.priceSnapshot.amount,
        received: query.total_amount
      }, "pre_checkout_query: amount mismatch");
      await answerPreCheckoutQuery(telegramOptions, query.id, false, "Amount mismatch");
      return;
    }

    await answerPreCheckoutQuery(telegramOptions, query.id, true);
    await purchasesRepository.updateStatus(purchase.purchaseId, "pre_checkout_approved");
    logger?.info({ invoicePayload, purchaseId: purchase.purchaseId }, "pre_checkout_query approved");
  }

  async function handleSuccessfulPayment(update: TelegramSuccessfulPaymentWebhookUpdate): Promise<void> {
    const payment = update.message.successful_payment;
    const invoicePayload = payment.invoice_payload;
    const telegramPaymentChargeId = payment.telegram_payment_charge_id;

    if (!invoicePayload || !telegramPaymentChargeId) {
      logger?.warn({ updateId: update.update_id }, "successful_payment missing required fields");
      return;
    }

    const purchase = await purchasesRepository.findByInvoicePayload(invoicePayload);
    if (!purchase) {
      logger?.warn({ invoicePayload }, "successful_payment: purchase not found");
      return;
    }

    if (purchase.status === "granted") {
      logger?.info({ invoicePayload }, "successful_payment: already granted, skipping");
      return;
    }

    await usersRepository.addRaceCoins(purchase.userId, purchase.coinsAmount);
    await purchasesRepository.markGranted(purchase.purchaseId, telegramPaymentChargeId);

    const telegramUserId = normalizeTelegramUserId(update.message.from.id);
    logger?.info({
      invoicePayload,
      purchaseId: purchase.purchaseId,
      telegramUserId,
      coinsAmount: purchase.coinsAmount
    }, "successful_payment: coins granted");
  }
}

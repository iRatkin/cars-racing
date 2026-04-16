import type { TelegramUserIdentity } from "../telegram/webhook-domain.js";

export interface AdminTextMessageUpdate {
  update_id?: number;
  message: {
    message_id: number;
    from: TelegramUserIdentity;
    chat: { id: number; [key: string]: unknown };
    text: string;
    [key: string]: unknown;
  };
}

export interface AdminCallbackQueryUpdate {
  update_id?: number;
  callback_query: {
    id: string;
    from: TelegramUserIdentity;
    data: string;
    message: {
      message_id: number;
      chat: { id: number; [key: string]: unknown };
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
}

export type AdminUpdate = AdminTextMessageUpdate | AdminCallbackQueryUpdate;

export function isAdminTextMessageUpdate(
  value: unknown
): value is AdminTextMessageUpdate {
  if (!isObject(value) || !isObject(value.message)) {
    return false;
  }
  const { message } = value;
  return (
    typeof message.message_id === "number" &&
    isTelegramUserIdentity(message.from) &&
    isObject(message.chat) &&
    typeof message.chat.id === "number" &&
    typeof message.text === "string"
  );
}

export function isAdminCallbackQueryUpdate(
  value: unknown
): value is AdminCallbackQueryUpdate {
  if (!isObject(value) || !isObject(value.callback_query)) {
    return false;
  }
  const { callback_query: cb } = value;
  return (
    typeof cb.id === "string" &&
    isTelegramUserIdentity(cb.from) &&
    typeof cb.data === "string" &&
    isObject(cb.message) &&
    typeof cb.message.message_id === "number" &&
    isObject(cb.message.chat) &&
    typeof cb.message.chat.id === "number"
  );
}

export function extractAdminFromId(update: AdminUpdate): string | null {
  if ("callback_query" in update) {
    return normalizeUserId(update.callback_query.from.id);
  }
  return normalizeUserId(update.message.from.id);
}

function normalizeUserId(value: number | string | null | undefined): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  return null;
}

function isTelegramUserIdentity(value: unknown): value is TelegramUserIdentity {
  return (
    isObject(value) &&
    (typeof value.id === "number" || typeof value.id === "string")
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

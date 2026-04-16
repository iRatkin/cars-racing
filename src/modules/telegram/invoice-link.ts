export interface TelegramStarsPriceSnapshot {
  currency: "XTR";
  amount: number;
}

export interface TelegramCreateInvoiceLinkPrice {
  label: string;
  amount: number;
}

export interface TelegramCreateInvoiceLinkRequestBody {
  title: string;
  description: string;
  payload: string;
  provider_token: "";
  currency: "XTR";
  prices: readonly TelegramCreateInvoiceLinkPrice[];
}

export interface TelegramInvoiceLinkClientOptions {
  botToken: string;
  fetchImpl?: TelegramFetch;
}

export type TelegramFetch = (
  input: string,
  init: {
    method: "POST";
    headers: Record<string, string>;
    body: string;
  }
) => Promise<{
  ok: boolean;
  status?: number;
  json: () => Promise<unknown>;
}>;

export interface CreateTelegramInvoiceLinkInput {
  purchaseId: string;
  title: string;
  invoiceTitle: string;
  invoiceDescription: string;
  priceSnapshot: TelegramStarsPriceSnapshot;
}

export function buildTelegramCreateInvoiceLinkRequestBody(
  input: CreateTelegramInvoiceLinkInput
): TelegramCreateInvoiceLinkRequestBody {
  return {
    title: input.invoiceTitle,
    description: input.invoiceDescription,
    payload: input.purchaseId,
    provider_token: "",
    currency: "XTR",
    prices: [
      {
        label: input.title,
        amount: input.priceSnapshot.amount
      }
    ]
  };
}

export async function createTelegramInvoiceLink(
  options: TelegramInvoiceLinkClientOptions,
  input: CreateTelegramInvoiceLinkInput
): Promise<string> {
  const fetchImpl = options.fetchImpl ?? defaultTelegramFetch;
  const body = buildTelegramCreateInvoiceLinkRequestBody(input);
  const response = await fetchImpl(
    `https://api.telegram.org/bot${options.botToken}/createInvoiceLink`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    }
  );
  let responseBody: TelegramCreateInvoiceLinkResponse;
  try {
    responseBody = await response.json() as TelegramCreateInvoiceLinkResponse;
  } catch {
    throw new Error(
      `Telegram createInvoiceLink failed: HTTP ${response.status} (non-JSON response)`
    );
  }

  if (!response.ok || !responseBody.ok || typeof responseBody.result !== "string") {
    throw new Error(
      `Telegram createInvoiceLink failed: ${
        responseBody.description ?? `HTTP ${response.status}`
      }`
    );
  }

  return responseBody.result;
}

export async function answerPreCheckoutQuery(
  options: TelegramInvoiceLinkClientOptions,
  preCheckoutQueryId: string,
  ok: boolean,
  errorMessage?: string
): Promise<void> {
  const fetchImpl = options.fetchImpl ?? defaultTelegramFetch;
  const body: Record<string, unknown> = {
    pre_checkout_query_id: preCheckoutQueryId,
    ok
  };
  if (!ok && errorMessage) {
    body.error_message = errorMessage;
  }

  const response = await fetchImpl(
    `https://api.telegram.org/bot${options.botToken}/answerPreCheckoutQuery`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    }
  );

  let responseBody: TelegramApiResponse;
  try {
    responseBody = await response.json() as TelegramApiResponse;
  } catch {
    throw new Error(
      `Telegram answerPreCheckoutQuery failed: HTTP ${response.status} (non-JSON response)`
    );
  }

  if (!response.ok || !responseBody.ok) {
    throw new Error(
      `Telegram answerPreCheckoutQuery failed: ${
        responseBody.description ?? `HTTP ${response.status}`
      }`
    );
  }
}

export interface TelegramSendMessageInput {
  chatId: number | string;
  text: string;
  replyMarkup?: TelegramReplyMarkup;
}

export interface TelegramInlineKeyboardMarkup {
  inline_keyboard: TelegramInlineKeyboardButton[][];
}

export interface TelegramInlineKeyboardButton {
  text: string;
  web_app?: { url: string };
  url?: string;
  callback_data?: string;
}

export interface TelegramReplyKeyboardMarkup {
  keyboard: TelegramReplyKeyboardButton[][];
  resize_keyboard?: boolean;
  one_time_keyboard?: boolean;
  is_persistent?: boolean;
  input_field_placeholder?: string;
  selective?: boolean;
}

export interface TelegramReplyKeyboardButton {
  text: string;
}

export interface TelegramReplyKeyboardRemove {
  remove_keyboard: true;
  selective?: boolean;
}

export type TelegramReplyMarkup =
  | TelegramInlineKeyboardMarkup
  | TelegramReplyKeyboardMarkup
  | TelegramReplyKeyboardRemove;

export async function sendTelegramMessage(
  options: TelegramInvoiceLinkClientOptions,
  input: TelegramSendMessageInput
): Promise<void> {
  const fetchImpl = options.fetchImpl ?? defaultTelegramFetch;
  const body: Record<string, unknown> = {
    chat_id: input.chatId,
    text: input.text,
    parse_mode: "HTML",
  };
  if (input.replyMarkup) {
    body.reply_markup = input.replyMarkup;
  }

  const response = await fetchImpl(
    `https://api.telegram.org/bot${options.botToken}/sendMessage`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    }
  );

  let responseBody: TelegramApiResponse;
  try {
    responseBody = await response.json() as TelegramApiResponse;
  } catch {
    throw new Error(
      `Telegram sendMessage failed: HTTP ${response.status} (non-JSON response)`
    );
  }

  if (!response.ok || !responseBody.ok) {
    throw new Error(
      `Telegram sendMessage failed: ${responseBody.description ?? `HTTP ${response.status}`}`
    );
  }
}

export async function answerCallbackQuery(
  options: TelegramInvoiceLinkClientOptions,
  callbackQueryId: string,
  text?: string
): Promise<void> {
  const fetchImpl = options.fetchImpl ?? defaultTelegramFetch;
  const body: Record<string, unknown> = {
    callback_query_id: callbackQueryId,
    text
  };

  const response = await fetchImpl(
    `https://api.telegram.org/bot${options.botToken}/answerCallbackQuery`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    }
  );

  let responseBody: TelegramApiResponse;
  try {
    responseBody = await response.json() as TelegramApiResponse;
  } catch {
    throw new Error(
      `Telegram answerCallbackQuery failed: HTTP ${response.status} (non-JSON response)`
    );
  }

  if (!response.ok || !responseBody.ok) {
    throw new Error(
      `Telegram answerCallbackQuery failed: ${
        responseBody.description ?? `HTTP ${response.status}`
      }`
    );
  }
}

export interface TelegramEditMessageTextInput {
  chatId: number | string;
  messageId: number;
  text: string;
  replyMarkup?: TelegramInlineKeyboardMarkup;
}

export async function editMessageText(
  options: TelegramInvoiceLinkClientOptions,
  input: TelegramEditMessageTextInput
): Promise<void> {
  const fetchImpl = options.fetchImpl ?? defaultTelegramFetch;
  const body: Record<string, unknown> = {
    chat_id: input.chatId,
    message_id: input.messageId,
    text: input.text,
    parse_mode: "HTML"
  };
  if (input.replyMarkup) {
    body.reply_markup = input.replyMarkup;
  }

  const response = await fetchImpl(
    `https://api.telegram.org/bot${options.botToken}/editMessageText`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    }
  );

  let responseBody: TelegramApiResponse;
  try {
    responseBody = await response.json() as TelegramApiResponse;
  } catch {
    throw new Error(
      `Telegram editMessageText failed: HTTP ${response.status} (non-JSON response)`
    );
  }

  if (!response.ok || !responseBody.ok) {
    throw new Error(
      `Telegram editMessageText failed: ${
        responseBody.description ?? `HTTP ${response.status}`
      }`
    );
  }
}

const defaultTelegramFetch: TelegramFetch = (input, init) => fetch(input, init);

export interface TelegramSendDocumentInput {
  chatId: number | string;
  fileName: string;
  fileBuffer: Uint8Array;
  mimeType: string;
  caption?: string;
}

export interface TelegramSendDocumentOptions {
  botToken: string;
  fetchImpl?: (input: string, init: { method: "POST"; body: FormData }) => Promise<{
    ok: boolean;
    status?: number;
    json: () => Promise<unknown>;
  }>;
}

/**
 * Uploads a binary document to a Telegram chat via `sendDocument`.
 * Uses multipart/form-data directly rather than the JSON `TelegramFetch`
 * abstraction since Telegram requires the file as a form field.
 */
export async function sendTelegramDocument(
  options: TelegramSendDocumentOptions,
  input: TelegramSendDocumentInput
): Promise<void> {
  const form = new FormData();
  form.append("chat_id", String(input.chatId));
  if (input.caption) {
    form.append("caption", input.caption);
    form.append("parse_mode", "HTML");
  }
  const bytes = new Uint8Array(input.fileBuffer.byteLength);
  bytes.set(input.fileBuffer);
  const blob = new Blob([bytes], { type: input.mimeType });
  form.append("document", blob, input.fileName);

  const fetchImpl = options.fetchImpl ?? defaultDocumentFetch;
  const response = await fetchImpl(
    `https://api.telegram.org/bot${options.botToken}/sendDocument`,
    { method: "POST", body: form }
  );

  let responseBody: TelegramApiResponse;
  try {
    responseBody = await response.json() as TelegramApiResponse;
  } catch {
    throw new Error(
      `Telegram sendDocument failed: HTTP ${response.status} (non-JSON response)`
    );
  }

  if (!response.ok || !responseBody.ok) {
    throw new Error(
      `Telegram sendDocument failed: ${
        responseBody.description ?? `HTTP ${response.status}`
      }`
    );
  }
}

const defaultDocumentFetch: NonNullable<TelegramSendDocumentOptions["fetchImpl"]> = (
  input,
  init
) => fetch(input, init);

interface TelegramCreateInvoiceLinkResponse {
  ok: boolean;
  result?: string;
  description?: string;
}

interface TelegramApiResponse {
  ok: boolean;
  description?: string;
}

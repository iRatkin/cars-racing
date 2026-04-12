import { createHmac, timingSafeEqual } from "node:crypto";

export type TelegramUser = {
  id?: number | string;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
  [key: string]: unknown;
};

export type ValidatedTelegramInitData = {
  telegramUserId: string;
  user: TelegramUser;
  authDate: number;
};

export type ValidateTelegramInitDataOptions = {
  now: number | Date;
  maxAgeSeconds: number;
};

export type TelegramInitDataValidationErrorCode =
  | "MISSING_HASH"
  | "MISSING_AUTH_DATE"
  | "INVALID_AUTH_DATE"
  | "EXPIRED_AUTH_DATE"
  | "INVALID_HASH"
  | "INVALID_USER"
  | "MISSING_USER_ID";

export class TelegramInitDataValidationError extends Error {
  public readonly code: TelegramInitDataValidationErrorCode;

  constructor(code: TelegramInitDataValidationErrorCode, message: string) {
    super(message);
    this.name = "TelegramInitDataValidationError";
    this.code = code;
  }
}

export function validateTelegramInitData(
  initData: string,
  botToken: string,
  options: ValidateTelegramInitDataOptions
): ValidatedTelegramInitData {
  const nowSeconds = normalizeEpochSeconds(options.now);
  const maxAgeSeconds = assertPositiveInteger(options.maxAgeSeconds, "maxAgeSeconds");
  const params = new URLSearchParams(stripLeadingQuestionMark(initData));

  const hash = params.get("hash");
  if (!hash) {
    throw new TelegramInitDataValidationError("MISSING_HASH", "Telegram init data is missing hash");
  }

  const authDateValue = params.get("auth_date");
  if (!authDateValue) {
    throw new TelegramInitDataValidationError(
      "MISSING_AUTH_DATE",
      "Telegram init data is missing auth_date"
    );
  }

  const authDate = parseStrictInteger(authDateValue, "auth_date");
  if (authDate > nowSeconds || nowSeconds - authDate > maxAgeSeconds) {
    throw new TelegramInitDataValidationError(
      "EXPIRED_AUTH_DATE",
      "Telegram init data is expired"
    );
  }

  const userValue = params.get("user");
  if (!userValue) {
    throw new TelegramInitDataValidationError("INVALID_USER", "Telegram init data is missing user");
  }

  const dataCheckString = buildDataCheckString(params);
  const expectedHash = computeTelegramInitDataHash(botToken, dataCheckString);
  const providedHash = normalizeHexHash(hash);

  if (!providedHash || !constantTimeEqualHex(expectedHash, providedHash)) {
    throw new TelegramInitDataValidationError("INVALID_HASH", "Telegram init data hash is invalid");
  }

  const user = parseUser(userValue);
  const telegramUserId = normalizeTelegramUserId(user.id);

  if (!telegramUserId) {
    throw new TelegramInitDataValidationError(
      "MISSING_USER_ID",
      "Telegram init data user.id is missing or invalid"
    );
  }

  return {
    telegramUserId,
    user,
    authDate
  };
}

function stripLeadingQuestionMark(value: string): string {
  return value.startsWith("?") ? value.slice(1) : value;
}

function normalizeEpochSeconds(value: number | Date): number {
  const seconds = value instanceof Date ? Math.floor(value.getTime() / 1000) : value;
  return assertPositiveInteger(seconds, "now");
}

function assertPositiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new TypeError(`${name} must be a non-negative integer`);
  }

  return value;
}

function parseStrictInteger(value: string, fieldName: string): number {
  if (!/^\d+$/.test(value)) {
    throw new TelegramInitDataValidationError(
      "INVALID_AUTH_DATE",
      `Telegram init data ${fieldName} must be an integer`
    );
  }

  const parsed = Number(value);

  if (!Number.isSafeInteger(parsed)) {
    throw new TelegramInitDataValidationError(
      "INVALID_AUTH_DATE",
      `Telegram init data ${fieldName} is not a safe integer`
    );
  }

  return parsed;
}

function parseUser(value: string): TelegramUser {
  try {
    const parsed = JSON.parse(value) as unknown;

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("user must be an object");
    }

    return parsed as TelegramUser;
  } catch {
    throw new TelegramInitDataValidationError("INVALID_USER", "Telegram init data user is invalid");
  }
}

function normalizeTelegramUserId(value: unknown): string | null {
  if (typeof value === "number") {
    return Number.isInteger(value) && value >= 0 ? String(value) : null;
  }

  if (typeof value === "string" && /^\d+$/.test(value)) {
    return value;
  }

  return null;
}

function buildDataCheckString(params: URLSearchParams): string {
  const entries = Array.from(params.entries())
    .filter(([key]) => key !== "hash")
    .sort(compareEntries)
    .map(([key, value]) => `${key}=${value}`);

  return entries.join("\n");
}

function compareEntries(left: [string, string], right: [string, string]): number {
  if (left[0] < right[0]) {
    return -1;
  }

  if (left[0] > right[0]) {
    return 1;
  }

  if (left[1] < right[1]) {
    return -1;
  }

  if (left[1] > right[1]) {
    return 1;
  }

  return 0;
}

function computeTelegramInitDataHash(botToken: string, dataCheckString: string): string {
  const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();
  return createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
}

function normalizeHexHash(hash: string): string | null {
  const normalized = hash.trim().toLowerCase();
  return /^[0-9a-f]{64}$/.test(normalized) ? normalized : null;
}

function constantTimeEqualHex(leftHex: string, rightHex: string): boolean {
  const left = Buffer.from(leftHex, "hex");
  const right = Buffer.from(rightHex, "hex");

  if (left.length !== right.length) {
    return false;
  }

  return timingSafeEqual(left, right);
}

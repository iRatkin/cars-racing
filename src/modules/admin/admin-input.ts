export class AdminInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdminInputError";
  }
}

export function parseIntegerStrict(
  raw: string,
  label: string,
  options: { min?: number; max?: number } = {}
): number {
  const trimmed = raw.trim();
  if (!/^-?\d+$/.test(trimmed)) {
    throw new AdminInputError(`Invalid ${label}. Enter an integer number.`);
  }
  const value = Number(trimmed);
  if (!Number.isInteger(value) || !Number.isFinite(value)) {
    throw new AdminInputError(`Invalid ${label}. Enter an integer number.`);
  }
  if (options.min !== undefined && value < options.min) {
    throw new AdminInputError(`${label} must be >= ${options.min}.`);
  }
  if (options.max !== undefined && value > options.max) {
    throw new AdminInputError(`${label} must be <= ${options.max}.`);
  }
  return value;
}

export function parseNonNegativeIntegerStrict(raw: string, label: string): number {
  return parseIntegerStrict(raw, label, { min: 0 });
}

export function parsePositiveIntegerStrict(raw: string, label: string): number {
  return parseIntegerStrict(raw, label, { min: 1 });
}

export function parseDateUtcStrict(raw: string, label: string): Date {
  const trimmed = raw.trim();
  const match = trimmed.match(
    /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?(?:\s*(?:UTC|Z))?$/i
  );
  if (!match) {
    throw new AdminInputError(
      `Invalid ${label}. Use format YYYY-MM-DD HH:MM (UTC).`
    );
  }
  const [, y, mo, d, h, mi, s] = match;
  const ms = Date.UTC(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(h),
    Number(mi),
    s ? Number(s) : 0
  );
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) {
    throw new AdminInputError(
      `Invalid ${label}. Use format YYYY-MM-DD HH:MM (UTC).`
    );
  }
  const matchesBack =
    date.getUTCFullYear() === Number(y) &&
    date.getUTCMonth() === Number(mo) - 1 &&
    date.getUTCDate() === Number(d) &&
    date.getUTCHours() === Number(h) &&
    date.getUTCMinutes() === Number(mi);
  if (!matchesBack) {
    throw new AdminInputError(
      `Invalid ${label}. Calendar date is out of range.`
    );
  }
  return date;
}

export function parsePrizePoolShareStrict(raw: string): number {
  const trimmed = raw.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new AdminInputError(
      "Invalid prize pool share. Enter a number between 0 and 1 (e.g. 0.1)."
    );
  }
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new AdminInputError(
      "Invalid prize pool share. Must be between 0 and 1."
    );
  }
  return value;
}

export function parseBooleanStrict(raw: string, label: string): boolean {
  const normalized = raw.trim().toLowerCase();
  if (["y", "yes", "true", "1"].includes(normalized)) {
    return true;
  }
  if (["n", "no", "false", "0"].includes(normalized)) {
    return false;
  }
  throw new AdminInputError(`Invalid ${label}. Answer yes or no.`);
}

export function escapeHtml(value: string | undefined | null): string {
  if (value === undefined || value === null) {
    return "";
  }
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

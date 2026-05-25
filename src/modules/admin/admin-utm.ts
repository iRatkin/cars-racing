import { createHash } from "node:crypto";

const MOSCOW_DAY_MS = 24 * 60 * 60 * 1000;
const UTM_SOURCE_CALLBACK_PREFIX = "utmsrc";

export interface UtmDayRange {
  todayStart: Date;
  tomorrowStart: Date;
  yesterdayStart: Date;
}

export function buildUtmSourceCallbackData(utmSource: string): string {
  return `${UTM_SOURCE_CALLBACK_PREFIX}:${buildUtmSourceCallbackHash(utmSource)}`;
}

export function buildUtmSourceCallbackHash(utmSource: string): string {
  return createHash("sha256").update(utmSource).digest("base64url").slice(0, 22);
}

export function parseUtmSourceCallbackData(data: string): string | null {
  const [prefix, hash] = data.split(":");
  if (prefix !== UTM_SOURCE_CALLBACK_PREFIX || !hash) {
    return null;
  }
  return hash;
}

export function getMoscowUtmDayRange(now: Date): UtmDayRange {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(now);
  const getPart = (type: string) => parts.find((part) => part.type === type)?.value;
  const year = getPart("year");
  const month = getPart("month");
  const day = getPart("day");
  if (!year || !month || !day) {
    throw new Error("Could not compute Moscow date range");
  }

  const todayStart = new Date(`${year}-${month}-${day}T00:00:00+03:00`);
  return {
    todayStart,
    tomorrowStart: new Date(todayStart.getTime() + MOSCOW_DAY_MS),
    yesterdayStart: new Date(todayStart.getTime() - MOSCOW_DAY_MS)
  };
}

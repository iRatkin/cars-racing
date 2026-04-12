import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import { validateTelegramInitData } from "../../../src/modules/auth/telegram-init-data.js";

type TestUser = {
  id?: number | string;
  first_name?: string;
  last_name?: string;
  username?: string;
};

function buildSignedInitData(params: {
  botToken: string;
  authDate: number;
  user: TestUser;
  extra?: Record<string, string>;
  includeHash?: boolean;
  hashOverride?: string;
}): string {
  const searchParams = new URLSearchParams();

  searchParams.set("auth_date", String(params.authDate));
  searchParams.set("user", JSON.stringify(params.user));
  searchParams.set("query_id", params.extra?.query_id ?? "query-id");

  for (const [key, value] of Object.entries(params.extra ?? {})) {
    if (key === "query_id") {
      continue;
    }

    searchParams.set(key, value);
  }

  const dataCheckString = Array.from(searchParams.entries())
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const secretKey = createHmac("sha256", "WebAppData")
    .update(params.botToken)
    .digest();

  const hash = createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");

  if (params.includeHash === false) {
    return searchParams.toString();
  }

  searchParams.set("hash", params.hashOverride ?? hash);

  return searchParams.toString();
}

describe("validateTelegramInitData", () => {
  const botToken = "123456:ABCDEF";
  const now = 1_700_000_000;
  const maxAgeSeconds = 900;

  it("validates signed init data and normalizes user id", () => {
    const initData = buildSignedInitData({
      botToken,
      authDate: now - 60,
      user: {
        id: 123456789,
        first_name: "Ada",
        username: "ada"
      }
    });

    const result = validateTelegramInitData(initData, botToken, {
      now,
      maxAgeSeconds
    });

    expect(result.telegramUserId).toBe("123456789");
    expect(result.user).toEqual({
      id: 123456789,
      first_name: "Ada",
      username: "ada"
    });
    expect(result.authDate).toBe(now - 60);
  });

  it("rejects missing hash", () => {
    const initData = buildSignedInitData({
      botToken,
      authDate: now - 60,
      user: {
        id: 123456789,
        first_name: "Ada"
      },
      includeHash: false
    });

    expect(() =>
      validateTelegramInitData(initData, botToken, {
        now,
        maxAgeSeconds
      })
    ).toThrowError();
  });

  it("rejects invalid hash", () => {
    const initData = buildSignedInitData({
      botToken,
      authDate: now - 60,
      user: {
        id: 123456789,
        first_name: "Ada"
      },
      hashOverride: "deadbeef"
    });

    expect(() =>
      validateTelegramInitData(initData, botToken, {
        now,
        maxAgeSeconds
      })
    ).toThrowError();
  });

  it("rejects expired auth_date", () => {
    const initData = buildSignedInitData({
      botToken,
      authDate: now - (maxAgeSeconds + 1),
      user: {
        id: 123456789,
        first_name: "Ada"
      }
    });

    expect(() =>
      validateTelegramInitData(initData, botToken, {
        now,
        maxAgeSeconds
      })
    ).toThrowError();
  });

  it("rejects missing user id", () => {
    const initData = buildSignedInitData({
      botToken,
      authDate: now - 60,
      user: {
        first_name: "Ada"
      }
    });

    expect(() =>
      validateTelegramInitData(initData, botToken, {
        now,
        maxAgeSeconds
      })
    ).toThrowError();
  });

  it("normalizes numeric user id to decimal string", () => {
    const initData = buildSignedInitData({
      botToken,
      authDate: now - 60,
      user: {
        id: 987654321,
        first_name: "Lin"
      }
    });

    const result = validateTelegramInitData(initData, botToken, {
      now,
      maxAgeSeconds
    });

    expect(result.telegramUserId).toBe("987654321");
  });
});

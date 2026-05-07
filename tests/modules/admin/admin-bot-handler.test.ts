import { afterEach, describe, expect, test, vi } from "vitest";

import {
  createAdminBotHandler,
  type CreateAdminBotHandlerDeps
} from "../../../src/modules/admin/admin-bot-handler.js";
import { ADMIN_BTN } from "../../../src/modules/admin/admin-keyboards.js";
import { ADMIN_SESSION_TTL_MS } from "../../../src/modules/admin/admin-session.js";
import type { CatalogCar } from "../../../src/modules/cars-catalog/cars-catalog-repository.js";
import type { PurchaseStatsSummary } from "../../../src/modules/payments/purchases-repository.js";
import type { Season } from "../../../src/modules/seasons/seasons-domain.js";
import type { AppUser } from "../../../src/modules/users/users-repository.js";

interface SentMessage {
  chat_id: number | string;
  text: string;
  parse_mode?: string;
  reply_markup?: unknown;
}

describe("createAdminBotHandler", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test("opens main menu when authorized text arrives without a session", async () => {
    const { handler, sentMessages } = buildHandler();

    await handler(textUpdate({ text: "stale keyboard tap" }));

    expect(sentMessages).toHaveLength(2);
    expect(sentMessages[0]?.text).toContain("Session was reset");
    expect(sentMessages[0]?.parse_mode).toBe("HTML");
    expect(sentMessages[1]?.text).toContain("<b>Admin Bot</b>");

    sentMessages.length = 0;
    await handler(textUpdate({ text: ADMIN_BTN.MAIN_USERS }));

    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0]?.text).toContain("<b>Users Management</b>");
  });

  test("replaces expired sessions and responds instead of ignoring text", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-05T10:00:00.000Z"));
    const { handler, sentMessages } = buildHandler();

    await handler(textUpdate({ text: "/menu" }));
    expect(sentMessages).toHaveLength(1);

    sentMessages.length = 0;
    vi.setSystemTime(new Date(Date.now() + ADMIN_SESSION_TTL_MS + 1));
    await handler(textUpdate({ text: "old text after ttl" }));

    expect(sentMessages).toHaveLength(2);
    expect(sentMessages[0]?.text).toContain("Session was reset");
    expect(sentMessages[1]?.text).toContain("<b>Admin Bot</b>");

    sentMessages.length = 0;
    await handler(textUpdate({ text: ADMIN_BTN.MAIN_USERS }));

    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0]?.text).toContain("<b>Users Management</b>");
  });

  test("silently ignores unauthorized senders", async () => {
    const { handler, sentMessages } = buildHandler();

    await handler(textUpdate({ fromId: 99, text: "stale keyboard tap" }));

    expect(sentMessages).toEqual([]);
  });

  test("keeps normal slash menu behavior", async () => {
    const { handler, sentMessages } = buildHandler();

    await handler(textUpdate({ text: "/menu" }));

    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0]?.text).toContain("<b>Admin Bot</b>");
  });
});

function buildHandler() {
  const sentMessages: SentMessage[] = [];
  const cars: CatalogCar[] = [];
  const seasons: Season[] = [];
  const users: AppUser[] = [];
  const purchaseStats: PurchaseStatsSummary = {
    activeIntents: 0,
    grantedTotal: 0,
    grantedLast24h: 0,
    coinsGrantedTotal: 0,
    starsRevenueTotal: 0
  };

  const deps: CreateAdminBotHandlerDeps = {
    allowedTelegramIds: ["42"],
    pendingActionsSweepIntervalMs: 0,
    telegramOptions: {
      botToken: "test-token",
      fetchImpl: async (input, init) => {
        if (input.endsWith("/sendMessage")) {
          sentMessages.push(JSON.parse(init.body) as SentMessage);
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({ ok: true, result: true })
        };
      }
    },
    usersRepository: {
      async upsertTelegramUser() {
        throw new Error("not used");
      },
      async getUserById(userId: string) {
        return users.find((item) => item.userId === userId) ?? null;
      },
      async getUserByNickNormalized() {
        return null;
      },
      async setInitialNick() {
        return null;
      },
      async changeNickIfCurrentNick() {
        return null;
      },
      async changeNickWithRaceCoins() {
        return null;
      },
      async addRaceCoins(userId: string, amount: number) {
        const updated = user(userId, amount);
        users.push(updated);
        return updated;
      },
      async spendRaceCoins() {
        return null;
      },
      async addOwnedCar() {
        return null;
      },
      async setUtmIfNotSet() {},
      async getUserByTelegramId(telegramUserId: string) {
        return users.find((item) => item.telegramUserId === telegramUserId) ?? null;
      },
      async getUserByUsername(username: string) {
        return users.find((item) => item.username === username) ?? null;
      },
      async setRaceCoinsBalance(userId: string, amount: number) {
        const updated = user(userId, amount);
        users.push(updated);
        return updated;
      },
      async getUserCount() {
        return users.length;
      },
      async getTopUtmSources() {
        return [];
      },
      async getUtmSourcesSince() {
        return [];
      },
      async getAllUsers() {
        return users;
      }
    },
    carsCatalogRepository: {
      async getActiveSortedByOrder() {
        return cars;
      },
      async getById(carId: string) {
        return cars.find((item) => item.carId === carId) ?? null;
      },
      async getAllCars() {
        return cars;
      },
      async upsertCar(car: CatalogCar) {
        cars.push(car);
        return car;
      },
      async setCarActive() {
        return null;
      },
      async getMaxSortOrder() {
        return 0;
      }
    },
    seasonsRepository: {
      async getSeasonById(seasonId: string) {
        return seasons.find((item) => item.seasonId === seasonId) ?? null;
      },
      async getActiveAndUpcomingSeasons() {
        return seasons;
      },
      async getAllSeasons() {
        return seasons;
      },
      async findSeasonForWindow() {
        return null;
      },
      async findLatestSeasonBefore() {
        return null;
      },
      async createSeason() {
        throw new Error("not used");
      },
      async updateSeason() {
        return null;
      }
    },
    purchasesRepository: {
      async findActiveIntent() {
        return null;
      },
      async findByInvoicePayload() {
        return null;
      },
      async createIntent() {
        throw new Error("not used");
      },
      async setInvoiceUrl() {},
      async updateStatus() {},
      async markGranted() {},
      async expireIntent() {},
      async getStatsSummary() {
        return purchaseStats;
      }
    }
  };

  return {
    handler: createAdminBotHandler(deps),
    sentMessages
  };
}

function textUpdate(input: {
  text: string;
  fromId?: number;
  chatId?: number;
}) {
  return {
    update_id: 1,
    message: {
      message_id: 1,
      from: {
        id: input.fromId ?? 42,
        first_name: "Admin"
      },
      chat: { id: input.chatId ?? 777 },
      text: input.text
    }
  };
}

function user(userId: string, raceCoinsBalance = 0): AppUser {
  return {
    userId,
    telegramUserId: userId.replace(/^usr_/, ""),
    username: userId,
    ownedCarIds: [],
    garageRevision: 0,
    raceCoinsBalance
  };
}

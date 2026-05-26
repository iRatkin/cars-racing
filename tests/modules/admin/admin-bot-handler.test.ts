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
import type { SeasonLifecycleSource } from "../../../src/modules/season-automation/season-automation-service.js";
import type {
  AppUser,
  UserUtmSourceDetails,
  UtmSourceCount,
  UtmSourceDetailsQuery
} from "../../../src/modules/users/users-repository.js";

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

  test("shows UTM source buttons from the users menu", async () => {
    const { handler, sentMessages } = buildHandler({
      utmSources: [
        { utmSource: "blogger", count: 4 },
        { utmSource: "direct", count: 2 }
      ]
    });

    await handler(textUpdate({ text: "/menu" }));
    await handler(textUpdate({ text: ADMIN_BTN.MAIN_USERS }));
    sentMessages.length = 0;

    await handler(textUpdate({ text: ADMIN_BTN.USERS_UTM_DETAILS }));

    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0]?.text).toBe("📊 <b>UTM details</b>\n\nChoose a source:");
    expect(sentMessages[0]?.reply_markup).toMatchObject({
      inline_keyboard: [
        [
          {
            text: "blogger (4)",
            callback_data: expect.stringMatching(/^utmsrc:[A-Za-z0-9_-]+$/)
          },
          {
            text: "direct (2)",
            callback_data: expect.stringMatching(/^utmsrc:[A-Za-z0-9_-]+$/)
          }
        ]
      ]
    });
  });

  test("shows today yesterday and total counts for a selected UTM source", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-25T12:34:00.000Z"));
    const detailsQueries: UtmSourceDetailsQuery[] = [];
    const { handler, sentMessages } = buildHandler({
      utmSources: [{ utmSource: "blogger", count: 9 }],
      utmDetails: {
        utmSource: "blogger",
        todayCount: 3,
        yesterdayCount: 2,
        totalCount: 9
      },
      onUtmDetailsQuery: (query) => detailsQueries.push(query)
    });

    await handler(textUpdate({ text: "/menu" }));
    await handler(textUpdate({ text: ADMIN_BTN.MAIN_USERS }));
    sentMessages.length = 0;
    await handler(textUpdate({ text: ADMIN_BTN.USERS_UTM_DETAILS }));
    const markup = sentMessages[0]?.reply_markup as {
      inline_keyboard: Array<Array<{ callback_data: string }>>;
    };
    const callbackData = markup.inline_keyboard[0]?.[0]?.callback_data;
    expect(callbackData).toBeTruthy();

    sentMessages.length = 0;
    await handler(callbackUpdate({ data: callbackData ?? "" }));

    expect(detailsQueries).toEqual([
      {
        utmSource: "blogger",
        todayStart: new Date("2026-05-24T21:00:00.000Z"),
        tomorrowStart: new Date("2026-05-25T21:00:00.000Z"),
        yesterdayStart: new Date("2026-05-23T21:00:00.000Z")
      }
    ]);
    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0]?.text).toBe(
      "📊 <b>UTM source: blogger</b>\n\n" +
        "Сегодня: <b>3</b>\n" +
        "Вчера: <b>2</b>\n" +
        "Всего: <b>9</b>"
    );
  });

  test("finishes a season through the lifecycle service", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-25T15:00:00.000Z"));
    const finishCalls: Array<{
      seasonId: string;
      now: Date;
      source: SeasonLifecycleSource;
    }> = [];
    const activeSeason = season(
      "sea_active",
      "2026-05-20T15:00:00.000Z",
      "2026-05-27T15:00:00.000Z"
    );
    const { handler, sentMessages } = buildHandler({
      seasons: [activeSeason],
      onFinishSeasonNow: (seasonId, now, source) => {
        finishCalls.push({ seasonId, now, source });
        return {
          ...activeSeason,
          endsAt: now,
          status: "finished"
        };
      }
    });

    await handler(textUpdate({ text: "/seasons" }));
    const seasonsList = sentMessages.find(
      (message) => (message.reply_markup as { inline_keyboard?: unknown } | undefined)?.inline_keyboard
    );
    const markup = seasonsList?.reply_markup as {
      inline_keyboard?: Array<Array<{ callback_data: string }>>;
    };
    const callbackData = markup.inline_keyboard?.[0]?.[0]?.callback_data;
    expect(callbackData).toBe("editseason:sea_active");
    await handler(callbackUpdate({ data: callbackData ?? "" }));

    sentMessages.length = 0;
    await handler(textUpdate({ text: ADMIN_BTN.SEASON_FINISH }));
    await handler(textUpdate({ text: ADMIN_BTN.CONFIRM_FINISH }));

    expect(finishCalls).toEqual([
      {
        seasonId: "sea_active",
        now: new Date("2026-05-25T15:00:00.000Z"),
        source: "admin"
      }
    ]);
    expect(sentMessages.at(-1)?.text).toContain("✅ Season finished.");
  });
});

function buildHandler(options: {
  utmSources?: UtmSourceCount[];
  utmDetails?: UserUtmSourceDetails;
  onUtmDetailsQuery?: (query: UtmSourceDetailsQuery) => void;
  seasons?: Season[];
  onFinishSeasonNow?: (
    seasonId: string,
    now: Date,
    source: SeasonLifecycleSource
  ) => Season | null;
} = {}) {
  const sentMessages: SentMessage[] = [];
  const cars: CatalogCar[] = [];
  const seasons: Season[] = [...(options.seasons ?? [])];
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
      async setNick() {
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
      async getAllUtmSources() {
        return options.utmSources ?? [];
      },
      async getUtmSourcesSince() {
        return [];
      },
      async getUtmSourceDetails(query: UtmSourceDetailsQuery) {
        options.onUtmDetailsQuery?.(query);
        return (
          options.utmDetails ?? {
            utmSource: query.utmSource,
            todayCount: 0,
            yesterdayCount: 0,
            totalCount: 0
          }
        );
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
    },
    seasonLifecycle: {
      async runOnce() {},
      async runScheduledTick() {},
      async finishSeasonNow(seasonId: string, now: Date, source: SeasonLifecycleSource) {
        return options.onFinishSeasonNow?.(seasonId, now, source) ?? null;
      },
      async syncManualSeasonChange() {}
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

function callbackUpdate(input: {
  data: string;
  fromId?: number;
  chatId?: number;
}) {
  return {
    update_id: 1,
    callback_query: {
      id: "callback_1",
      from: {
        id: input.fromId ?? 42,
        first_name: "Admin"
      },
      message: {
        message_id: 1,
        chat: { id: input.chatId ?? 777 }
      },
      data: input.data
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

function season(seasonId: string, startsAt: string, endsAt: string): Season {
  return {
    seasonId,
    title: "Weekly Cup",
    mapId: "map_1",
    entryFee: 25,
    prizePoolShare: 0.2,
    startsAt: new Date(startsAt),
    endsAt: new Date(endsAt),
    status: "active"
  };
}

import { describe, expect, test } from "vitest";

import { createSeasonAutomationService } from "../../../src/modules/season-automation/season-automation-service.js";
import type { JobEventClaimInput } from "../../../src/modules/season-automation/job-events-repository.js";
import type { Season, SeasonEntry } from "../../../src/modules/seasons/seasons-domain.js";
import type { CreateSeasonInput } from "../../../src/modules/seasons/seasons-repository.js";
import type { AppUser } from "../../../src/modules/users/users-repository.js";

describe("season automation service", () => {
  test("clones the latest previous season when the current weekly window is empty", async () => {
    const deps = buildDeps({
      seasons: [season("sea_prev", "2026-04-22T17:00:00.000Z", "2026-04-29T17:00:00.000Z")]
    });
    const service = createSeasonAutomationService(deps);

    await service.runOnce(new Date("2026-04-29T17:05:00.000Z"));

    expect(deps.createdSeasons).toEqual([
      {
        title: "Weekly Cup",
        mapId: "map_1",
        entryFee: 25,
        prizePoolShare: 0.2,
        startsAt: new Date("2026-04-29T17:00:00.000Z"),
        endsAt: new Date("2026-05-06T17:00:00.000Z")
      }
    ]);
  });

  test("does not clone when an admin-created season already exists for the window", async () => {
    const deps = buildDeps({
      seasons: [season("sea_manual", "2026-04-29T17:00:00.000Z", "2026-05-06T17:00:00.000Z")]
    });
    const service = createSeasonAutomationService(deps);

    await service.runOnce(new Date("2026-04-29T17:05:00.000Z"));

    expect(deps.createdSeasons).toEqual([]);
  });

  test("sends due player notifications once", async () => {
    const deps = buildDeps({
      seasons: [season("sea_active", "2026-04-22T17:00:00.000Z", "2026-04-29T17:00:00.000Z")],
      users: [user("usr_1", "111", "Racer_1")]
    });
    const service = createSeasonAutomationService(deps);

    await service.runOnce(new Date("2026-04-28T17:01:00.000Z"));
    await service.runOnce(new Date("2026-04-28T17:02:00.000Z"));

    expect(deps.playerMessages).toContainEqual({
      chatId: "111",
      text:
        "🏁🔥 Турнир начался!\n" +
        "Заезжай в RACEDRIFT, набирай очки и сражайся за реальный приз 🏆\n" +
        "Дата окончания: 29.04.2026, 20:00 МСК"
    });
    expect(deps.playerMessages).toContainEqual({
      chatId: "111",
      text:
        "⏳🏎️ Турнир скоро закончится!\n" +
        "У тебя ещё есть шанс улучшить результат и побороться за главный приз 🏁\n" +
        "Дата окончания: 29.04.2026, 20:00 МСК"
    });
    expect(deps.playerMessages.length).toBe(3);
  });

  test("sends finished top-3 winners to admins and ordinary users after season end", async () => {
    const deps = buildDeps({
      seasons: [season("sea_done", "2026-04-22T17:00:00.000Z", "2026-04-29T17:00:00.000Z")],
      users: [
        user("usr_1", "111", "Champion", "champion_tg"),
        user("usr_2", "222", "RunnerUp", "runner_tg"),
        user("usr_3", "333", "Bronze", "bronze_tg"),
        user("usr_4", "444", "Fourth", "fourth_tg")
      ],
      leaderboard: [
        {
          entryId: "entry_1",
          seasonId: "sea_done",
          userId: "usr_1",
          bestScore: 2000,
          totalRaces: 4,
          entryFeeSnapshot: 25,
          createdAt: new Date("2026-04-22T18:00:00.000Z")
        },
        {
          entryId: "entry_2",
          seasonId: "sea_done",
          userId: "usr_2",
          bestScore: 1900,
          totalRaces: 4,
          entryFeeSnapshot: 25,
          createdAt: new Date("2026-04-22T18:01:00.000Z")
        },
        {
          entryId: "entry_3",
          seasonId: "sea_done",
          userId: "usr_3",
          bestScore: 1800,
          totalRaces: 4,
          entryFeeSnapshot: 25,
          createdAt: new Date("2026-04-22T18:02:00.000Z")
        },
        {
          entryId: "entry_4",
          seasonId: "sea_done",
          userId: "usr_4",
          bestScore: 1700,
          totalRaces: 4,
          entryFeeSnapshot: 25,
          createdAt: new Date("2026-04-22T18:03:00.000Z")
        }
      ]
    });
    const service = createSeasonAutomationService(deps);

    await service.runOnce(new Date("2026-04-29T17:01:00.000Z"));

    expect(deps.adminMessages).toHaveLength(1);
    expect(deps.adminMessages[0]?.chatId).toBe("999");
    expect(deps.adminMessages[0]?.text).toBe(
      "🏆 Турнир завершён!\n" +
      "Победители для выдачи призов:\n" +
      "1. @champion_tg\n" +
      "2. @runner_tg\n" +
      "3. @bronze_tg"
    );
    expect(deps.adminMessages[0]?.text).not.toContain("Champion");
    expect(deps.adminMessages[0]?.text).not.toContain("Fourth");
    const finalMessage =
      "🏆 Турнир завершён!\n" +
      "Финальная таблица зафиксирована — вот победители, которые забрали приз в этом сезоне: Champion, RunnerUp, Bronze\n" +
      "Для получения призов — пишите на админский аккаунт @racedrift_admin";
    expect(deps.playerMessages.filter((message) => message.text === finalMessage)).toEqual([
      {
        chatId: "111",
        text: finalMessage
      },
      {
        chatId: "222",
        text: finalMessage
      },
      {
        chatId: "333",
        text: finalMessage
      },
      {
        chatId: "444",
        text: finalMessage
      }
    ]);
    expect(deps.leaderboardLimits).toEqual([3]);
  });

  test("does not count zero-score entries as finished season winners", async () => {
    const deps = buildDeps({
      seasons: [season("sea_done", "2026-04-22T17:00:00.000Z", "2026-04-29T17:00:00.000Z")],
      users: [user("usr_zero", "111", "ZeroScore", "zero_tg")],
      leaderboard: [
        {
          entryId: "entry_zero",
          seasonId: "sea_done",
          userId: "usr_zero",
          bestScore: 0,
          totalRaces: 1,
          entryFeeSnapshot: 25,
          createdAt: new Date("2026-04-22T18:00:00.000Z")
        }
      ]
    });
    const service = createSeasonAutomationService(deps);

    await service.runOnce(new Date("2026-04-29T17:01:00.000Z"));

    expect(deps.adminMessages[0]?.text).toBe(
      "🏆 Турнир завершён!\n" +
      "Победители для выдачи призов:\n" +
      "победителей нет"
    );
    const finalMessage =
      "🏆 Турнир завершён!\n" +
      "Финальная таблица зафиксирована — вот победители, которые забрали приз в этом сезоне: победителей нет\n" +
      "Для получения призов — пишите на админский аккаунт @racedrift_admin";
    expect(deps.playerMessages.filter((message) => message.text === finalMessage)).toEqual([
      {
        chatId: "111",
        text: finalMessage
      }
    ]);
    expect(deps.adminMessages[0]?.text).not.toContain("zero_tg");
    expect(finalMessage).not.toContain("ZeroScore");
  });

  test("sends finished top-3 winners to ordinary users when admin bot is not configured", async () => {
    const deps = buildDeps({
      adminTelegramIds: [],
      seasons: [season("sea_done", "2026-04-22T17:00:00.000Z", "2026-04-29T17:00:00.000Z")],
      users: [user("usr_1", "111", "Champion")],
      leaderboard: [
        {
          entryId: "entry_1",
          seasonId: "sea_done",
          userId: "usr_1",
          bestScore: 2000,
          totalRaces: 4,
          entryFeeSnapshot: 25,
          createdAt: new Date("2026-04-22T18:00:00.000Z")
        }
      ]
    });
    const service = createSeasonAutomationService(deps);

    await service.runOnce(new Date("2026-04-29T17:01:00.000Z"));

    expect(deps.claimedEventKeys).toContain(
      "season:sea_done:season_finished_admin_top10:2026-04-29T17:00:00.000Z"
    );
    expect(deps.adminMessages).toEqual([]);
    const finalMessage =
      "🏆 Турнир завершён!\n" +
      "Финальная таблица зафиксирована — вот победители, которые забрали приз в этом сезоне: Champion\n" +
      "Для получения призов — пишите на админский аккаунт @racedrift_admin";
    expect(deps.playerMessages.filter((message) => message.text === finalMessage)).toEqual([
      {
        chatId: "111",
        text: finalMessage
      }
    ]);
  });

  test("does not send a same-moment ending reminder when a one-day season starts", async () => {
    const deps = buildDeps({
      seasons: [season("sea_1d", "2026-05-25T15:00:00.000Z", "2026-05-26T15:00:00.000Z")],
      users: [user("usr_1", "111", "Racer_1")]
    });
    const service = createSeasonAutomationService(deps);

    await service.runScheduledTick(new Date("2026-05-25T15:01:00.000Z"));

    expect(deps.claimedEventKeys).toEqual([
      "season:sea_1d:season_started:2026-05-25T15:00:00.000Z"
    ]);
    expect(deps.playerMessages).toHaveLength(1);
    expect(deps.playerMessages[0]?.text).toContain("Турнир начался");
    expect(deps.playerMessages[0]?.text).not.toContain("Турнир скоро закончится");
  });

  test("sends an ending season before a starting season at the same boundary", async () => {
    const deps = buildDeps({
      seasons: [
        season("sea_old", "2026-05-18T15:00:00.000Z", "2026-05-25T15:00:00.000Z"),
        season("sea_new", "2026-05-25T15:00:00.000Z", "2026-05-26T15:00:00.000Z")
      ],
      users: [user("usr_1", "111", "Racer_1")],
      leaderboard: [
        {
          entryId: "entry_1",
          seasonId: "sea_old",
          userId: "usr_1",
          bestScore: 2000,
          totalRaces: 4,
          entryFeeSnapshot: 25,
          createdAt: new Date("2026-05-18T18:00:00.000Z")
        }
      ]
    });
    const service = createSeasonAutomationService(deps);

    await service.runScheduledTick(new Date("2026-05-25T15:01:00.000Z"));

    expect(deps.claimedEventKeys.slice(0, 2)).toEqual([
      "season:sea_old:season_finished_admin_top10:2026-05-25T15:00:00.000Z",
      "season:sea_new:season_started:2026-05-25T15:00:00.000Z"
    ]);
    expect(deps.playerMessages[0]?.text).toContain("Турнир завершён");
    expect(deps.playerMessages[1]?.text).toContain("Турнир начался");
  });

  test("finishSeasonNow sends the final once and suppresses stale reminders", async () => {
    const deps = buildDeps({
      seasons: [season("sea_manual", "2026-05-20T15:00:00.000Z", "2026-05-25T16:00:00.000Z")],
      users: [user("usr_1", "111", "Racer_1")]
    });
    const service = createSeasonAutomationService(deps);

    const first = await service.finishSeasonNow(
      "sea_manual",
      new Date("2026-05-25T15:00:00.000Z"),
      "admin"
    );
    const second = await service.finishSeasonNow(
      "sea_manual",
      new Date("2026-05-25T15:05:00.000Z"),
      "admin"
    );

    expect(first?.endsAt.toISOString()).toBe("2026-05-25T15:00:00.000Z");
    expect(second).toBeNull();
    expect(deps.playerMessages.filter((message) => message.text.includes("Турнир завершён"))).toHaveLength(1);
    expect(deps.suppressedEvents.map((event) => event.eventType)).toEqual([
      "season_ends_in_3d",
      "season_ends_in_1d",
      "season_ends_in_6h"
    ]);
  });

  test("syncManualSeasonChange starts a newly active season without ending reminders", async () => {
    const manualSeason = season(
      "sea_manual_new",
      "2026-05-25T15:00:00.000Z",
      "2026-05-26T15:00:00.000Z"
    );
    const deps = buildDeps({
      seasons: [manualSeason],
      users: [user("usr_1", "111", "Racer_1")]
    });
    const service = createSeasonAutomationService(deps);

    await service.syncManualSeasonChange(
      manualSeason.seasonId,
      null,
      manualSeason,
      new Date("2026-05-25T15:01:00.000Z"),
      "admin"
    );

    expect(deps.playerMessages).toHaveLength(1);
    expect(deps.playerMessages[0]?.text).toContain("Турнир начался");
    expect(deps.playerMessages[0]?.text).not.toContain("Турнир скоро закончится");
    expect(deps.suppressedEvents.map((event) => event.eventType)).toContain(
      "season_ends_in_1d"
    );
  });
});

function buildDeps(input: {
  seasons?: ReturnType<typeof season>[];
  users?: AppUser[];
  leaderboard?: SeasonEntry[];
  adminTelegramIds?: string[];
}) {
  const seasons = [...(input.seasons ?? [])];
  const users = [...(input.users ?? [])];
  const leaderboard = [...(input.leaderboard ?? [])];
  const claimedEvents = new Set<string>();
  const claimedEventKeys: string[] = [];
  const createdSeasons: CreateSeasonInput[] = [];
  const playerMessages: Array<{ chatId: string; text: string }> = [];
  const adminMessages: Array<{ chatId: string; text: string }> = [];
  const leaderboardLimits: number[] = [];
  const suppressedEvents: Array<{
    eventKey: string;
    eventType: string;
    reason: string;
  }> = [];

  return {
    createdSeasons,
    playerMessages,
    adminMessages,
    leaderboardLimits,
    claimedEventKeys,
    suppressedEvents,
    seasonsRepository: {
      async getSeasonById(seasonId: string, referenceNow: Date) {
        return seasons.find((item) => item.seasonId === seasonId) ?? null;
      },
      async getActiveAndUpcomingSeasons(referenceNow: Date) {
        return seasons.filter((item) => item.endsAt.getTime() > referenceNow.getTime());
      },
      async getAllSeasons(referenceNow: Date) {
        return seasons;
      },
      async findSeasonForWindow(windowStart: Date, windowEnd: Date) {
        return (
          seasons.find(
            (item) =>
              (item.startsAt.getTime() <= windowStart.getTime() &&
                item.endsAt.getTime() > windowStart.getTime()) ||
              (item.startsAt.getTime() >= windowStart.getTime() &&
                item.startsAt.getTime() < windowEnd.getTime())
          ) ?? null
        );
      },
      async findLatestSeasonBefore(windowStart: Date) {
        return (
          [...seasons]
            .filter((item) => item.startsAt.getTime() < windowStart.getTime())
            .sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime())[0] ?? null
        );
      },
      async createSeason(createInput: CreateSeasonInput, referenceNow: Date) {
        createdSeasons.push(createInput);
        const created = season(
          `sea_created_${createdSeasons.length}`,
          createInput.startsAt.toISOString(),
          createInput.endsAt.toISOString()
        );
        created.title = createInput.title;
        created.mapId = createInput.mapId;
        created.entryFee = createInput.entryFee;
        created.prizePoolShare = createInput.prizePoolShare;
        seasons.push(created);
        return created;
      },
      async updateSeason(seasonId: string, patch: Partial<ReturnType<typeof season>>, referenceNow: Date) {
        const index = seasons.findIndex((item) => item.seasonId === seasonId);
        if (index === -1) {
          return null;
        }
        seasons[index] = {
          ...seasons[index],
          ...patch,
          status: computeStatus(
            {
              startsAt: patch.startsAt ?? seasons[index].startsAt,
              endsAt: patch.endsAt ?? seasons[index].endsAt
            },
            referenceNow
          )
        };
        return seasons[index];
      }
    },
    seasonEntriesRepository: {
      async findEntry() {
        return null;
      },
      async createEntry() {
        throw new Error("not used");
      },
      async updateBestScore() {},
      async incrementTotalRaces() {},
      async getLeaderboard(seasonId: string, limit: number) {
        leaderboardLimits.push(limit);
        return leaderboard.filter((entry) => entry.seasonId === seasonId).slice(0, limit);
      },
      async getEntryRank() {
        return null;
      },
      async countEntries(seasonId: string) {
        return leaderboard.filter((entry) => entry.seasonId === seasonId).length;
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
      async addRaceCoins() {
        throw new Error("not used");
      },
      async spendRaceCoins() {
        return null;
      },
      async addOwnedCar() {
        return null;
      },
      async setUtmIfNotSet() {},
      async getUserByTelegramId() {
        return null;
      },
      async getUserByUsername() {
        return null;
      },
      async setRaceCoinsBalance() {
        throw new Error("not used");
      },
      async getUserCount() {
        return users.length;
      },
      async getTopUtmSources() {
        return [];
      },
      async getAllUtmSources() {
        return [];
      },
      async getUtmSourcesSince() {
        return [];
      },
      async getUtmSourceDetails() {
        return {
          utmSource: "direct",
          todayCount: 0,
          yesterdayCount: 0,
          totalCount: 0
        };
      },
      async getAllUsers() {
        return users;
      }
    },
    jobEventsRepository: {
      async claimEvent(event: JobEventClaimInput) {
        if (claimedEvents.has(event.eventKey)) {
          return {
            claimed: false,
            eventKey: event.eventKey,
            scheduledAt: event.scheduledAt
          };
        }
        claimedEvents.add(event.eventKey);
        claimedEventKeys.push(event.eventKey);
        return {
          claimed: true,
          eventKey: event.eventKey,
          scheduledAt: event.scheduledAt
        };
      },
      async markCompleted() {},
      async markFailed() {},
      async suppressEvent(event: { eventKey: string; eventType: string; reason: string }) {
        suppressedEvents.push(event);
        claimedEvents.add(event.eventKey);
      }
    },
    telegram: {
      async sendPlayerMessage(message: { chatId: string; text: string }) {
        playerMessages.push(message);
      },
      async sendAdminMessage(message: { chatId: string; text: string }) {
        adminMessages.push(message);
      }
    },
    adminTelegramIds: input.adminTelegramIds ?? ["999"],
    logger: {
      info() {},
      warn() {},
      error() {}
    }
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
    status: "finished" as const
  };
}

function computeStatus(
  season: { startsAt: Date; endsAt: Date },
  referenceNow: Date
): "upcoming" | "active" | "finished" {
  if (referenceNow.getTime() < season.startsAt.getTime()) {
    return "upcoming";
  }
  if (referenceNow.getTime() >= season.endsAt.getTime()) {
    return "finished";
  }
  return "active";
}

function user(
  userId: string,
  telegramUserId: string,
  nick: string,
  username?: string
): AppUser {
  return {
    userId,
    telegramUserId,
    firstName: nick,
    username,
    nick,
    nickNormalized: nick.toLowerCase(),
    ownedCarIds: [],
    selectedCarId: null,
    garageRevision: 0,
    raceCoinsBalance: 0
  };
}

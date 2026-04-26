import { describe, expect, test } from "vitest";

import { createSeasonAutomationService } from "../../../src/modules/season-automation/season-automation-service.js";
import type { JobEventClaimInput } from "../../../src/modules/season-automation/job-events-repository.js";
import type { SeasonEntry } from "../../../src/modules/seasons/seasons-domain.js";
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
      text: "Дружище Racer_1 - новый сезон начался, торопись дрифтить!"
    });
    expect(deps.playerMessages).toContainEqual({
      chatId: "111",
      text: "Дружище Racer_1 - поторопись, сезон заканчивается!"
    });
    expect(deps.playerMessages.length).toBe(3);
  });

  test("sends admin finished top-10 after season end", async () => {
    const deps = buildDeps({
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

    expect(deps.adminMessages).toHaveLength(1);
    expect(deps.adminMessages[0]?.chatId).toBe("999");
    expect(deps.adminMessages[0]?.text).toContain("Champion");
    expect(deps.adminMessages[0]?.text).toContain("2000");
  });

  test("does not claim admin finished event when admin bot is not configured", async () => {
    const deps = buildDeps({
      adminTelegramIds: [],
      seasons: [season("sea_done", "2026-04-22T17:00:00.000Z", "2026-04-29T17:00:00.000Z")]
    });
    const service = createSeasonAutomationService(deps);

    await service.runOnce(new Date("2026-04-29T17:01:00.000Z"));

    expect(deps.claimedEventKeys).not.toContain(
      "season:sea_done:season_finished_admin_top10:2026-04-29T17:00:00.000Z"
    );
    expect(deps.adminMessages).toEqual([]);
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

  return {
    createdSeasons,
    playerMessages,
    adminMessages,
    claimedEventKeys,
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
      async updateSeason() {
        return null;
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
      async changeNickWithRaceCoins() {
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
      async getUtmSourcesSince() {
        return [];
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
      async markFailed() {}
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

function season(seasonId: string, startsAt: string, endsAt: string) {
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

function user(userId: string, telegramUserId: string, nick: string): AppUser {
  return {
    userId,
    telegramUserId,
    firstName: nick,
    nick,
    nickNormalized: nick.toLowerCase(),
    ownedCarIds: [],
    selectedCarId: null,
    garageRevision: 0,
    raceCoinsBalance: 0
  };
}

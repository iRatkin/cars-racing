import type { SeasonEntry } from "../seasons/seasons-domain.js";
import type { SeasonEntriesRepository } from "../seasons/season-entries-repository.js";
import type {
  CreateSeasonInput,
  SeasonsRepository
} from "../seasons/seasons-repository.js";
import { buildPublicNick } from "../users/nickname.js";
import type { AppUser, UsersRepository } from "../users/users-repository.js";
import type { JobEventsRepository } from "./job-events-repository.js";
import {
  formatAdminSeasonFinishedTopMessage,
  formatPlayerSeasonNotification,
  type AdminTopEntry
} from "./season-automation-format.js";
import {
  buildSeasonAutomationEventKey,
  buildSeasonWindowCreationEventKey,
  getDueSeasonNotificationEvents,
  getMoscowWeeklySeasonWindow,
  type SeasonAutomationEventType
} from "./season-schedule.js";

export interface SeasonAutomationLogger {
  info(obj: Record<string, unknown>, msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
}

export interface SeasonAutomationTelegramSender {
  sendPlayerMessage(input: { chatId: string; text: string }): Promise<void>;
  sendAdminMessage(input: { chatId: string; text: string }): Promise<void>;
}

export interface CreateSeasonAutomationServiceDeps {
  seasonsRepository: SeasonsRepository;
  seasonEntriesRepository: SeasonEntriesRepository;
  usersRepository: UsersRepository;
  jobEventsRepository: JobEventsRepository;
  telegram: SeasonAutomationTelegramSender;
  adminTelegramIds: string[];
  logger?: SeasonAutomationLogger;
}

export interface SeasonAutomationService {
  runOnce(referenceNow: Date): Promise<void>;
}

export function createSeasonAutomationService(
  deps: CreateSeasonAutomationServiceDeps
): SeasonAutomationService {
  return {
    async runOnce(referenceNow: Date): Promise<void> {
      await ensureWeeklySeasonExists(deps, referenceNow);
      await processDueSeasonEvents(deps, referenceNow);
    }
  };
}

async function ensureWeeklySeasonExists(
  deps: CreateSeasonAutomationServiceDeps,
  referenceNow: Date
): Promise<void> {
  const window = getMoscowWeeklySeasonWindow(referenceNow);
  const existing = await deps.seasonsRepository.findSeasonForWindow(
    window.startsAt,
    window.endsAt,
    referenceNow
  );
  if (existing) {
    return;
  }

  const previous = await deps.seasonsRepository.findLatestSeasonBefore(
    window.startsAt,
    referenceNow
  );
  if (!previous) {
    deps.logger?.warn(
      { windowStart: window.startsAt.toISOString() },
      "season automation: no previous season to clone"
    );
    return;
  }

  const eventKey = buildSeasonWindowCreationEventKey(window.startsAt);
  const claim = await deps.jobEventsRepository.claimEvent({
    eventKey,
    eventType: "season_window_created",
    seasonId: previous.seasonId,
    scheduledAt: window.startsAt
  });
  if (!claim.claimed) {
    return;
  }

  try {
    const racedExisting = await deps.seasonsRepository.findSeasonForWindow(
      window.startsAt,
      window.endsAt,
      referenceNow
    );
    if (!racedExisting) {
      const input: CreateSeasonInput = {
        title: previous.title,
        mapId: previous.mapId,
        entryFee: previous.entryFee,
        prizePoolShare: previous.prizePoolShare,
        startsAt: window.startsAt,
        endsAt: window.endsAt
      };
      const created = await deps.seasonsRepository.createSeason(input, referenceNow);
      deps.logger?.info(
        { seasonId: created.seasonId, startsAt: created.startsAt.toISOString() },
        "season automation: cloned season"
      );
    }
    await deps.jobEventsRepository.markCompleted(eventKey);
  } catch (error) {
    await deps.jobEventsRepository.markFailed(eventKey, errorToString(error));
    deps.logger?.error(
      { err: errorToString(error), windowStart: window.startsAt.toISOString() },
      "season automation: failed to clone season"
    );
  }
}

async function processDueSeasonEvents(
  deps: CreateSeasonAutomationServiceDeps,
  referenceNow: Date
): Promise<void> {
  const seasons = await deps.seasonsRepository.getAllSeasons(referenceNow);

  for (const season of seasons) {
    const dueEvents = getDueSeasonNotificationEvents(season, referenceNow);
    for (const event of dueEvents) {
      if (
        event.eventType === "season_finished_admin_top10" &&
        deps.adminTelegramIds.length === 0
      ) {
        deps.logger?.warn(
          { seasonId: season.seasonId },
          "season automation: admin summary skipped because admin bot is not configured"
        );
        continue;
      }

      const eventKey = buildSeasonAutomationEventKey({
        seasonId: season.seasonId,
        eventType: event.eventType,
        scheduledAt: event.scheduledAt
      });
      const claim = await deps.jobEventsRepository.claimEvent({
        eventKey,
        eventType: event.eventType,
        seasonId: season.seasonId,
        scheduledAt: event.scheduledAt
      });
      if (!claim.claimed) {
        continue;
      }

      try {
        if (event.eventType === "season_finished_admin_top10") {
          await sendAdminTop10(deps, season);
        } else {
          await sendPlayerNotification(deps, event.eventType);
        }
        await deps.jobEventsRepository.markCompleted(eventKey);
      } catch (error) {
        await deps.jobEventsRepository.markFailed(eventKey, errorToString(error));
        deps.logger?.error(
          { err: errorToString(error), eventKey },
          "season automation: event failed"
        );
      }
    }
  }
}

async function sendPlayerNotification(
  deps: CreateSeasonAutomationServiceDeps,
  eventType: SeasonAutomationEventType
): Promise<void> {
  const users = await deps.usersRepository.getAllUsers();
  let sent = 0;
  let failed = 0;

  for (const user of users) {
    try {
      await deps.telegram.sendPlayerMessage({
        chatId: user.telegramUserId,
        text: formatPlayerSeasonNotification({
          eventType,
          nick: buildPublicNick(user)
        })
      });
      sent += 1;
    } catch (error) {
      failed += 1;
      deps.logger?.warn(
        {
          err: errorToString(error),
          userId: user.userId,
          telegramUserId: user.telegramUserId
        },
        "season automation: player notification failed"
      );
    }
  }

  deps.logger?.info(
    { eventType, sent, failed },
    "season automation: player notification finished"
  );
}

async function sendAdminTop10(
  deps: CreateSeasonAutomationServiceDeps,
  season: {
    seasonId: string;
    title: string;
    mapId: string;
    endsAt: Date;
  }
): Promise<void> {
  const [entries, totalParticipants] = await Promise.all([
    deps.seasonEntriesRepository.getLeaderboard(season.seasonId, 10),
    deps.seasonEntriesRepository.countEntries(season.seasonId)
  ]);
  const topEntries = await buildAdminTopEntries(deps, entries);
  const text = formatAdminSeasonFinishedTopMessage({
    season,
    totalParticipants,
    entries: topEntries
  });

  for (const chatId of deps.adminTelegramIds) {
    await deps.telegram.sendAdminMessage({ chatId, text });
  }
}

async function buildAdminTopEntries(
  deps: CreateSeasonAutomationServiceDeps,
  entries: SeasonEntry[]
): Promise<AdminTopEntry[]> {
  const rows: AdminTopEntry[] = [];
  let previousScore: number | null = null;
  let previousRank = 0;

  for (const [index, entry] of entries.entries()) {
    const rank =
      previousScore !== null && entry.bestScore === previousScore
        ? previousRank
        : index + 1;
    const user = await deps.usersRepository.getUserById(entry.userId);
    rows.push({
      rank,
      nick: user ? buildPublicNick(user) : buildUnknownUserNick(entry.userId),
      bestScore: entry.bestScore,
      totalRaces: entry.totalRaces
    });
    previousScore = entry.bestScore;
    previousRank = rank;
  }

  return rows;
}

function buildUnknownUserNick(userId: string): string {
  return buildPublicNick({ telegramUserId: telegramUserIdFromUserId(userId) });
}

function telegramUserIdFromUserId(userId: string): string {
  return userId.startsWith("usr_") ? userId.slice(4) : userId;
}

function errorToString(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

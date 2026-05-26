import { computeSeasonStatus, type Season, type SeasonEntry } from "../seasons/seasons-domain.js";
import type { SeasonEntriesRepository } from "../seasons/season-entries-repository.js";
import type {
  CreateSeasonInput,
  SeasonsRepository
} from "../seasons/seasons-repository.js";
import { buildPublicNick } from "../users/nickname.js";
import type { AppUser, UsersRepository } from "../users/users-repository.js";
import type { JobEventSource, JobEventsRepository } from "./job-events-repository.js";
import {
  formatAdminSeasonFinishedTopMessage,
  formatPlayerSeasonFinishedTopMessage,
  formatPlayerSeasonNotification,
  type AdminTopEntry
} from "./season-automation-format.js";
import {
  buildSeasonAutomationEventKey,
  buildSeasonWindowCreationEventKey,
  getDueSeasonNotificationEvents,
  getMoscowWeeklySeasonWindow,
  getSeasonNotificationCandidates,
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
  runScheduledTick(referenceNow: Date): Promise<void>;
  finishSeasonNow(
    seasonId: string,
    referenceNow: Date,
    source: SeasonLifecycleSource
  ): Promise<Season | null>;
  syncManualSeasonChange(
    seasonId: string,
    previous: Season | null,
    updated: Season,
    referenceNow: Date,
    source: SeasonLifecycleSource
  ): Promise<void>;
}

export type SeasonLifecycleSource = JobEventSource;

export function createSeasonAutomationService(
  deps: CreateSeasonAutomationServiceDeps
): SeasonAutomationService {
  async function runScheduledTick(referenceNow: Date): Promise<void> {
    await ensureWeeklySeasonExists(deps, referenceNow);
    await processDueSeasonEvents(deps, referenceNow, "cron");
  }

  return {
    async runOnce(referenceNow: Date): Promise<void> {
      await runScheduledTick(referenceNow);
    },
    runScheduledTick,
    async finishSeasonNow(
      seasonId: string,
      referenceNow: Date,
      source: SeasonLifecycleSource
    ): Promise<Season | null> {
      return finishSeasonNow(deps, seasonId, referenceNow, source);
    },
    async syncManualSeasonChange(
      seasonId: string,
      previous: Season | null,
      updated: Season,
      referenceNow: Date,
      source: SeasonLifecycleSource
    ): Promise<void> {
      await syncManualSeasonChange(deps, seasonId, previous, updated, referenceNow, source);
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
    scheduledAt: window.startsAt,
    source: "cron"
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
    await deps.jobEventsRepository.markCompleted(eventKey, { source: "cron" });
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
  referenceNow: Date,
  source: SeasonLifecycleSource
): Promise<void> {
  const seasons = await deps.seasonsRepository.getAllSeasons(referenceNow);
  const dueEvents = seasons
    .flatMap((season) =>
      getDueSeasonNotificationEvents(season, referenceNow).map((event) => ({
        season,
        event
      }))
    )
    .sort((a, b) => compareDueEvents(a.event, b.event));

  for (const item of dueEvents) {
    await executeSeasonEvent(deps, item.season, item.event.eventType, item.event.scheduledAt, source);
  }
}

async function executeSeasonEvent(
  deps: CreateSeasonAutomationServiceDeps,
  season: Season,
  eventType: SeasonAutomationEventType,
  scheduledAt: Date,
  source: SeasonLifecycleSource
): Promise<boolean> {
  const eventKey = buildSeasonAutomationEventKey({
    seasonId: season.seasonId,
    eventType,
    scheduledAt
  });
  const claim = await deps.jobEventsRepository.claimEvent({
    eventKey,
    eventType,
    seasonId: season.seasonId,
    scheduledAt,
    source
  });
  if (!claim.claimed) {
    return false;
  }

  try {
    if (eventType === "season_finished_admin_top10") {
      await sendFinishedWinnersTop3(deps, season, eventType);
    } else {
      await sendPlayerNotification(deps, season, eventType);
    }
    await deps.jobEventsRepository.markCompleted(eventKey, {
      source,
      outcome: "sent"
    });
    return true;
  } catch (error) {
    await deps.jobEventsRepository.markFailed(eventKey, errorToString(error));
    deps.logger?.error(
      { err: errorToString(error), eventKey },
      "season automation: event failed"
    );
    return false;
  }
}

async function finishSeasonNow(
  deps: CreateSeasonAutomationServiceDeps,
  seasonId: string,
  referenceNow: Date,
  source: SeasonLifecycleSource
): Promise<Season | null> {
  const existing = await deps.seasonsRepository.getSeasonById(seasonId, referenceNow);
  if (!existing || computeSeasonStatus(existing, referenceNow) === "finished") {
    return null;
  }

  const nextStartsAt =
    existing.startsAt.getTime() >= referenceNow.getTime()
      ? new Date(referenceNow.getTime() - 1000)
      : existing.startsAt;
  const updated = await deps.seasonsRepository.updateSeason(
    seasonId,
    { startsAt: nextStartsAt, endsAt: referenceNow },
    referenceNow
  );
  if (!updated) {
    return null;
  }

  await suppressStaleEndingNotifications(deps, existing, referenceNow, source, "manual_finish");
  await executeSeasonEvent(
    deps,
    updated,
    "season_finished_admin_top10",
    updated.endsAt,
    source
  );
  return updated;
}

async function syncManualSeasonChange(
  deps: CreateSeasonAutomationServiceDeps,
  seasonId: string,
  previous: Season | null,
  updated: Season,
  referenceNow: Date,
  source: SeasonLifecycleSource
): Promise<void> {
  await suppressStaleEndingNotifications(
    deps,
    updated,
    referenceNow,
    source,
    "manual_season_change"
  );

  const wasStarted =
    previous !== null && previous.startsAt.getTime() <= referenceNow.getTime();
  const isActive =
    updated.startsAt.getTime() <= referenceNow.getTime() &&
    updated.endsAt.getTime() > referenceNow.getTime();
  if (isActive && !wasStarted) {
    await executeSeasonEvent(deps, updated, "season_started", updated.startsAt, source);
    return;
  }

  const wasFinished =
    previous !== null && previous.endsAt.getTime() <= referenceNow.getTime();
  const isFinished = updated.endsAt.getTime() <= referenceNow.getTime();
  if (isFinished && !wasFinished) {
    await executeSeasonEvent(
      deps,
      updated,
      "season_finished_admin_top10",
      updated.endsAt,
      source
    );
  }
}

async function suppressStaleEndingNotifications(
  deps: CreateSeasonAutomationServiceDeps,
  season: Pick<Season, "seasonId" | "startsAt" | "endsAt">,
  referenceNow: Date,
  source: SeasonLifecycleSource,
  reason: string
): Promise<void> {
  const staleEvents = getSeasonNotificationCandidates(season).filter(
    (event) =>
      event.eventType !== "season_started" &&
      event.eventType !== "season_finished_admin_top10" &&
      event.scheduledAt.getTime() <= referenceNow.getTime()
  );

  for (const event of staleEvents) {
    await deps.jobEventsRepository.suppressEvent({
      eventKey: buildSeasonAutomationEventKey({
        seasonId: season.seasonId,
        eventType: event.eventType,
        scheduledAt: event.scheduledAt
      }),
      eventType: event.eventType,
      seasonId: season.seasonId,
      scheduledAt: event.scheduledAt,
      source,
      reason
    });
  }
}

function compareDueEvents(
  a: { eventType: SeasonAutomationEventType; scheduledAt: Date },
  b: { eventType: SeasonAutomationEventType; scheduledAt: Date }
): number {
  const timeDelta = a.scheduledAt.getTime() - b.scheduledAt.getTime();
  if (timeDelta !== 0) {
    return timeDelta;
  }
  return eventOrder(a.eventType) - eventOrder(b.eventType);
}

function eventOrder(eventType: SeasonAutomationEventType): number {
  switch (eventType) {
    case "season_finished_admin_top10":
      return 0;
    case "season_started":
      return 1;
    case "season_ends_in_3d":
      return 2;
    case "season_ends_in_1d":
      return 3;
    case "season_ends_in_6h":
      return 4;
  }
}

async function sendPlayerNotification(
  deps: CreateSeasonAutomationServiceDeps,
  season: { endsAt: Date },
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
          nick: buildPublicNick(user),
          seasonEndsAt: season.endsAt
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

async function sendFinishedWinnersTop3(
  deps: CreateSeasonAutomationServiceDeps,
  season: {
    seasonId: string;
    title: string;
    mapId: string;
    endsAt: Date;
  },
  eventType: SeasonAutomationEventType
): Promise<void> {
  const [entries, totalParticipants] = await Promise.all([
    deps.seasonEntriesRepository.getLeaderboard(season.seasonId, 3),
    deps.seasonEntriesRepository.countEntries(season.seasonId)
  ]);
  const topEntries = await buildAdminTopEntries(deps, entries);
  const playerText = formatPlayerSeasonFinishedTopMessage({
    season,
    totalParticipants,
    entries: topEntries
  });
  const adminText = formatAdminSeasonFinishedTopMessage({
    season,
    totalParticipants,
    entries: topEntries
  });

  await sendPlayerBroadcast(deps, eventType, playerText);

  for (const chatId of deps.adminTelegramIds) {
    await deps.telegram.sendAdminMessage({ chatId, text: adminText });
  }
}

async function sendPlayerBroadcast(
  deps: CreateSeasonAutomationServiceDeps,
  eventType: SeasonAutomationEventType,
  text: string
): Promise<void> {
  const users = await deps.usersRepository.getAllUsers();
  let sent = 0;
  let failed = 0;

  for (const user of users) {
    try {
      await deps.telegram.sendPlayerMessage({
        chatId: user.telegramUserId,
        text
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
        "season automation: player broadcast failed"
      );
    }
  }

  deps.logger?.info(
    { eventType, sent, failed },
    "season automation: player broadcast finished"
  );
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
      telegramUserId: user?.telegramUserId ?? telegramUserIdFromUserId(entry.userId),
      username: user?.username,
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

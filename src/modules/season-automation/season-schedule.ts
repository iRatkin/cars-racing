export type SeasonAutomationEventType =
  | "season_started"
  | "season_ends_in_3d"
  | "season_ends_in_1d"
  | "season_ends_in_6h"
  | "season_finished_admin_top10";

export interface SeasonAutomationWindow {
  startsAt: Date;
  endsAt: Date;
}

export interface SeasonNotificationCandidate {
  eventType: SeasonAutomationEventType;
  scheduledAt: Date;
}

const MSK_OFFSET_MS = 3 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
const WEDNESDAY_20_MSK_HOUR = 20;

export function getMoscowWeeklySeasonWindow(referenceNow: Date): SeasonAutomationWindow {
  const nowMsk = new Date(referenceNow.getTime() + MSK_OFFSET_MS);
  const mskDay = nowMsk.getUTCDay();
  const daysSinceWednesday = (mskDay - 3 + 7) % 7;
  // Phase 0 business cadence is Wednesday 20:00 Moscow time (UTC+03:00).
  const candidateMskMs = Date.UTC(
    nowMsk.getUTCFullYear(),
    nowMsk.getUTCMonth(),
    nowMsk.getUTCDate() - daysSinceWednesday,
    WEDNESDAY_20_MSK_HOUR,
    0,
    0,
    0
  );
  const candidateUtcMs = candidateMskMs - MSK_OFFSET_MS;
  const startsAtMs =
    referenceNow.getTime() >= candidateUtcMs
      ? candidateUtcMs
      : candidateUtcMs - WEEK_MS;

  return {
    startsAt: new Date(startsAtMs),
    endsAt: new Date(startsAtMs + WEEK_MS)
  };
}

export function getDueSeasonNotificationEvents(
  season: { seasonId: string; startsAt: Date; endsAt: Date },
  referenceNow: Date
): SeasonNotificationCandidate[] {
  const candidates: SeasonNotificationCandidate[] = [
    { eventType: "season_started", scheduledAt: season.startsAt },
    {
      eventType: "season_ends_in_3d",
      scheduledAt: new Date(season.endsAt.getTime() - 3 * DAY_MS)
    },
    {
      eventType: "season_ends_in_1d",
      scheduledAt: new Date(season.endsAt.getTime() - DAY_MS)
    },
    {
      eventType: "season_ends_in_6h",
      scheduledAt: new Date(season.endsAt.getTime() - 6 * 60 * 60 * 1000)
    },
    { eventType: "season_finished_admin_top10", scheduledAt: season.endsAt }
  ];

  return candidates.filter(
    (candidate) => candidate.scheduledAt.getTime() <= referenceNow.getTime()
  );
}

export function buildSeasonAutomationEventKey(input: {
  seasonId: string;
  eventType: SeasonAutomationEventType;
  scheduledAt: Date;
}): string {
  return `season:${input.seasonId}:${input.eventType}:${input.scheduledAt.toISOString()}`;
}

export function buildSeasonWindowCreationEventKey(windowStart: Date): string {
  return `season-window:${windowStart.toISOString()}`;
}

import { describe, expect, test } from "vitest";

import {
  buildSeasonAutomationEventKey,
  getDueSeasonNotificationEvents,
  getMoscowWeeklySeasonWindow
} from "../../../src/modules/season-automation/season-schedule.js";

describe("season automation schedule", () => {
  test("computes the current Wednesday 20:00 MSK weekly window", () => {
    const now = new Date("2026-04-27T09:00:00.000Z");

    const window = getMoscowWeeklySeasonWindow(now);

    expect(window.startsAt.toISOString()).toBe("2026-04-22T17:00:00.000Z");
    expect(window.endsAt.toISOString()).toBe("2026-04-29T17:00:00.000Z");
  });

  test("moves into the next weekly window exactly at Wednesday 20:00 MSK", () => {
    const now = new Date("2026-04-29T17:00:00.000Z");

    const window = getMoscowWeeklySeasonWindow(now);

    expect(window.startsAt.toISOString()).toBe("2026-04-29T17:00:00.000Z");
    expect(window.endsAt.toISOString()).toBe("2026-05-06T17:00:00.000Z");
  });

  test("returns only notification events that are due", () => {
    const season = {
      seasonId: "sea_1",
      startsAt: new Date("2026-04-22T17:00:00.000Z"),
      endsAt: new Date("2026-04-29T17:00:00.000Z")
    };
    const now = new Date("2026-04-28T17:00:01.000Z");

    const events = getDueSeasonNotificationEvents(season, now);

    expect(events.map((event) => event.eventType)).toEqual([
      "season_started",
      "season_ends_in_3d",
      "season_ends_in_1d"
    ]);
    expect(events[0]?.scheduledAt.toISOString()).toBe("2026-04-22T17:00:00.000Z");
    expect(events[2]?.scheduledAt.toISOString()).toBe("2026-04-28T17:00:00.000Z");
  });

  test("builds deterministic season event keys", () => {
    const key = buildSeasonAutomationEventKey({
      seasonId: "sea_1",
      eventType: "season_started",
      scheduledAt: new Date("2026-04-22T17:00:00.000Z")
    });

    expect(key).toBe("season:sea_1:season_started:2026-04-22T17:00:00.000Z");
  });
});

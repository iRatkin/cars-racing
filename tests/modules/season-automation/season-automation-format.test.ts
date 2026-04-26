import { describe, expect, test } from "vitest";

import {
  formatAdminSeasonFinishedTopMessage,
  formatPlayerSeasonNotification
} from "../../../src/modules/season-automation/season-automation-format.js";

describe("season automation formatters", () => {
  test("formats player start notification with escaped nickname", () => {
    const text = formatPlayerSeasonNotification({
      eventType: "season_started",
      nick: "Drift<Name>"
    });

    expect(text).toBe("Дружище Drift&lt;Name&gt; - новый сезон начался, торопись дрифтить!");
  });

  test("formats player ending notification", () => {
    const text = formatPlayerSeasonNotification({
      eventType: "season_ends_in_6h",
      nick: "Ivan_42"
    });

    expect(text).toBe("Дружище Ivan_42 - поторопись, сезон заканчивается!");
  });

  test("formats admin top-10 with season metadata and leaderboard rows", () => {
    const text = formatAdminSeasonFinishedTopMessage({
      season: {
        title: "Spring <Cup>",
        mapId: "map_1",
        endsAt: new Date("2026-04-29T17:00:00.000Z")
      },
      totalParticipants: 2,
      entries: [
        { rank: 1, nick: "Ana", bestScore: 1500, totalRaces: 3 },
        { rank: 2, nick: "Bob", bestScore: 900, totalRaces: 1 }
      ]
    });

    expect(text).toContain("🏁 <b>Season Finished</b>");
    expect(text).toContain("Spring &lt;Cup&gt;");
    expect(text).toContain("Participants: <b>2</b>");
    expect(text).toContain("1. Ana — <b>1500</b> pts, races: 3");
    expect(text).toContain("2. Bob — <b>900</b> pts, races: 1");
  });
});

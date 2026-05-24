import { describe, expect, test } from "vitest";

import {
  formatAdminSeasonFinishedTopMessage,
  formatPlayerSeasonNotification
} from "../../../src/modules/season-automation/season-automation-format.js";

describe("season automation formatters", () => {
  test("formats player start notification", () => {
    const text = formatPlayerSeasonNotification({
      eventType: "season_started",
      nick: "Drift<Name>"
    });

    expect(text).toBe(
      "🏁🔥 Турнир начался!\n" +
      "Заезжай в RACEDRIFT, набирай очки и сражайся за реальный приз 🏆"
    );
  });

  test("formats player ending notification", () => {
    const text = formatPlayerSeasonNotification({
      eventType: "season_ends_in_6h",
      nick: "Ivan_42"
    });

    expect(text).toBe(
      "⏳🏎️ Турнир скоро закончится!\n" +
      "У тебя ещё есть шанс улучшить результат и побороться за главный приз 🏁"
    );
  });

  test("formats finished tournament message with top-3 winner nicknames", () => {
    const text = formatAdminSeasonFinishedTopMessage({
      season: {
        title: "Spring <Cup>",
        mapId: "map_1",
        endsAt: new Date("2026-04-29T17:00:00.000Z")
      },
      totalParticipants: 2,
      entries: [
        { rank: 1, nick: "Ana", bestScore: 1500, totalRaces: 3 },
        { rank: 2, nick: "Bob<Name>", bestScore: 900, totalRaces: 1 },
        { rank: 3, nick: "Cid", bestScore: 800, totalRaces: 1 },
        { rank: 4, nick: "Dee", bestScore: 700, totalRaces: 1 }
      ]
    });

    expect(text).toBe(
      "🏆 Турнир завершён!\n" +
      "Финальная таблица зафиксирована — вот победители, которые забрали приз в этом сезоне: Ana, Bob&lt;Name&gt;, Cid"
    );
    expect(text).not.toContain("Dee");
    expect(text).not.toContain("1500");
  });
});

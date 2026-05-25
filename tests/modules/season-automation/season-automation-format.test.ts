import { describe, expect, test } from "vitest";

import {
  formatAdminSeasonFinishedTopMessage,
  formatPlayerSeasonFinishedTopMessage,
  formatPlayerSeasonNotification
} from "../../../src/modules/season-automation/season-automation-format.js";

describe("season automation formatters", () => {
  test("formats player start notification", () => {
    const text = formatPlayerSeasonNotification({
      eventType: "season_started",
      nick: "Drift<Name>",
      seasonEndsAt: new Date("2026-04-29T17:00:00.000Z")
    });

    expect(text).toBe(
      "🏁🔥 Турнир начался!\n" +
      "Заезжай в RACEDRIFT, набирай очки и сражайся за реальный приз 🏆\n" +
      "Дата окончания: 29.04.2026, 20:00 МСК"
    );
  });

  test("formats player ending notification", () => {
    const text = formatPlayerSeasonNotification({
      eventType: "season_ends_in_6h",
      nick: "Ivan_42",
      seasonEndsAt: new Date("2026-04-29T17:00:00.000Z")
    });

    expect(text).toBe(
      "⏳🏎️ Турнир скоро закончится!\n" +
      "У тебя ещё есть шанс улучшить результат и побороться за главный приз 🏁\n" +
      "Дата окончания: 29.04.2026, 20:00 МСК"
    );
  });

  test("formats player finished tournament message with top-3 winner nicknames", () => {
    const text = formatPlayerSeasonFinishedTopMessage({
      season: {
        title: "Spring <Cup>",
        mapId: "map_1",
        endsAt: new Date("2026-04-29T17:00:00.000Z")
      },
      totalParticipants: 2,
      entries: [
        {
          rank: 1,
          nick: "Ana",
          telegramUserId: "111",
          username: "ana_tg",
          bestScore: 1500,
          totalRaces: 3
        },
        {
          rank: 2,
          nick: "Bob<Name>",
          telegramUserId: "222",
          username: "bob_tg",
          bestScore: 900,
          totalRaces: 1
        },
        {
          rank: 3,
          nick: "Cid",
          telegramUserId: "333",
          bestScore: 800,
          totalRaces: 1
        },
        {
          rank: 4,
          nick: "Dee",
          telegramUserId: "444",
          username: "dee_tg",
          bestScore: 700,
          totalRaces: 1
        }
      ]
    });

    expect(text).toBe(
      "🏆 Турнир завершён!\n" +
      "Финальная таблица зафиксирована — вот победители, которые забрали приз в этом сезоне: Ana, Bob&lt;Name&gt;, Cid\n" +
      "Для получения призов — пишите на админский аккаунт @racedrift_admin"
    );
    expect(text).not.toContain("Dee");
    expect(text).not.toContain("1500");
  });

  test("formats admin finished tournament message with Telegram contacts", () => {
    const text = formatAdminSeasonFinishedTopMessage({
      season: {
        title: "Spring <Cup>",
        mapId: "map_1",
        endsAt: new Date("2026-04-29T17:00:00.000Z")
      },
      totalParticipants: 2,
      entries: [
        {
          rank: 1,
          nick: "AppChampion",
          telegramUserId: "111",
          username: "champion_tg",
          bestScore: 1500,
          totalRaces: 3
        },
        {
          rank: 2,
          nick: "AppRunner",
          telegramUserId: "222",
          username: "runner_tg",
          bestScore: 900,
          totalRaces: 1
        },
        {
          rank: 3,
          nick: "AppNoUsername",
          telegramUserId: "333",
          bestScore: 800,
          totalRaces: 1
        }
      ]
    });

    expect(text).toBe(
      "🏆 Турнир завершён!\n" +
      "Победители для выдачи призов:\n" +
      "1. @champion_tg\n" +
      "2. @runner_tg\n" +
      "3. Telegram ID 333"
    );
    expect(text).not.toContain("AppChampion");
    expect(text).not.toContain("1500");
  });
});

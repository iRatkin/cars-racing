import { escapeHtml } from "../admin/admin-input.js";
import type { SeasonAutomationEventType } from "./season-schedule.js";

export interface PlayerSeasonNotificationInput {
  eventType: SeasonAutomationEventType;
  nick: string;
}

export interface AdminTopEntry {
  rank: number;
  nick: string;
  bestScore: number;
  totalRaces: number;
}

export interface AdminSeasonFinishedTopMessageInput {
  season: {
    title: string;
    mapId: string;
    endsAt: Date;
  };
  totalParticipants: number;
  entries: AdminTopEntry[];
}

export function formatPlayerSeasonNotification(
  input: PlayerSeasonNotificationInput
): string {
  if (input.eventType === "season_started") {
    return (
      "🏁🔥 Турнир начался!\n" +
      "Заезжай в RACEDRIFT, набирай очки и сражайся за реальный приз 🏆"
    );
  }
  return (
    "⏳🏎️ Турнир скоро закончится!\n" +
    "У тебя ещё есть шанс улучшить результат и побороться за главный приз 🏁"
  );
}

export function formatAdminSeasonFinishedTopMessage(
  input: AdminSeasonFinishedTopMessageInput
): string {
  const winnersList =
    input.entries.length === 0
      ? "победителей нет"
      : input.entries
          .slice(0, 3)
          .map((entry) => escapeHtml(entry.nick))
          .join(", ");

  return (
    "🏆 Турнир завершён!\n" +
    `Финальная таблица зафиксирована — вот победители, которые забрали приз в этом сезоне: ${winnersList}`
  );
}

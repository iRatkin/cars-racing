import { escapeHtml } from "../admin/admin-input.js";
import type { SeasonAutomationEventType } from "./season-schedule.js";

export interface PlayerSeasonNotificationInput {
  eventType: SeasonAutomationEventType;
  nick: string;
  seasonEndsAt: Date;
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
  const endDateLine = `Дата окончания: ${formatMoscowDateTime(input.seasonEndsAt)}`;

  if (input.eventType === "season_started") {
    return (
      "🏁🔥 Турнир начался!\n" +
      "Заезжай в RACEDRIFT, набирай очки и сражайся за реальный приз 🏆\n" +
      endDateLine
    );
  }
  return (
    "⏳🏎️ Турнир скоро закончится!\n" +
    "У тебя ещё есть шанс улучшить результат и побороться за главный приз 🏁\n" +
    endDateLine
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
    `Финальная таблица зафиксирована — вот победители, которые забрали приз в этом сезоне: ${winnersList}\n` +
    "Для получения призов — пишите на админский аккаунт @racedrift_admin"
  );
}

function formatMoscowDateTime(date: Date): string {
  const parts = new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    hourCycle: "h23"
  }).formatToParts(date);
  const valueByType = new Map(parts.map((part) => [part.type, part.value]));

  return `${valueByType.get("day")}.${valueByType.get("month")}.${valueByType.get("year")}, ${valueByType.get("hour")}:${valueByType.get("minute")} МСК`;
}

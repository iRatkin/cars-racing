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
  const nick = escapeHtml(input.nick);
  if (input.eventType === "season_started") {
    return `Дружище ${nick} - новый сезон начался, торопись дрифтить!`;
  }
  return `Дружище ${nick} - поторопись, сезон заканчивается!`;
}

export function formatAdminSeasonFinishedTopMessage(
  input: AdminSeasonFinishedTopMessageInput
): string {
  const rows =
    input.entries.length === 0
      ? "No ranked results."
      : input.entries
          .map(
            (entry) =>
              `${entry.rank}. ${escapeHtml(entry.nick)} — <b>${entry.bestScore}</b> pts, races: ${entry.totalRaces}`
          )
          .join("\n");

  return (
    `🏁 <b>Season Finished</b>\n\n` +
    `Title: ${escapeHtml(input.season.title)}\n` +
    `Map: <code>${escapeHtml(input.season.mapId)}</code>\n` +
    `Ended: ${formatDateUtc(input.season.endsAt)}\n` +
    `Participants: <b>${input.totalParticipants}</b>\n\n` +
    `<b>Top 10</b>\n${rows}`
  );
}

function formatDateUtc(date: Date): string {
  return `${date.toISOString().replace("T", " ").slice(0, 16)} UTC`;
}

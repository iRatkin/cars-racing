import { answerCallbackQuery, sendTelegramMessage } from "../telegram/invoice-link.js";
import { renderAdminView } from "./admin-view-renderer.js";
import type { AdminDeps } from "./admin-commands.js";
import type { AdminSession, AdminView } from "./admin-session.js";
import { touchSessionExpiry } from "./admin-session.js";
import { formatUtmSourceDetails } from "./admin-format.js";
import {
  buildUtmSourceCallbackHash,
  getMoscowUtmDayRange,
  parseUtmSourceCallbackData
} from "./admin-utm.js";

export interface AdminCallbackLogger {
  warn(obj: Record<string, unknown>, msg: string): void;
}

export interface HandleAdminCallbackParams {
  deps: AdminDeps;
  chatId: number;
  data: string;
  callbackQueryId: string;
  sessions: Map<string, AdminSession>;
  adminId: string;
  logger?: AdminCallbackLogger;
}

/**
 * Handles inline callback queries from dynamic lists:
 * `editcar:<carId>`, `editseason:<seasonId>`, `givecar:<userId>:<carId>`, UTM source buttons.
 * Every other navigation happens through reply-keyboard button presses.
 */
export async function handleAdminCallback(params: HandleAdminCallbackParams): Promise<void> {
  const { deps, chatId, data, callbackQueryId, sessions, adminId, logger } = params;
  const [action, ...args] = data.split(":");

  if (action === "editcar") {
    await answerCallbackQuery(deps.telegramOptions, callbackQueryId);
    const [carId] = args;
    if (!carId) {
      return;
    }
    const view: AdminView = { type: "car", carId };
    const rendered = await renderAdminView(deps, chatId, view);
    if (rendered) {
      setSessionView(sessions, adminId, view);
    }
    return;
  }

  if (action === "editseason") {
    await answerCallbackQuery(deps.telegramOptions, callbackQueryId);
    const [seasonId] = args;
    if (!seasonId) {
      return;
    }
    const view: AdminView = { type: "season", seasonId };
    const rendered = await renderAdminView(deps, chatId, view);
    if (rendered) {
      setSessionView(sessions, adminId, view);
    }
    return;
  }

  if (action === "givecar") {
    const [userId, carId] = args;
    if (!userId || !carId) {
      await answerCallbackQuery(deps.telegramOptions, callbackQueryId);
      return;
    }
    await deps.usersRepository.addOwnedCar(userId, carId);
    await answerCallbackQuery(deps.telegramOptions, callbackQueryId, "Car granted");
    const view: AdminView = { type: "user", userId };
    const rendered = await renderAdminView(deps, chatId, view);
    if (rendered) {
      setSessionView(sessions, adminId, view);
    }
    return;
  }

  const utmHash = parseUtmSourceCallbackData(data);
  if (utmHash) {
    await answerCallbackQuery(deps.telegramOptions, callbackQueryId);
    const sources = await deps.usersRepository.getAllUtmSources();
    const source = sources.find(
      (candidate) => buildUtmSourceCallbackHash(candidate.utmSource) === utmHash
    );
    if (!source) {
      await sendTelegramMessage(deps.telegramOptions, {
        chatId,
        text: "❌ UTM source not found. Please refresh the source list."
      });
      return;
    }

    const range = getMoscowUtmDayRange(new Date());
    const details = await deps.usersRepository.getUtmSourceDetails({
      utmSource: source.utmSource,
      todayStart: range.todayStart,
      tomorrowStart: range.tomorrowStart,
      yesterdayStart: range.yesterdayStart
    });
    await sendTelegramMessage(deps.telegramOptions, {
      chatId,
      text: formatUtmSourceDetails(details)
    });
    return;
  }

  logger?.warn({ action, data }, "admin callback: unknown action");
  await answerCallbackQuery(deps.telegramOptions, callbackQueryId, "Action not found");
}

function setSessionView(
  sessions: Map<string, AdminSession>,
  adminId: string,
  view: AdminView
): void {
  const existing = sessions.get(adminId);
  sessions.set(adminId, {
    view,
    pending: null,
    expiresAt:
      existing && existing.expiresAt > Date.now() ? existing.expiresAt : touchSessionExpiry()
  });
}

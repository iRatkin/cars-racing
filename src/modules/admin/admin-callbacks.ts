import { answerCallbackQuery } from "../telegram/invoice-link.js";
import { renderAdminView } from "./admin-view-renderer.js";
import type { AdminDeps } from "./admin-commands.js";
import type { AdminSession, AdminView } from "./admin-session.js";
import { touchSessionExpiry } from "./admin-session.js";

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
 * Handles inline callback queries from the three dynamic lists:
 * `editcar:<carId>`, `editseason:<seasonId>`, `givecar:<userId>:<carId>`.
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

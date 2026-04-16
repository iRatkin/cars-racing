import { sendTelegramMessage } from "../telegram/invoice-link.js";
import { findUserByQuery } from "./admin-user-lookup.js";
import { renderAdminView, type AdminRendererDeps } from "./admin-view-renderer.js";
import type { AdminView } from "./admin-session.js";

export type AdminDeps = AdminRendererDeps;

export interface AdminCommandResult {
  view: AdminView;
}

/**
 * Handles the `/user <query>` command: looks up a user and renders their detail view.
 * Returns the resulting view on success, or `null` when the user was not found.
 */
export async function handleUserCommand(
  deps: AdminDeps,
  chatId: number,
  query: string
): Promise<AdminCommandResult | null> {
  if (!query.trim()) {
    await sendTelegramMessage(deps.telegramOptions, {
      chatId,
      text: "Usage: /user &lt;telegramUserId|username&gt;"
    });
    return null;
  }
  const user = await findUserByQuery(deps.usersRepository, query);
  if (!user) {
    await sendTelegramMessage(deps.telegramOptions, {
      chatId,
      text: `❌ User not found: ${escapePlain(query)}`
    });
    return null;
  }
  const view: AdminView = { type: "user", userId: user.userId };
  await renderAdminView(deps, chatId, view);
  return { view };
}

/**
 * Handles the `/cars` command: renders the catalog list view.
 */
export async function handleCarsCommand(
  deps: AdminDeps,
  chatId: number
): Promise<AdminCommandResult> {
  const view: AdminView = { type: "cars" };
  await renderAdminView(deps, chatId, view);
  return { view };
}

/**
 * Handles the `/seasons` command: renders the seasons list view.
 */
export async function handleSeasonsCommand(
  deps: AdminDeps,
  chatId: number
): Promise<AdminCommandResult> {
  const view: AdminView = { type: "seasons" };
  await renderAdminView(deps, chatId, view);
  return { view };
}

/**
 * Handles the `/stats` command: renders the stats view.
 */
export async function handleStatsCommand(
  deps: AdminDeps,
  chatId: number
): Promise<AdminCommandResult> {
  const view: AdminView = { type: "stats" };
  await renderAdminView(deps, chatId, view);
  return { view };
}

/**
 * Handles the `/start` and `/menu` commands: renders the main menu.
 */
export async function handleStartCommand(
  deps: AdminDeps,
  chatId: number
): Promise<AdminCommandResult> {
  const view: AdminView = { type: "main" };
  await renderAdminView(deps, chatId, view);
  return { view };
}

function escapePlain(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

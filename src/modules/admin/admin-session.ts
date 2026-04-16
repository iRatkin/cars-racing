import type { PendingAdminAction } from "./admin-config.js";

export type AdminView =
  | { type: "main" }
  | { type: "users_menu" }
  | { type: "user"; userId: string }
  | { type: "cars" }
  | { type: "car"; carId: string }
  | { type: "give_car"; userId: string }
  | { type: "seasons" }
  | { type: "season"; seasonId: string }
  | { type: "stats" }
  | { type: "wizard"; cancelTo: AdminViewBase }
  | { type: "addcar_purchasable" }
  | { type: "confirm_create_season" }
  | { type: "confirm_finish_season"; seasonId: string };

export type AdminViewBase =
  | { type: "main" }
  | { type: "users_menu" }
  | { type: "user"; userId: string }
  | { type: "cars" }
  | { type: "car"; carId: string }
  | { type: "seasons" }
  | { type: "season"; seasonId: string };

export interface AdminSession {
  view: AdminView;
  pending: PendingAdminAction | null;
  expiresAt: number;
}

export const ADMIN_SESSION_TTL_MS = 30 * 60 * 1000;

export function touchSessionExpiry(): number {
  return Date.now() + ADMIN_SESSION_TTL_MS;
}

export function sweepSessions(sessions: Map<string, AdminSession>): void {
  const now = Date.now();
  for (const [key, value] of sessions.entries()) {
    if (value.expiresAt < now) {
      sessions.delete(key);
    }
  }
}

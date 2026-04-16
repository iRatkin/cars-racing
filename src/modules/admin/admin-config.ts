export const ADMIN_PENDING_ACTION_TTL_MS = 5 * 60 * 1000;

export const ADMIN_DEFAULT_PRIZE_POOL_SHARE = 0.1;

export type AdminPendingActionType =
  | "addcoins"
  | "subtractcoins"
  | "setbalance"
  | "finduser"
  | "setprice"
  | "settitle"
  | "addcar_carid"
  | "addcar_title"
  | "addcar_price"
  | "addcar_purchasable"
  | "createseason_title"
  | "createseason_mapid"
  | "createseason_fee"
  | "createseason_prize"
  | "createseason_starts"
  | "createseason_ends"
  | "editseason_ends"
  | "editseason_starts"
  | "editseason_fee"
  | "editseason_title"
  | "editseason_mapid";

export interface PendingAdminAction {
  type: AdminPendingActionType;
  context: Record<string, string>;
  expiresAt: number;
}

export function parseAdminTelegramIds(value: string): string[] {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

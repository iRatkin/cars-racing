import ExcelJS from "exceljs";

import type { AppUser } from "../users/users-repository.js";

export const ADMIN_USERS_EXPORT_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/**
 * Builds an XLSX workbook with a single `userId` column, one row per user.
 * Returns the workbook as a byte array suitable for uploading via `sendTelegramDocument`.
 */
export async function buildUsersExportWorkbook(users: AppUser[]): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "admin-bot";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet("Users");
  sheet.columns = [{ header: "userId", key: "userId", width: 30 }];
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: "frozen", ySplit: 1 }];

  for (const user of users) {
    sheet.addRow({ userId: user.userId });
  }

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return new Uint8Array(arrayBuffer as ArrayBuffer);
}

/**
 * Generates the default file name for a users export based on the given date.
 */
export function buildUsersExportFileName(now: Date): string {
  const stamp = now.toISOString().replace(/[:.]/g, "-").slice(0, 19);
  return `users-export-${stamp}.xlsx`;
}

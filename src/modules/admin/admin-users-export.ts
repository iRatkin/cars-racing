import ExcelJS from "exceljs";

import type { AppUser } from "../users/users-repository.js";

export const ADMIN_USERS_EXPORT_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/**
 * Builds an XLSX workbook with one row per user containing profile fields,
 * balance, owned cars and UTM attribution. Returns the workbook as a Buffer
 * suitable for uploading via `sendTelegramDocument`.
 */
export async function buildUsersExportWorkbook(users: AppUser[]): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "admin-bot";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet("Users");
  sheet.columns = [
    { header: "userId", key: "userId", width: 26 },
    { header: "telegramUserId", key: "telegramUserId", width: 18 },
    { header: "username", key: "username", width: 20 },
    { header: "firstName", key: "firstName", width: 20 },
    { header: "lastName", key: "lastName", width: 20 },
    { header: "languageCode", key: "languageCode", width: 10 },
    { header: "isPremium", key: "isPremium", width: 10 },
    { header: "raceCoinsBalance", key: "raceCoinsBalance", width: 16 },
    { header: "ownedCarIds", key: "ownedCarIds", width: 30 },
    { header: "selectedCarId", key: "selectedCarId", width: 16 },
    { header: "garageRevision", key: "garageRevision", width: 14 },
    { header: "utmSource", key: "utmSource", width: 18 },
    { header: "utmMedium", key: "utmMedium", width: 18 },
    { header: "utmCampaign", key: "utmCampaign", width: 22 },
    { header: "utmContent", key: "utmContent", width: 22 },
    { header: "utmTerm", key: "utmTerm", width: 18 }
  ];

  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: "frozen", ySplit: 1 }];

  for (const user of users) {
    sheet.addRow({
      userId: user.userId,
      telegramUserId: user.telegramUserId,
      username: user.username ?? "",
      firstName: user.firstName ?? "",
      lastName: user.lastName ?? "",
      languageCode: user.languageCode ?? "",
      isPremium: user.isPremium === true ? "yes" : user.isPremium === false ? "no" : "",
      raceCoinsBalance: user.raceCoinsBalance,
      ownedCarIds: user.ownedCarIds.join(", "),
      selectedCarId: user.selectedCarId ?? "",
      garageRevision: user.garageRevision,
      utmSource: user.utm?.utmSource ?? "",
      utmMedium: user.utm?.utmMedium ?? "",
      utmCampaign: user.utm?.utmCampaign ?? "",
      utmContent: user.utm?.utmContent ?? "",
      utmTerm: user.utm?.utmTerm ?? ""
    });
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

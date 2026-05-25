import ExcelJS from "exceljs";
import { describe, expect, test } from "vitest";

import { buildUsersExportWorkbook } from "../../../src/modules/admin/admin-users-export.js";
import type { AppUser } from "../../../src/modules/users/users-repository.js";

describe("buildUsersExportWorkbook", () => {
  test("exports telegram ids without a header row", async () => {
    const buffer = await buildUsersExportWorkbook([user("usr_1"), user("usr_2")]);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(buffer) as unknown as Parameters<typeof workbook.xlsx.load>[0]);

    const sheet = workbook.getWorksheet("Users");
    expect(sheet).toBeDefined();
    expect(sheet?.rowCount).toBe(2);
    expect(sheet?.getCell("A1").value).toBe("1");
    expect(sheet?.getCell("A2").value).toBe("2");
  });
});

function user(userId: string): AppUser {
  return {
    userId,
    telegramUserId: userId.replace(/^usr_/, ""),
    ownedCarIds: [],
    garageRevision: 0,
    raceCoinsBalance: 0
  };
}

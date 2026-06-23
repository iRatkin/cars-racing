import { describe, expect, test } from "vitest";

import {
  MongoSeasonEntriesRepository,
  type MongoSeasonEntryDocument
} from "../../../src/infra/mongo/season-entries-repository.js";

describe("MongoSeasonEntriesRepository leaderboard", () => {
  test("excludes zero-score entries from leaderboard counts and ranks", async () => {
    const repo = new MongoSeasonEntriesRepository(
      new FakeSeasonEntriesCollection([
        entry("entry_1", "sea_1", "usr_positive", 1200),
        entry("entry_2", "sea_1", "usr_zero", 0),
        entry("entry_3", "sea_1", "usr_lower", 900),
        entry("entry_4", "sea_other", "usr_other", 0)
      ])
    );

    const leaderboard = await repo.getLeaderboard("sea_1", 10);

    expect(leaderboard.map((row) => row.userId)).toEqual([
      "usr_positive",
      "usr_lower"
    ]);
    expect(await repo.countEntries("sea_1")).toBe(2);
    expect(await repo.getEntryRank("sea_1", "usr_zero")).toBeNull();
    expect(await repo.getEntryRank("sea_1", "usr_lower")).toBe(2);
  });
});

class FakeSeasonEntriesCollection {
  constructor(private readonly rows: MongoSeasonEntryDocument[]) {}

  async findOne(filter: Record<string, unknown>) {
    return this.rows.find((row) => matches(row, filter)) ?? null;
  }

  async insertOne() {}

  async updateOne() {}

  find(filter: Record<string, unknown>) {
    return new FakeFindCursor(this.rows.filter((row) => matches(row, filter)));
  }

  async countDocuments(filter: Record<string, unknown>) {
    return this.rows.filter((row) => matches(row, filter)).length;
  }
}

class FakeFindCursor {
  constructor(private rows: MongoSeasonEntryDocument[]) {}

  sort(sort: Record<string, 1 | -1>) {
    this.rows = [...this.rows].sort((a, b) => {
      for (const [key, direction] of Object.entries(sort)) {
        const av = valueForSort(a, key as keyof MongoSeasonEntryDocument);
        const bv = valueForSort(b, key as keyof MongoSeasonEntryDocument);
        if (av < bv) return -direction;
        if (av > bv) return direction;
      }
      return 0;
    });
    return this;
  }

  limit(limit: number) {
    this.rows = this.rows.slice(0, limit);
    return this;
  }

  async toArray() {
    return this.rows;
  }
}

function matches(row: MongoSeasonEntryDocument, filter: Record<string, unknown>) {
  return Object.entries(filter).every(([key, expected]) => {
    const actual = row[key as keyof MongoSeasonEntryDocument];
    if (isGreaterThanFilter(expected)) {
      return Number(actual) > expected.$gt;
    }
    return actual === expected;
  });
}

function isGreaterThanFilter(value: unknown): value is { $gt: number } {
  return (
    typeof value === "object" &&
    value !== null &&
    "$gt" in value &&
    typeof (value as { $gt: unknown }).$gt === "number"
  );
}

function valueForSort(
  row: MongoSeasonEntryDocument,
  key: keyof MongoSeasonEntryDocument
) {
  const value = row[key];
  return value instanceof Date ? value.getTime() : value;
}

function entry(
  entryId: string,
  seasonId: string,
  userId: string,
  bestScore: number
): MongoSeasonEntryDocument {
  return {
    entryId,
    seasonId,
    userId,
    bestScore,
    totalRaces: bestScore > 0 ? 1 : 0,
    entryFeeSnapshot: 25,
    createdAt: new Date(`2026-04-22T18:0${entryId.slice(-1)}:00.000Z`),
    updatedAt: new Date(`2026-04-22T18:0${entryId.slice(-1)}:00.000Z`)
  };
}

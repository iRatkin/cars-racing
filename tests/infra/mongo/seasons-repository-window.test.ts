import { describe, expect, test } from "vitest";

import {
  MongoSeasonsRepository,
  type MongoSeasonDocument
} from "../../../src/infra/mongo/seasons-repository.js";

class FakeFindCursor {
  constructor(private rows: MongoSeasonDocument[]) {}

  sort(sort: Record<string, 1 | -1>) {
    const key = Object.keys(sort)[0] as keyof MongoSeasonDocument;
    const dir = sort[String(key)] ?? 1;
    this.rows = [...this.rows].sort((a, b) => {
      const av = a[key] instanceof Date ? a[key].getTime() : String(a[key]);
      const bv = b[key] instanceof Date ? b[key].getTime() : String(b[key]);
      return av < bv ? -dir : av > bv ? dir : 0;
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

class FakeSeasonsCollection {
  constructor(private rows: MongoSeasonDocument[]) {}

  async findOne(filter: { seasonId: string }) {
    return this.rows.find((row) => row.seasonId === filter.seasonId) ?? null;
  }

  find(filter: Record<string, unknown>) {
    if ("$or" in filter) {
      const clauses = filter.$or as Array<Record<string, Record<string, Date>>>;
      const windowStart = clauses[0]?.startsAt?.$lte as Date;
      const windowEnd = clauses[1]?.startsAt?.$lt as Date;
      return new FakeFindCursor(
        this.rows.filter(
          (row) =>
            (row.startsAt.getTime() <= windowStart.getTime() &&
              row.endsAt.getTime() > windowStart.getTime()) ||
            (row.startsAt.getTime() >= windowStart.getTime() &&
              row.startsAt.getTime() < windowEnd.getTime())
        )
      );
    }
    if ("startsAt" in filter) {
      const lt = (filter.startsAt as { $lt: Date }).$lt;
      return new FakeFindCursor(
        this.rows.filter((row) => row.startsAt.getTime() < lt.getTime())
      );
    }
    return new FakeFindCursor(this.rows);
  }

  async insertOne() {}

  async findOneAndUpdate() {
    return null;
  }
}

describe("MongoSeasonsRepository window lookups", () => {
  test("finds a manually prepared season in the weekly window", async () => {
    const repo = new MongoSeasonsRepository(
      new FakeSeasonsCollection([
        season("sea_manual", "2026-04-29T17:00:00.000Z", "2026-05-06T17:00:00.000Z")
      ])
    );

    const found = await repo.findSeasonForWindow(
      new Date("2026-04-29T17:00:00.000Z"),
      new Date("2026-05-06T17:00:00.000Z"),
      new Date("2026-04-29T18:00:00.000Z")
    );

    expect(found?.seasonId).toBe("sea_manual");
  });

  test("finds latest previous season before a window", async () => {
    const repo = new MongoSeasonsRepository(
      new FakeSeasonsCollection([
        season("sea_old", "2026-04-15T17:00:00.000Z", "2026-04-22T17:00:00.000Z"),
        season("sea_prev", "2026-04-22T17:00:00.000Z", "2026-04-29T17:00:00.000Z")
      ])
    );

    const found = await repo.findLatestSeasonBefore(
      new Date("2026-04-29T17:00:00.000Z"),
      new Date("2026-04-29T18:00:00.000Z")
    );

    expect(found?.seasonId).toBe("sea_prev");
  });
});

function season(seasonId: string, startsAt: string, endsAt: string): MongoSeasonDocument {
  return {
    seasonId,
    title: "Cup",
    mapId: "map_1",
    entryFee: 10,
    prizePoolShare: 0.1,
    startsAt: new Date(startsAt),
    endsAt: new Date(endsAt),
    createdAt: new Date(startsAt),
    updatedAt: new Date(startsAt)
  };
}

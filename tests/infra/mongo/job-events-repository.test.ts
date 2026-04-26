import { describe, expect, test } from "vitest";

import {
  MongoJobEventsRepository,
  type MongoJobEventDocument
} from "../../../src/infra/mongo/job-events-repository.js";

class FakeJobEventsCollection {
  rows = new Map<string, MongoJobEventDocument>();

  async findOne(filter: Record<string, unknown>): Promise<MongoJobEventDocument | null> {
    return this.rows.get(String(filter.eventKey)) ?? null;
  }

  async insertOne(document: MongoJobEventDocument): Promise<void> {
    if (this.rows.has(document.eventKey)) {
      throw Object.assign(new Error("duplicate key"), { code: 11000 });
    }
    this.rows.set(document.eventKey, document);
  }

  async findOneAndUpdate(
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
    _options: { returnDocument: "after"; includeResultMetadata: false }
  ): Promise<MongoJobEventDocument | null> {
    const eventKey = String(filter.eventKey);
    const existing = this.rows.get(eventKey);
    if (!existing || !matchesRetryFilter(existing, filter)) {
      return null;
    }

    const set = update.$set as Partial<MongoJobEventDocument>;
    const inc = update.$inc as { attempts?: number } | undefined;
    const updated: MongoJobEventDocument = {
      ...existing,
      ...set,
      attempts: existing.attempts + (inc?.attempts ?? 0)
    };
    this.rows.set(eventKey, updated);
    return updated;
  }

  async updateOne(filter: Record<string, unknown>, update: Record<string, unknown>): Promise<void> {
    const row = this.rows.get(String(filter.eventKey));
    if (!row) return;
    const set = update.$set as Partial<MongoJobEventDocument>;
    this.rows.set(row.eventKey, { ...row, ...set });
  }
}

describe("MongoJobEventsRepository", () => {
  test("claims an unclaimed event and skips completed events", async () => {
    const collection = new FakeJobEventsCollection();
    const repo = new MongoJobEventsRepository(
      collection,
      () => new Date("2026-04-27T10:00:00.000Z")
    );

    const first = await repo.claimEvent({
      eventKey: "season:sea_1:season_started:2026-04-22T17:00:00.000Z",
      eventType: "season_started",
      seasonId: "sea_1",
      scheduledAt: new Date("2026-04-22T17:00:00.000Z")
    });
    await repo.markCompleted(first.eventKey);
    const second = await repo.claimEvent({
      eventKey: first.eventKey,
      eventType: "season_started",
      seasonId: "sea_1",
      scheduledAt: first.scheduledAt
    });

    expect(first.claimed).toBe(true);
    expect(second.claimed).toBe(false);
  });

  test("retries failed events", async () => {
    const collection = new FakeJobEventsCollection();
    const repo = new MongoJobEventsRepository(
      collection,
      () => new Date("2026-04-27T10:00:00.000Z")
    );

    const first = await repo.claimEvent({
      eventKey: "season:sea_1:season_ends_in_1d:2026-04-28T17:00:00.000Z",
      eventType: "season_ends_in_1d",
      seasonId: "sea_1",
      scheduledAt: new Date("2026-04-28T17:00:00.000Z")
    });
    await repo.markFailed(first.eventKey, "network");
    const second = await repo.claimEvent({
      eventKey: first.eventKey,
      eventType: "season_ends_in_1d",
      seasonId: "sea_1",
      scheduledAt: first.scheduledAt
    });

    expect(second.claimed).toBe(true);
    expect(collection.rows.get(first.eventKey)?.attempts).toBe(2);
  });
});

function matchesRetryFilter(
  document: MongoJobEventDocument,
  filter: Record<string, unknown>
): boolean {
  const clauses = filter.$or as Array<Record<string, unknown>> | undefined;
  if (!clauses) return true;
  return clauses.some((clause) => {
    if (clause.status === "failed") {
      return document.status === "failed";
    }
    if (clause.status && typeof clause.status === "object") {
      return false;
    }
    const startedClause = clause as {
      status?: string;
      updatedAt?: { $lt?: Date };
    };
    if (startedClause.status === "started" && startedClause.updatedAt?.$lt) {
      return (
        document.status === "started" &&
        document.updatedAt.getTime() < startedClause.updatedAt.$lt.getTime()
      );
    }
    return false;
  });
}

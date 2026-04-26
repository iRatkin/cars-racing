# Season Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a portable season automation runner that creates weekly seasons, sends player reminders, and sends admins finished-season top-10 summaries.

**Architecture:** Keep scheduling business logic out of `src/app.ts`. Add a `season-automation` module for time calculations, event formatting, idempotent orchestration, and a compiled CLI runner that any cron provider can invoke. Store idempotency in Mongo through a new `jobEvents` collection.

**Tech Stack:** Node.js 22, TypeScript ESM, MongoDB driver 6, Fastify runtime config, Telegram Bot API helpers, Vitest.

---

## File Structure

- Create `src/modules/season-automation/season-schedule.ts`: pure date/window/notification calculations for Wednesday 20:00 `Europe/Moscow`.
- Create `src/modules/season-automation/job-events-repository.ts`: job event types and repository interface.
- Create `src/infra/mongo/job-events-repository.ts`: Mongo implementation with event claiming, completion, failure, duplicate-key handling, and stale-start retry.
- Create `src/modules/season-automation/season-automation-format.ts`: HTML-safe player and admin Telegram message formatters.
- Create `src/modules/season-automation/season-automation-service.ts`: orchestration service that creates cloned seasons and sends due notifications.
- Create `src/jobs/season-tick.ts`: one-shot CLI entrypoint that loads config, connects Mongo, runs one automation tick, closes Mongo, and exits.
- Modify `src/modules/seasons/seasons-repository.ts`: add window lookup and latest-previous-season methods.
- Modify `src/infra/mongo/seasons-repository.ts`: implement the new season lookup methods.
- Modify `src/infra/mongo/indexes.ts`: add `jobEvents` unique and status indexes.
- Do not modify `src/runtime.ts`; the HTTP API must not start scheduler work.
- Do not modify `src/config/config.ts`; the first implementation uses existing config and passes `Europe/Moscow` as the fixed business schedule in the automation domain.
- Modify `package.json`: add `jobs:season-tick`.
- Modify `AGENTS.md`: document the runner, cron cadence, clone fallback, and `jobEvents`.
- Test `tests/modules/season-automation/season-schedule.test.ts`.
- Test `tests/modules/season-automation/season-automation-format.test.ts`.
- Test `tests/modules/season-automation/season-automation-service.test.ts`.
- Test `tests/infra/mongo/job-events-repository.test.ts`.

---

### Task 1: Season Schedule Domain

**Files:**
- Create: `src/modules/season-automation/season-schedule.ts`
- Test: `tests/modules/season-automation/season-schedule.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/modules/season-automation/season-schedule.test.ts`:

```ts
import { describe, expect, test } from "vitest";

import {
  buildSeasonAutomationEventKey,
  getDueSeasonNotificationEvents,
  getMoscowWeeklySeasonWindow
} from "../../../src/modules/season-automation/season-schedule.js";

describe("season automation schedule", () => {
  test("computes the current Wednesday 20:00 MSK weekly window", () => {
    const now = new Date("2026-04-27T09:00:00.000Z");

    const window = getMoscowWeeklySeasonWindow(now);

    expect(window.startsAt.toISOString()).toBe("2026-04-22T17:00:00.000Z");
    expect(window.endsAt.toISOString()).toBe("2026-04-29T17:00:00.000Z");
  });

  test("moves into the next weekly window exactly at Wednesday 20:00 MSK", () => {
    const now = new Date("2026-04-29T17:00:00.000Z");

    const window = getMoscowWeeklySeasonWindow(now);

    expect(window.startsAt.toISOString()).toBe("2026-04-29T17:00:00.000Z");
    expect(window.endsAt.toISOString()).toBe("2026-05-06T17:00:00.000Z");
  });

  test("returns only notification events that are due", () => {
    const season = {
      seasonId: "sea_1",
      startsAt: new Date("2026-04-22T17:00:00.000Z"),
      endsAt: new Date("2026-04-29T17:00:00.000Z")
    };
    const now = new Date("2026-04-28T17:00:01.000Z");

    const events = getDueSeasonNotificationEvents(season, now);

    expect(events.map((event) => event.eventType)).toEqual([
      "season_started",
      "season_ends_in_3d",
      "season_ends_in_1d"
    ]);
    expect(events[0]?.scheduledAt.toISOString()).toBe("2026-04-22T17:00:00.000Z");
    expect(events[2]?.scheduledAt.toISOString()).toBe("2026-04-28T17:00:00.000Z");
  });

  test("builds deterministic season event keys", () => {
    const key = buildSeasonAutomationEventKey({
      seasonId: "sea_1",
      eventType: "season_started",
      scheduledAt: new Date("2026-04-22T17:00:00.000Z")
    });

    expect(key).toBe("season:sea_1:season_started:2026-04-22T17:00:00.000Z");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
npm test -- tests/modules/season-automation/season-schedule.test.ts
```

Expected: FAIL because `src/modules/season-automation/season-schedule.ts` does not exist.

- [ ] **Step 3: Write the minimal implementation**

Create `src/modules/season-automation/season-schedule.ts`:

```ts
export type SeasonAutomationEventType =
  | "season_started"
  | "season_ends_in_3d"
  | "season_ends_in_1d"
  | "season_ends_in_6h"
  | "season_finished_admin_top10";

export interface SeasonAutomationWindow {
  startsAt: Date;
  endsAt: Date;
}

export interface SeasonNotificationCandidate {
  eventType: SeasonAutomationEventType;
  scheduledAt: Date;
}

const MSK_OFFSET_MS = 3 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
const WEDNESDAY_20_MSK_HOUR = 20;

export function getMoscowWeeklySeasonWindow(referenceNow: Date): SeasonAutomationWindow {
  const nowMsk = new Date(referenceNow.getTime() + MSK_OFFSET_MS);
  const mskDay = nowMsk.getUTCDay();
  const daysSinceWednesday = (mskDay - 3 + 7) % 7;
  const candidateMskMs = Date.UTC(
    nowMsk.getUTCFullYear(),
    nowMsk.getUTCMonth(),
    nowMsk.getUTCDate() - daysSinceWednesday,
    WEDNESDAY_20_MSK_HOUR,
    0,
    0,
    0
  );
  const candidateUtcMs = candidateMskMs - MSK_OFFSET_MS;
  const startsAtMs =
    referenceNow.getTime() >= candidateUtcMs
      ? candidateUtcMs
      : candidateUtcMs - WEEK_MS;

  return {
    startsAt: new Date(startsAtMs),
    endsAt: new Date(startsAtMs + WEEK_MS)
  };
}

export function getDueSeasonNotificationEvents(
  season: { seasonId: string; startsAt: Date; endsAt: Date },
  referenceNow: Date
): SeasonNotificationCandidate[] {
  const candidates: SeasonNotificationCandidate[] = [
    { eventType: "season_started", scheduledAt: season.startsAt },
    { eventType: "season_ends_in_3d", scheduledAt: new Date(season.endsAt.getTime() - 3 * DAY_MS) },
    { eventType: "season_ends_in_1d", scheduledAt: new Date(season.endsAt.getTime() - DAY_MS) },
    { eventType: "season_ends_in_6h", scheduledAt: new Date(season.endsAt.getTime() - 6 * 60 * 60 * 1000) },
    { eventType: "season_finished_admin_top10", scheduledAt: season.endsAt }
  ];

  return candidates.filter((candidate) => candidate.scheduledAt.getTime() <= referenceNow.getTime());
}

export function buildSeasonAutomationEventKey(input: {
  seasonId: string;
  eventType: SeasonAutomationEventType;
  scheduledAt: Date;
}): string {
  return `season:${input.seasonId}:${input.eventType}:${input.scheduledAt.toISOString()}`;
}

export function buildSeasonWindowCreationEventKey(windowStart: Date): string {
  return `season-window:${windowStart.toISOString()}`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run:

```bash
npm test -- tests/modules/season-automation/season-schedule.test.ts
```

Expected: PASS.

- [ ] **Step 5: Keep the implementation small**

Keep the fixed MSK offset and add one code comment explaining that the product schedule is Wednesday 20:00 Moscow time, which is UTC+03:00 for this Phase 0 implementation. Do not add a timezone library in this task.

---

### Task 2: Telegram Message Formatters

**Files:**
- Create: `src/modules/season-automation/season-automation-format.ts`
- Test: `tests/modules/season-automation/season-automation-format.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/modules/season-automation/season-automation-format.test.ts`:

```ts
import { describe, expect, test } from "vitest";

import {
  formatAdminSeasonFinishedTopMessage,
  formatPlayerSeasonNotification
} from "../../../src/modules/season-automation/season-automation-format.js";

describe("season automation formatters", () => {
  test("formats player start notification with escaped nickname", () => {
    const text = formatPlayerSeasonNotification({
      eventType: "season_started",
      nick: "Drift<Name>"
    });

    expect(text).toBe("Дружище Drift&lt;Name&gt; - новый сезон начался, торопись дрифтить!");
  });

  test("formats player ending notification", () => {
    const text = formatPlayerSeasonNotification({
      eventType: "season_ends_in_6h",
      nick: "Ivan_42"
    });

    expect(text).toBe("Дружище Ivan_42 - поторопись, сезон заканчивается!");
  });

  test("formats admin top-10 with season metadata and leaderboard rows", () => {
    const text = formatAdminSeasonFinishedTopMessage({
      season: {
        title: "Spring <Cup>",
        mapId: "map_1",
        endsAt: new Date("2026-04-29T17:00:00.000Z")
      },
      totalParticipants: 2,
      entries: [
        { rank: 1, nick: "Ana", bestScore: 1500, totalRaces: 3 },
        { rank: 2, nick: "Bob", bestScore: 900, totalRaces: 1 }
      ]
    });

    expect(text).toContain("🏁 <b>Season Finished</b>");
    expect(text).toContain("Spring &lt;Cup&gt;");
    expect(text).toContain("Participants: <b>2</b>");
    expect(text).toContain("1. Ana — <b>1500</b> pts, races: 3");
    expect(text).toContain("2. Bob — <b>900</b> pts, races: 1");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
npm test -- tests/modules/season-automation/season-automation-format.test.ts
```

Expected: FAIL because the formatter module does not exist.

- [ ] **Step 3: Write the minimal implementation**

Create `src/modules/season-automation/season-automation-format.ts`:

```ts
import { escapeHtml } from "../admin/admin-input.js";
import type { SeasonAutomationEventType } from "./season-schedule.js";

export interface PlayerSeasonNotificationInput {
  eventType: SeasonAutomationEventType;
  nick: string;
}

export interface AdminTopEntry {
  rank: number;
  nick: string;
  bestScore: number;
  totalRaces: number;
}

export interface AdminSeasonFinishedTopMessageInput {
  season: {
    title: string;
    mapId: string;
    endsAt: Date;
  };
  totalParticipants: number;
  entries: AdminTopEntry[];
}

export function formatPlayerSeasonNotification(input: PlayerSeasonNotificationInput): string {
  const nick = escapeHtml(input.nick);
  if (input.eventType === "season_started") {
    return `Дружище ${nick} - новый сезон начался, торопись дрифтить!`;
  }
  return `Дружище ${nick} - поторопись, сезон заканчивается!`;
}

export function formatAdminSeasonFinishedTopMessage(
  input: AdminSeasonFinishedTopMessageInput
): string {
  const rows =
    input.entries.length === 0
      ? "No ranked results."
      : input.entries
          .map(
            (entry) =>
              `${entry.rank}. ${escapeHtml(entry.nick)} — <b>${entry.bestScore}</b> pts, races: ${entry.totalRaces}`
          )
          .join("\n");

  return (
    `🏁 <b>Season Finished</b>\n\n` +
    `Title: ${escapeHtml(input.season.title)}\n` +
    `Map: <code>${escapeHtml(input.season.mapId)}</code>\n` +
    `Ended: ${formatDateUtc(input.season.endsAt)}\n` +
    `Participants: <b>${input.totalParticipants}</b>\n\n` +
    `<b>Top 10</b>\n${rows}`
  );
}

function formatDateUtc(date: Date): string {
  return `${date.toISOString().replace("T", " ").slice(0, 16)} UTC`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run:

```bash
npm test -- tests/modules/season-automation/season-automation-format.test.ts
```

Expected: PASS.

---

### Task 3: Job Events Repository Interface And Mongo Implementation

**Files:**
- Create: `src/modules/season-automation/job-events-repository.ts`
- Create: `src/infra/mongo/job-events-repository.ts`
- Modify: `src/infra/mongo/indexes.ts`
- Test: `tests/infra/mongo/job-events-repository.test.ts`

- [ ] **Step 1: Write the failing repository test with a fake collection**

Create `tests/infra/mongo/job-events-repository.test.ts`:

```ts
import { describe, expect, test } from "vitest";

import { MongoJobEventsRepository } from "../../../src/infra/mongo/job-events-repository.js";
import type { MongoJobEventDocument } from "../../../src/infra/mongo/job-events-repository.js";

class FakeJobEventsCollection {
  rows = new Map<string, MongoJobEventDocument>();

  async findOneAndUpdate(
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
    options: { upsert?: boolean; returnDocument: "after"; includeResultMetadata: false }
  ): Promise<MongoJobEventDocument | null> {
    const eventKey = String(filter.eventKey);
    const existing = this.rows.get(eventKey);
    const now = new Date("2026-04-27T10:00:00.000Z");
    if (existing && existing.status === "completed") return null;
    if (existing && existing.status === "started") return null;

    const next: MongoJobEventDocument = existing
      ? { ...existing, status: "started", attempts: existing.attempts + 1, updatedAt: now }
      : {
          eventKey,
          eventType: String(update.$setOnInsert?.eventType),
          seasonId: String(update.$setOnInsert?.seasonId),
          scheduledAt: update.$setOnInsert?.scheduledAt as Date,
          status: "started",
          attempts: 1,
          createdAt: now,
          updatedAt: now
        };
    this.rows.set(eventKey, next);
    return options.returnDocument === "after" ? next : null;
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
    const repo = new MongoJobEventsRepository(collection);

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
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
npm test -- tests/infra/mongo/job-events-repository.test.ts
```

Expected: FAIL because the repository files do not exist.

- [ ] **Step 3: Add the repository interface**

Create `src/modules/season-automation/job-events-repository.ts`:

```ts
import type { SeasonAutomationEventType } from "./season-schedule.js";

export type JobEventStatus = "started" | "completed" | "failed";

export interface JobEventClaimInput {
  eventKey: string;
  eventType: SeasonAutomationEventType | "season_window_created";
  seasonId: string;
  scheduledAt: Date;
}

export interface JobEventClaimResult {
  claimed: boolean;
  eventKey: string;
  scheduledAt: Date;
}

export interface JobEventsRepository {
  claimEvent(input: JobEventClaimInput): Promise<JobEventClaimResult>;
  markCompleted(eventKey: string): Promise<void>;
  markFailed(eventKey: string, error: string): Promise<void>;
}
```

- [ ] **Step 4: Add the Mongo implementation**

Create `src/infra/mongo/job-events-repository.ts`:

```ts
import type { WithId } from "mongodb";

import type {
  JobEventClaimInput,
  JobEventClaimResult,
  JobEventStatus,
  JobEventsRepository
} from "../../modules/season-automation/job-events-repository.js";

export interface MongoJobEventDocument {
  eventKey: string;
  eventType: string;
  seasonId: string;
  scheduledAt: Date;
  status: JobEventStatus;
  attempts: number;
  lastError?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface JobEventsCollection {
  findOneAndUpdate(
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
    options: {
      upsert?: boolean;
      returnDocument: "after";
      includeResultMetadata: false;
    }
  ): Promise<WithId<MongoJobEventDocument> | MongoJobEventDocument | null>;
  updateOne(filter: Record<string, unknown>, update: Record<string, unknown>): Promise<unknown>;
}

const STALE_STARTED_MS = 30 * 60 * 1000;

export class MongoJobEventsRepository implements JobEventsRepository {
  constructor(
    private readonly collection: JobEventsCollection,
    private readonly now: () => Date = () => new Date()
  ) {}

  async claimEvent(input: JobEventClaimInput): Promise<JobEventClaimResult> {
    const now = this.now();
    const staleBefore = new Date(now.getTime() - STALE_STARTED_MS);
    const document = await this.collection.findOneAndUpdate(
      {
        eventKey: input.eventKey,
        $or: [
          { status: { $exists: false } },
          { status: "failed" },
          { status: "started", updatedAt: { $lt: staleBefore } }
        ]
      },
      {
        $setOnInsert: {
          eventKey: input.eventKey,
          eventType: input.eventType,
          seasonId: input.seasonId,
          scheduledAt: input.scheduledAt,
          createdAt: now
        },
        $set: {
          status: "started",
          lastError: undefined,
          updatedAt: now
        },
        $inc: { attempts: 1 }
      },
      { upsert: true, returnDocument: "after", includeResultMetadata: false }
    );

    return {
      claimed: document !== null,
      eventKey: input.eventKey,
      scheduledAt: input.scheduledAt
    };
  }

  async markCompleted(eventKey: string): Promise<void> {
    await this.collection.updateOne(
      { eventKey },
      { $set: { status: "completed", updatedAt: this.now() } }
    );
  }

  async markFailed(eventKey: string, error: string): Promise<void> {
    await this.collection.updateOne(
      { eventKey },
      { $set: { status: "failed", lastError: error, updatedAt: this.now() } }
    );
  }
}
```

- [ ] **Step 5: Add indexes**

Modify `src/infra/mongo/indexes.ts`:

```ts
export const jobEventsIndexes = [
  {
    keys: { eventKey: 1 },
    options: {
      name: "jobEvents_eventKey_unique",
      unique: true
    }
  },
  {
    keys: { status: 1, updatedAt: 1 },
    options: {
      name: "jobEvents_status_updatedAt"
    }
  }
] as const satisfies readonly CollectionIndexDefinition[];
```

Then add this line inside `ensureMongoIndexes`:

```ts
await createCollectionIndexes(db, "jobEvents", jobEventsIndexes);
```

- [ ] **Step 6: Run the repository test**

Run:

```bash
npm test -- tests/infra/mongo/job-events-repository.test.ts
```

Expected: PASS. If the fake collection type is too strict, adjust only the fake collection to satisfy the production interface.

---

### Task 4: Season Repository Lookup Helpers

**Files:**
- Modify: `src/modules/seasons/seasons-repository.ts`
- Modify: `src/infra/mongo/seasons-repository.ts`
- Test: `tests/infra/mongo/seasons-repository-window.test.ts`

- [ ] **Step 1: Write the failing test with a fake seasons collection**

Create `tests/infra/mongo/seasons-repository-window.test.ts`:

```ts
import { describe, expect, test } from "vitest";

import { MongoSeasonsRepository, type MongoSeasonDocument } from "../../../src/infra/mongo/seasons-repository.js";

class FakeFindCursor {
  constructor(private rows: MongoSeasonDocument[]) {}
  sort(sort: Record<string, 1 | -1>) {
    const key = Object.keys(sort)[0] as keyof MongoSeasonDocument;
    const dir = sort[key as string] ?? 1;
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
      const windowStart = ((filter.$or as Array<Record<string, Record<string, Date>>>)[0]?.startsAt?.$lte) as Date;
      const windowEnd = ((filter.$or as Array<Record<string, Record<string, Date>>>)[1]?.startsAt?.$lt) as Date;
      return new FakeFindCursor(
        this.rows.filter(
          (row) =>
            (row.startsAt.getTime() <= windowStart.getTime() && row.endsAt.getTime() > windowStart.getTime()) ||
            (row.startsAt.getTime() >= windowStart.getTime() && row.startsAt.getTime() < windowEnd.getTime())
        )
      );
    }
    if ("startsAt" in filter) {
      const lt = (filter.startsAt as { $lt: Date }).$lt;
      return new FakeFindCursor(this.rows.filter((row) => row.startsAt.getTime() < lt.getTime()));
    }
    return new FakeFindCursor(this.rows);
  }
  async insertOne() {}
  async findOneAndUpdate() { return null; }
}

describe("MongoSeasonsRepository window lookups", () => {
  test("finds a manually prepared season in the weekly window", async () => {
    const repo = new MongoSeasonsRepository(new FakeSeasonsCollection([
      season("sea_manual", "2026-04-29T17:00:00.000Z", "2026-05-06T17:00:00.000Z")
    ]));

    const found = await repo.findSeasonForWindow(
      new Date("2026-04-29T17:00:00.000Z"),
      new Date("2026-05-06T17:00:00.000Z"),
      new Date("2026-04-29T18:00:00.000Z")
    );

    expect(found?.seasonId).toBe("sea_manual");
  });

  test("finds latest previous season before a window", async () => {
    const repo = new MongoSeasonsRepository(new FakeSeasonsCollection([
      season("sea_old", "2026-04-15T17:00:00.000Z", "2026-04-22T17:00:00.000Z"),
      season("sea_prev", "2026-04-22T17:00:00.000Z", "2026-04-29T17:00:00.000Z")
    ]));

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
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
npm test -- tests/infra/mongo/seasons-repository-window.test.ts
```

Expected: FAIL because the repository interface lacks the new methods.

- [ ] **Step 3: Extend the interface and Mongo collection cursor type**

Modify `src/modules/seasons/seasons-repository.ts`:

```ts
export interface SeasonsRepository {
  getSeasonById(seasonId: string, referenceNow: Date): Promise<Season | null>;
  getActiveAndUpcomingSeasons(referenceNow: Date): Promise<Season[]>;
  getAllSeasons(referenceNow: Date): Promise<Season[]>;
  findSeasonForWindow(windowStart: Date, windowEnd: Date, referenceNow: Date): Promise<Season | null>;
  findLatestSeasonBefore(windowStart: Date, referenceNow: Date): Promise<Season | null>;
  createSeason(input: CreateSeasonInput, referenceNow: Date): Promise<Season>;
  updateSeason(seasonId: string, patch: UpdateSeasonInput, referenceNow: Date): Promise<Season | null>;
}
```

Modify the `SeasonsCollection.find()` return type in `src/infra/mongo/seasons-repository.ts` so the cursor supports `.limit()` after `.sort()`:

```ts
find(filter: Record<string, unknown>): {
  sort(sort: Record<string, 1 | -1>): {
    limit(limit: number): {
      toArray(): Promise<Array<WithId<MongoSeasonDocument> | MongoSeasonDocument>>;
    };
    toArray(): Promise<Array<WithId<MongoSeasonDocument> | MongoSeasonDocument>>;
  };
};
```

- [ ] **Step 4: Implement lookup methods**

Add to `MongoSeasonsRepository`:

```ts
async findSeasonForWindow(
  windowStart: Date,
  windowEnd: Date,
  referenceNow: Date
): Promise<Season | null> {
  const rows = await this.collection
    .find({
      $or: [
        { startsAt: { $lte: windowStart }, endsAt: { $gt: windowStart } },
        { startsAt: { $gte: windowStart, $lt: windowEnd } }
      ]
    })
    .sort({ startsAt: 1 })
    .limit(1)
    .toArray();
  return rows[0] ? mapSeasonDocument(rows[0], referenceNow) : null;
}

async findLatestSeasonBefore(windowStart: Date, referenceNow: Date): Promise<Season | null> {
  const rows = await this.collection
    .find({ startsAt: { $lt: windowStart } })
    .sort({ startsAt: -1 })
    .limit(1)
    .toArray();
  return rows[0] ? mapSeasonDocument(rows[0], referenceNow) : null;
}
```

- [ ] **Step 5: Run the test**

Run:

```bash
npm test -- tests/infra/mongo/seasons-repository-window.test.ts
```

Expected: PASS.

---

### Task 5: Season Automation Service

**Files:**
- Create: `src/modules/season-automation/season-automation-service.ts`
- Test: `tests/modules/season-automation/season-automation-service.test.ts`

- [ ] **Step 1: Write failing service tests**

Create `tests/modules/season-automation/season-automation-service.test.ts` with fakes for repositories and Telegram sends:

```ts
import { describe, expect, test } from "vitest";

import { createSeasonAutomationService } from "../../../src/modules/season-automation/season-automation-service.js";
import type { Season } from "../../../src/modules/seasons/seasons-domain.js";
import type { AppUser } from "../../../src/modules/users/users-repository.js";

describe("season automation service", () => {
  test("clones the latest previous season when the current weekly window is empty", async () => {
    const deps = buildDeps({
      seasons: [season("sea_prev", "2026-04-22T17:00:00.000Z", "2026-04-29T17:00:00.000Z")]
    });
    const service = createSeasonAutomationService(deps);

    await service.runOnce(new Date("2026-04-29T17:05:00.000Z"));

    expect(deps.createdSeasons).toEqual([
      {
        title: "Weekly Cup",
        mapId: "map_1",
        entryFee: 25,
        prizePoolShare: 0.2,
        startsAt: new Date("2026-04-29T17:00:00.000Z"),
        endsAt: new Date("2026-05-06T17:00:00.000Z")
      }
    ]);
  });

  test("does not clone when an admin-created season already exists for the window", async () => {
    const deps = buildDeps({
      seasons: [season("sea_manual", "2026-04-29T17:00:00.000Z", "2026-05-06T17:00:00.000Z")]
    });
    const service = createSeasonAutomationService(deps);

    await service.runOnce(new Date("2026-04-29T17:05:00.000Z"));

    expect(deps.createdSeasons).toEqual([]);
  });

  test("sends due player notifications once", async () => {
    const deps = buildDeps({
      seasons: [season("sea_active", "2026-04-22T17:00:00.000Z", "2026-04-29T17:00:00.000Z")],
      users: [user("usr_1", "111", "Racer_1")]
    });
    const service = createSeasonAutomationService(deps);

    await service.runOnce(new Date("2026-04-28T17:01:00.000Z"));
    await service.runOnce(new Date("2026-04-28T17:02:00.000Z"));

    expect(deps.playerMessages).toContainEqual({
      chatId: "111",
      text: "Дружище Racer_1 - новый сезон начался, торопись дрифтить!"
    });
    expect(deps.playerMessages).toContainEqual({
      chatId: "111",
      text: "Дружище Racer_1 - поторопись, сезон заканчивается!"
    });
    expect(deps.playerMessages.length).toBe(3);
  });

  test("sends admin finished top-10 after season end", async () => {
    const deps = buildDeps({
      seasons: [season("sea_done", "2026-04-22T17:00:00.000Z", "2026-04-29T17:00:00.000Z")],
      users: [user("usr_1", "111", "Champion")],
      leaderboard: [{ entryId: "entry_1", seasonId: "sea_done", userId: "usr_1", bestScore: 2000, totalRaces: 4, entryFeeSnapshot: 25, createdAt: new Date("2026-04-22T18:00:00.000Z") }]
    });
    const service = createSeasonAutomationService(deps);

    await service.runOnce(new Date("2026-04-29T17:01:00.000Z"));

    expect(deps.adminMessages).toHaveLength(1);
    expect(deps.adminMessages[0]?.chatId).toBe("999");
    expect(deps.adminMessages[0]?.text).toContain("Champion");
    expect(deps.adminMessages[0]?.text).toContain("2000");
  });
});
```

Add fakes in the same file below the tests. The fake `jobEventsRepository.claimEvent()` must return `{ claimed: false }` for repeated event keys so the second run proves idempotency.

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
npm test -- tests/modules/season-automation/season-automation-service.test.ts
```

Expected: FAIL because `season-automation-service.ts` does not exist.

- [ ] **Step 3: Implement the service API**

Create `src/modules/season-automation/season-automation-service.ts` with these exported shapes:

```ts
import type { CreateSeasonInput, SeasonsRepository } from "../seasons/seasons-repository.js";
import type { SeasonEntriesRepository } from "../seasons/season-entries-repository.js";
import type { UsersRepository } from "../users/users-repository.js";
import type { JobEventsRepository } from "./job-events-repository.js";

export interface SeasonAutomationLogger {
  info(obj: Record<string, unknown>, msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
}

export interface SeasonAutomationTelegramSender {
  sendPlayerMessage(input: { chatId: string; text: string }): Promise<void>;
  sendAdminMessage(input: { chatId: string; text: string }): Promise<void>;
}

export interface CreateSeasonAutomationServiceDeps {
  seasonsRepository: SeasonsRepository;
  seasonEntriesRepository: SeasonEntriesRepository;
  usersRepository: UsersRepository;
  jobEventsRepository: JobEventsRepository;
  telegram: SeasonAutomationTelegramSender;
  adminTelegramIds: string[];
  logger?: SeasonAutomationLogger;
}

export interface SeasonAutomationService {
  runOnce(referenceNow: Date): Promise<void>;
}
```

- [ ] **Step 4: Implement cloning and event processing**

Use the following service structure:

```ts
export function createSeasonAutomationService(
  deps: CreateSeasonAutomationServiceDeps
): SeasonAutomationService {
  return {
    async runOnce(referenceNow: Date): Promise<void> {
      await ensureWeeklySeasonExists(deps, referenceNow);
      await processDueSeasonEvents(deps, referenceNow);
    }
  };
}
```

Implementation rules:

- `ensureWeeklySeasonExists()`:
  - call `getMoscowWeeklySeasonWindow(referenceNow)`;
  - skip if `seasonsRepository.findSeasonForWindow(...)` returns a season;
  - load `findLatestSeasonBefore(window.startsAt, referenceNow)`;
  - skip with warning if missing;
  - claim event key from `buildSeasonWindowCreationEventKey(window.startsAt)`;
  - re-check `findSeasonForWindow()` after claim;
  - create season with copied fields and window dates;
  - mark completed after create.

- `processDueSeasonEvents()`:
  - call `seasonsRepository.getAllSeasons(referenceNow)`;
  - for each season, call `getDueSeasonNotificationEvents(season, referenceNow)`;
  - claim each event with `buildSeasonAutomationEventKey(...)`;
  - for player events, call `usersRepository.getAllUsers()` and send to each `telegramUserId`;
  - for admin top-10, skip when `adminTelegramIds.length === 0`, otherwise build leaderboard rows from `seasonEntriesRepository.getLeaderboard(seasonId, 10)`;
  - mark completed when the event-level operation finishes;
  - mark failed only when the event-level operation throws outside per-user best-effort sends.

- Rank calculation must match public leaderboard behavior:

```ts
let previousScore: number | null = null;
let previousRank = 0;
const rows = [];
for (const [index, entry] of entries.entries()) {
  const rank = previousScore !== null && entry.bestScore === previousScore ? previousRank : index + 1;
  const user = await deps.usersRepository.getUserById(entry.userId);
  rows.push({
    rank,
    nick: user ? buildPublicNick(user) : buildPublicNick({ telegramUserId: entry.userId.replace(/^usr_/, "") }),
    bestScore: entry.bestScore,
    totalRaces: entry.totalRaces
  });
  previousScore = entry.bestScore;
  previousRank = rank;
}
```

- [ ] **Step 5: Run the service tests**

Run:

```bash
npm test -- tests/modules/season-automation/season-automation-service.test.ts
```

Expected: PASS.

---

### Task 6: CLI Runner Wiring

**Files:**
- Create: `src/jobs/season-tick.ts`
- Modify: `package.json`
- Modify: `src/config/config.ts` if adding automation config parsing

- [ ] **Step 1: Write a minimal build-facing smoke test**

No runtime test is needed for real Mongo/Telegram. The verification target is TypeScript build. Add no production code before Task 1-5 tests are green.

- [ ] **Step 2: Implement the runner**

Create `src/jobs/season-tick.ts`:

```ts
import "dotenv/config";
import { MongoClient } from "mongodb";

import { loadConfigFromEnv } from "../config/config.js";
import { MongoJobEventsRepository, type MongoJobEventDocument } from "../infra/mongo/job-events-repository.js";
import { MongoSeasonEntriesRepository, type MongoSeasonEntryDocument } from "../infra/mongo/season-entries-repository.js";
import { MongoSeasonsRepository, type MongoSeasonDocument } from "../infra/mongo/seasons-repository.js";
import { MongoUsersRepository, type MongoUserDocument } from "../infra/mongo/users-repository.js";
import { createSeasonAutomationService } from "../modules/season-automation/season-automation-service.js";
import { sendTelegramMessage } from "../modules/telegram/invoice-link.js";

async function main(): Promise<void> {
  const config = loadConfigFromEnv();
  const mongoClient = new MongoClient(config.mongoUri);
  await mongoClient.connect();

  try {
    const db = mongoClient.db();
    const service = createSeasonAutomationService({
      seasonsRepository: new MongoSeasonsRepository(db.collection<MongoSeasonDocument>("seasons")),
      seasonEntriesRepository: new MongoSeasonEntriesRepository(db.collection<MongoSeasonEntryDocument>("seasonEntries")),
      usersRepository: new MongoUsersRepository(db.collection<MongoUserDocument>("users")),
      jobEventsRepository: new MongoJobEventsRepository(db.collection<MongoJobEventDocument>("jobEvents")),
      adminTelegramIds: config.adminConfig?.adminTelegramIds ?? [],
      telegram: {
        sendPlayerMessage: ({ chatId, text }) =>
          sendTelegramMessage({ botToken: config.botToken }, { chatId, text }),
        sendAdminMessage: ({ chatId, text }) => {
          if (!config.adminConfig) {
            return Promise.resolve();
          }
          return sendTelegramMessage(
            { botToken: config.adminConfig.adminBotToken },
            { chatId, text }
          );
        }
      },
      logger: consoleLogger
    });

    await service.runOnce(new Date());
  } finally {
    await mongoClient.close();
  }
}

const consoleLogger = {
  info(obj: Record<string, unknown>, msg: string) {
    console.log(JSON.stringify({ level: "info", msg, ...obj }));
  },
  warn(obj: Record<string, unknown>, msg: string) {
    console.warn(JSON.stringify({ level: "warn", msg, ...obj }));
  },
  error(obj: Record<string, unknown>, msg: string) {
    console.error(JSON.stringify({ level: "error", msg, ...obj }));
  }
};

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
```

- [ ] **Step 3: Add the package script**

Modify `package.json`:

```json
"jobs:season-tick": "node dist/src/jobs/season-tick.js"
```

- [ ] **Step 4: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS. Fix import paths and collection type issues if TypeScript reports them.

---

### Task 7: Documentation And AGENTS Update

**Files:**
- Modify: `AGENTS.md`
- Optional modify: `swagger.yaml` only if exposing an HTTP surface; this feature does not require new HTTP endpoints.

- [ ] **Step 1: Update AGENTS.md**

Add a concise section under "Current Reality" or "Battle seasons":

```md
Season automation:
- Portable one-shot runner: `npm run build && npm run jobs:season-tick`.
- Intended external schedule: every 5-15 minutes from Railway Cron, GitHub Actions, VPS cron, or any equivalent scheduler.
- Railway weekly boundary expression for Wednesday 20:00 MSK is `0 17 * * 3`, but the preferred tick is `*/15 * * * *` with Mongo idempotency.
- Weekly season boundary is Wednesday 20:00 `Europe/Moscow`.
- If no manually created season exists for the current weekly window, the runner clones the latest previous season's title/map/entry fee/prize share and assigns the current weekly window dates.
- Player notifications are sent by the main bot at season start, 3 days before end, 1 day before end, and 6 hours before end.
- Admin bot sends top-10 ranked leaderboard summaries after season end when admin env vars are configured.
- `jobEvents` stores idempotency records for season creation and notification events.
```

- [ ] **Step 2: Mention the new collection**

Add `jobEvents` to the "Collections used now" list and describe the document fields in the data model snapshot.

- [ ] **Step 3: Run a docs diff check**

Run:

```bash
git diff -- AGENTS.md
```

Expected: only the season automation documentation changes.

---

### Task 8: Full Verification

**Files:** all changed files

- [ ] **Step 1: Run targeted tests**

Run:

```bash
npm test -- tests/modules/season-automation/season-schedule.test.ts
npm test -- tests/modules/season-automation/season-automation-format.test.ts
npm test -- tests/modules/season-automation/season-automation-service.test.ts
npm test -- tests/infra/mongo/job-events-repository.test.ts
npm test -- tests/infra/mongo/seasons-repository-window.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run all tests**

Run:

```bash
npm run test
```

Expected: PASS.

- [ ] **Step 3: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 4: Run build**

Run:

```bash
npm run build
```

Expected: PASS and `dist/src/jobs/season-tick.js` exists.

- [ ] **Step 5: Inspect git diff**

Run:

```bash
git diff --stat
git diff -- src tests package.json AGENTS.md
```

Expected: only planned files changed; no generated `dist` files staged.

- [ ] **Step 6: Commit implementation**

Run:

```bash
git add AGENTS.md package.json src tests
git commit -m "Add season automation runner"
```

Expected: commit succeeds.

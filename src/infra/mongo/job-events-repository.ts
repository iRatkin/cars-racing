import type { WithId } from "mongodb";

import type {
  JobEventCompletionInput,
  JobEventClaimInput,
  JobEventClaimResult,
  JobEventOutcome,
  JobEventSource,
  JobEventSuppressInput,
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
  source?: JobEventSource;
  outcome?: JobEventOutcome;
  reason?: string;
  lastError?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface JobEventsCollection {
  findOne(
    filter: Record<string, unknown>
  ): Promise<WithId<MongoJobEventDocument> | MongoJobEventDocument | null>;
  insertOne(document: MongoJobEventDocument): Promise<unknown>;
  findOneAndUpdate(
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
    options: { returnDocument: "after"; includeResultMetadata: false }
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
    const retryDocument = await this.collection.findOneAndUpdate(
      {
        eventKey: input.eventKey,
        $or: [
          { status: "failed" },
          { status: "started", updatedAt: { $lt: staleBefore } }
        ]
      },
      {
        $set: {
          status: "started",
          updatedAt: now,
          ...(input.source ? { source: input.source } : {})
        },
        $unset: { lastError: "", outcome: "", reason: "" },
        $inc: { attempts: 1 }
      },
      { returnDocument: "after", includeResultMetadata: false }
    );
    if (retryDocument) {
      return {
        claimed: true,
        eventKey: input.eventKey,
        scheduledAt: input.scheduledAt
      };
    }

    const existing = await this.collection.findOne({ eventKey: input.eventKey });
    if (existing) {
      return {
        claimed: false,
        eventKey: input.eventKey,
        scheduledAt: input.scheduledAt
      };
    }

    const document: MongoJobEventDocument = {
      eventKey: input.eventKey,
      eventType: input.eventType,
      seasonId: input.seasonId,
      scheduledAt: input.scheduledAt,
      status: "started",
      attempts: 1,
      ...(input.source ? { source: input.source } : {}),
      createdAt: now,
      updatedAt: now
    };

    try {
      await this.collection.insertOne(document);
      return {
        claimed: true,
        eventKey: input.eventKey,
        scheduledAt: input.scheduledAt
      };
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        return {
          claimed: false,
          eventKey: input.eventKey,
          scheduledAt: input.scheduledAt
        };
      }
      throw error;
    }
  }

  async markCompleted(
    eventKey: string,
    completion?: JobEventCompletionInput
  ): Promise<void> {
    const set: Record<string, unknown> = {
      status: "completed",
      updatedAt: this.now()
    };
    if (completion?.source) set.source = completion.source;
    if (completion?.outcome) set.outcome = completion.outcome;
    if (completion?.reason) set.reason = completion.reason;

    await this.collection.updateOne(
      { eventKey },
      { $set: set, $unset: { lastError: "" } }
    );
  }

  async markFailed(eventKey: string, error: string): Promise<void> {
    await this.collection.updateOne(
      { eventKey },
      {
        $set: {
          status: "failed",
          lastError: error,
          updatedAt: this.now()
        }
      }
    );
  }

  async suppressEvent(input: JobEventSuppressInput): Promise<void> {
    const existing = await this.collection.findOne({ eventKey: input.eventKey });
    if (existing?.status === "completed") {
      return;
    }

    const now = this.now();
    if (existing) {
      await this.collection.updateOne(
        { eventKey: input.eventKey },
        {
          $set: {
            status: "completed",
            source: input.source,
            outcome: "suppressed",
            reason: input.reason,
            updatedAt: now
          },
          $unset: { lastError: "" }
        }
      );
      return;
    }

    const document: MongoJobEventDocument = {
      eventKey: input.eventKey,
      eventType: input.eventType,
      seasonId: input.seasonId,
      scheduledAt: input.scheduledAt,
      status: "completed",
      attempts: 0,
      source: input.source,
      outcome: "suppressed",
      reason: input.reason,
      createdAt: now,
      updatedAt: now
    };

    try {
      await this.collection.insertOne(document);
    } catch (error) {
      if (!isDuplicateKeyError(error)) {
        throw error;
      }
    }
  }
}

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === 11000
  );
}

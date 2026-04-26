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
          updatedAt: now
        },
        $unset: { lastError: "" },
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

  async markCompleted(eventKey: string): Promise<void> {
    await this.collection.updateOne(
      { eventKey },
      { $set: { status: "completed", updatedAt: this.now() } }
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
}

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === 11000
  );
}

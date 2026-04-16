import { randomUUID } from "node:crypto";
import type { WithId } from "mongodb";

import {
  computeSeasonStatus,
  type Season
} from "../../modules/seasons/seasons-domain.js";
import {
  validateSeasonDateRange,
  type CreateSeasonInput,
  type SeasonsRepository,
  type UpdateSeasonInput
} from "../../modules/seasons/seasons-repository.js";

export interface MongoSeasonDocument {
  seasonId: string;
  title: string;
  mapId: string;
  entryFee: number;
  prizePoolShare: number;
  startsAt: Date;
  endsAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface SeasonsCollection {
  findOne(filter: { seasonId: string }): Promise<WithId<MongoSeasonDocument> | MongoSeasonDocument | null>;
  find(filter: Record<string, unknown>): {
    sort(sort: Record<string, 1 | -1>): {
      toArray(): Promise<Array<WithId<MongoSeasonDocument> | MongoSeasonDocument>>;
    };
  };
  insertOne(document: MongoSeasonDocument): Promise<unknown>;
  findOneAndUpdate(
    filter: { seasonId: string },
    update: Record<string, unknown>,
    options: { returnDocument: "after" }
  ): Promise<WithId<MongoSeasonDocument> | MongoSeasonDocument | null>;
}

export class MongoSeasonsRepository implements SeasonsRepository {
  constructor(private readonly collection: SeasonsCollection) {}

  async getSeasonById(seasonId: string, referenceNow: Date): Promise<Season | null> {
    const document = await this.collection.findOne({ seasonId });
    return document ? mapSeasonDocument(document, referenceNow) : null;
  }

  async getActiveAndUpcomingSeasons(referenceNow: Date): Promise<Season[]> {
    const rows = await this.collection
      .find({ endsAt: { $gt: referenceNow } })
      .sort({ startsAt: 1 })
      .toArray();
    return rows.map((document) => mapSeasonDocument(document, referenceNow));
  }

  async getAllSeasons(referenceNow: Date): Promise<Season[]> {
    const rows = await this.collection.find({}).sort({ startsAt: -1 }).toArray();
    return rows.map((document) => mapSeasonDocument(document, referenceNow));
  }

  async createSeason(input: CreateSeasonInput, referenceNow: Date): Promise<Season> {
    validateSeasonDateRange(input.startsAt, input.endsAt);
    if (!Number.isInteger(input.entryFee) || input.entryFee < 0) {
      throw new Error("Season entryFee must be a non-negative integer.");
    }
    if (!Number.isFinite(input.prizePoolShare) || input.prizePoolShare < 0 || input.prizePoolShare > 1) {
      throw new Error("Season prizePoolShare must be between 0 and 1.");
    }
    const now = new Date();
    const document: MongoSeasonDocument = {
      seasonId: `sea_${randomUUID()}`,
      title: input.title,
      mapId: input.mapId,
      entryFee: input.entryFee,
      prizePoolShare: input.prizePoolShare,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      createdAt: now,
      updatedAt: now
    };
    await this.collection.insertOne(document);
    return mapSeasonDocument(document, referenceNow);
  }

  async updateSeason(
    seasonId: string,
    patch: UpdateSeasonInput,
    referenceNow: Date
  ): Promise<Season | null> {
    const existing = await this.collection.findOne({ seasonId });
    if (!existing) {
      return null;
    }
    const nextStartsAt = patch.startsAt ?? existing.startsAt;
    const nextEndsAt = patch.endsAt ?? existing.endsAt;
    validateSeasonDateRange(nextStartsAt, nextEndsAt);
    if (patch.entryFee !== undefined && (!Number.isInteger(patch.entryFee) || patch.entryFee < 0)) {
      throw new Error("Season entryFee must be a non-negative integer.");
    }
    if (
      patch.prizePoolShare !== undefined &&
      (!Number.isFinite(patch.prizePoolShare) || patch.prizePoolShare < 0 || patch.prizePoolShare > 1)
    ) {
      throw new Error("Season prizePoolShare must be between 0 and 1.");
    }

    const update: Record<string, unknown> = { updatedAt: new Date() };
    if (patch.title !== undefined) update.title = patch.title;
    if (patch.mapId !== undefined) update.mapId = patch.mapId;
    if (patch.entryFee !== undefined) update.entryFee = patch.entryFee;
    if (patch.prizePoolShare !== undefined) update.prizePoolShare = patch.prizePoolShare;
    if (patch.startsAt !== undefined) update.startsAt = patch.startsAt;
    if (patch.endsAt !== undefined) update.endsAt = patch.endsAt;

    const document = await this.collection.findOneAndUpdate(
      { seasonId },
      { $set: update },
      { returnDocument: "after" }
    );
    return document ? mapSeasonDocument(document, referenceNow) : null;
  }
}

function mapSeasonDocument(
  document: WithId<MongoSeasonDocument> | MongoSeasonDocument,
  referenceNow: Date
): Season {
  const startsAt = document.startsAt;
  const endsAt = document.endsAt;
  return {
    seasonId: document.seasonId,
    title: document.title,
    mapId: document.mapId,
    entryFee: document.entryFee,
    prizePoolShare: document.prizePoolShare,
    startsAt,
    endsAt,
    status: computeSeasonStatus({ startsAt, endsAt }, referenceNow)
  };
}

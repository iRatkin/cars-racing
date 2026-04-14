import type { WithId } from "mongodb";

import {
  computeSeasonStatus,
  type Season
} from "../../modules/seasons/seasons-domain.js";
import type { SeasonsRepository } from "../../modules/seasons/seasons-repository.js";

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

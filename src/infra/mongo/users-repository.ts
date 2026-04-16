import type { Document, WithId } from "mongodb";

import type {
  AppUser,
  UpsertTelegramUserInput,
  UserUtmData,
  UsersRepository,
  UtmSourceCount
} from "../../modules/users/users-repository.js";

export interface MongoUserDocument {
  userId: string;
  telegramUserId: string;
  firstName?: string;
  lastName?: string;
  username?: string;
  languageCode?: string;
  isPremium?: boolean;
  photoUrl?: string;
  ownedCarIds: string[];
  selectedCarId?: string | null;
  garageRevision: number;
  raceCoinsBalance: number;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  utmTerm?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface UtmAggregateRow {
  utmSource: string;
  count: number;
}

export interface UsersCollection {
  findOne(filter: Record<string, unknown>): Promise<WithId<MongoUserDocument> | MongoUserDocument | null>;
  findOneAndUpdate(
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
    options: {
      includeResultMetadata: false;
      returnDocument: "after";
      upsert?: boolean;
    }
  ): Promise<WithId<MongoUserDocument> | MongoUserDocument | null>;
  updateOne(
    filter: Record<string, unknown>,
    update: Record<string, unknown>
  ): Promise<unknown>;
  countDocuments(filter: Record<string, unknown>): Promise<number>;
  aggregate<T extends Document>(pipeline: Document[]): { toArray(): Promise<T[]> };
  find(
    filter: Record<string, unknown>,
    options?: { sort?: Record<string, 1 | -1> }
  ): { toArray(): Promise<Array<WithId<MongoUserDocument> | MongoUserDocument>> };
}

export class MongoUsersRepository implements UsersRepository {
  constructor(private readonly collection: UsersCollection) {}

  async upsertTelegramUser(input: UpsertTelegramUserInput): Promise<AppUser> {
    const now = new Date();
    const document = await this.collection.findOneAndUpdate(
      { telegramUserId: input.telegramUserId },
      {
        $set: {
          firstName: input.firstName,
          lastName: input.lastName,
          username: input.username,
          languageCode: input.languageCode,
          isPremium: input.isPremium,
          photoUrl: input.photoUrl,
          updatedAt: now
        },
        $setOnInsert: {
          userId: buildUserId(input.telegramUserId),
          telegramUserId: input.telegramUserId,
          ownedCarIds: [],
          selectedCarId: null,
          garageRevision: 0,
          raceCoinsBalance: 0,
          createdAt: now
        }
      },
      {
        includeResultMetadata: false,
        returnDocument: "after",
        upsert: true
      }
    );

    if (!document) {
      throw new Error("Mongo did not return an upserted user document");
    }

    return mapUserDocument(document);
  }

  async getUserById(userId: string): Promise<AppUser | null> {
    const document = await this.collection.findOne({ userId });
    return document ? mapUserDocument(document) : null;
  }

  async addRaceCoins(userId: string, amount: number): Promise<AppUser> {
    if (!Number.isInteger(amount) || amount < 0) {
      throw new Error("addRaceCoins expects a non-negative integer amount");
    }
    const document = await this.collection.findOneAndUpdate(
      { userId },
      { $inc: { raceCoinsBalance: amount }, $set: { updatedAt: new Date() } },
      { includeResultMetadata: false, returnDocument: "after" }
    );
    if (!document) throw new Error("User not found for addRaceCoins");
    return mapUserDocument(document);
  }

  async spendRaceCoins(userId: string, amount: number): Promise<AppUser | null> {
    const document = await this.collection.findOneAndUpdate(
      { userId, raceCoinsBalance: { $gte: amount } },
      { $inc: { raceCoinsBalance: -amount }, $set: { updatedAt: new Date() } },
      { includeResultMetadata: false, returnDocument: "after" }
    );
    return document ? mapUserDocument(document) : null;
  }

  async addOwnedCar(userId: string, carId: string): Promise<AppUser | null> {
    const document = await this.collection.findOneAndUpdate(
      { userId },
      {
        $addToSet: { ownedCarIds: carId },
        $inc: { garageRevision: 1 },
        $set: { updatedAt: new Date() }
      },
      { includeResultMetadata: false, returnDocument: "after" }
    );
    return document ? mapUserDocument(document) : null;
  }

  async setUtmIfNotSet(telegramUserId: string, utm: UserUtmData): Promise<void> {
    const setFields: Record<string, string> = {
      utmSource: utm.utmSource,
      updatedAt: new Date().toISOString()
    };
    if (utm.utmMedium !== undefined) setFields.utmMedium = utm.utmMedium;
    if (utm.utmCampaign !== undefined) setFields.utmCampaign = utm.utmCampaign;
    if (utm.utmContent !== undefined) setFields.utmContent = utm.utmContent;
    if (utm.utmTerm !== undefined) setFields.utmTerm = utm.utmTerm;

    await this.collection.updateOne(
      { telegramUserId, utmSource: { $exists: false } },
      { $set: setFields }
    );
  }

  async getUserByTelegramId(telegramUserId: string): Promise<AppUser | null> {
    const document = await this.collection.findOne({ telegramUserId });
    return document ? mapUserDocument(document) : null;
  }

  async getUserByUsername(username: string): Promise<AppUser | null> {
    const document = await this.collection.findOne({ username });
    return document ? mapUserDocument(document) : null;
  }

  async setRaceCoinsBalance(userId: string, amount: number): Promise<AppUser> {
    if (!Number.isInteger(amount) || amount < 0) {
      throw new Error("setRaceCoinsBalance expects a non-negative integer amount");
    }
    const document = await this.collection.findOneAndUpdate(
      { userId },
      { $set: { raceCoinsBalance: amount, updatedAt: new Date() } },
      { includeResultMetadata: false, returnDocument: "after" }
    );
    if (!document) throw new Error("User not found for setRaceCoinsBalance");
    return mapUserDocument(document);
  }

  async getUserCount(): Promise<number> {
    return this.collection.countDocuments({});
  }

  async getAllUsers(): Promise<AppUser[]> {
    const documents = await this.collection
      .find({}, { sort: { createdAt: 1 } })
      .toArray();
    return documents.map(mapUserDocument);
  }

  async getTopUtmSources(limit: number): Promise<UtmSourceCount[]> {
    const safeLimit = Number.isInteger(limit) && limit > 0 ? limit : 10;
    const rows = await this.collection
      .aggregate<UtmAggregateRow>([
        {
          $group: {
            _id: { $ifNull: ["$utmSource", "direct"] },
            count: { $sum: 1 }
          }
        },
        {
          $project: {
            _id: 0,
            utmSource: "$_id",
            count: 1
          }
        },
        { $sort: { count: -1 } },
        { $limit: safeLimit }
      ])
      .toArray();
    return rows.map((row) => ({ utmSource: row.utmSource, count: row.count }));
  }
}

export function buildUserId(telegramUserId: string): string {
  return `usr_${telegramUserId}`;
}

export function mapUserDocument(document: WithId<MongoUserDocument> | MongoUserDocument): AppUser {
  return {
    userId: document.userId,
    telegramUserId: document.telegramUserId,
    firstName: document.firstName,
    lastName: document.lastName,
    username: document.username,
    languageCode: document.languageCode,
    isPremium: document.isPremium,
    photoUrl: document.photoUrl,
    ownedCarIds: [...(document.ownedCarIds ?? [])],
    selectedCarId: document.selectedCarId,
    garageRevision: document.garageRevision,
    raceCoinsBalance: document.raceCoinsBalance ?? 0,
    utm: document.utmSource
      ? {
          utmSource: document.utmSource,
          utmMedium: document.utmMedium,
          utmCampaign: document.utmCampaign,
          utmContent: document.utmContent,
          utmTerm: document.utmTerm
        }
      : undefined
  };
}

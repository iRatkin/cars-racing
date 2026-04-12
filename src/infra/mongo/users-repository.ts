import type { WithId } from "mongodb";

import type {
  AppUser,
  UpsertTelegramUserInput,
  UsersRepository
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
  createdAt?: Date;
  updatedAt?: Date;
}

export interface UsersCollection {
  findOne(filter: { userId: string }): Promise<WithId<MongoUserDocument> | MongoUserDocument | null>;
  findOneAndUpdate(
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
    options: {
      includeResultMetadata: false;
      returnDocument: "after";
      upsert?: boolean;
    }
  ): Promise<WithId<MongoUserDocument> | MongoUserDocument | null>;
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
}

export function buildUserId(telegramUserId: string): string {
  return `usr_${telegramUserId}`;
}

function mapUserDocument(document: WithId<MongoUserDocument> | MongoUserDocument): AppUser {
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
    raceCoinsBalance: document.raceCoinsBalance ?? 0
  };
}

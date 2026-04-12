import { describe, expect, it, vi } from "vitest";

import { MongoUsersRepository } from "../../../src/infra/mongo/users-repository.js";

describe("MongoUsersRepository", () => {
  it("upserts Telegram users and maps the saved document to AppUser", async () => {
    const savedDocument = {
      userId: "usr_123456789",
      telegramUserId: "123456789",
      firstName: "Ivan",
      username: "ivan_dev",
      ownedCarIds: [],
      selectedCarId: null,
      garageRevision: 0
    };
    const collection = {
      findOne: vi.fn(),
      findOneAndUpdate: vi.fn(async () => savedDocument)
    };
    const repository = new MongoUsersRepository(collection);

    const user = await repository.upsertTelegramUser({
      telegramUserId: "123456789",
      firstName: "Ivan",
      username: "ivan_dev"
    });

    expect(collection.findOneAndUpdate).toHaveBeenCalledWith(
      { telegramUserId: "123456789" },
      {
        $set: {
          firstName: "Ivan",
          lastName: undefined,
          username: "ivan_dev",
          languageCode: undefined,
          isPremium: undefined,
          photoUrl: undefined,
          updatedAt: expect.any(Date)
        },
        $setOnInsert: {
          userId: "usr_123456789",
          telegramUserId: "123456789",
          ownedCarIds: [],
          selectedCarId: null,
          garageRevision: 0,
          createdAt: expect.any(Date)
        }
      },
      {
        includeResultMetadata: false,
        returnDocument: "after",
        upsert: true
      }
    );
    expect(user).toEqual(savedDocument);
  });

  it("returns null when a user document does not exist", async () => {
    const collection = {
      findOne: vi.fn(async () => null),
      findOneAndUpdate: vi.fn()
    };
    const repository = new MongoUsersRepository(collection);

    await expect(repository.getUserById("usr_missing")).resolves.toBeNull();
    expect(collection.findOne).toHaveBeenCalledWith({ userId: "usr_missing" });
  });
});

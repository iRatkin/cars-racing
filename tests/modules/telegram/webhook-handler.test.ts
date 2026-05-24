import { describe, expect, test, vi } from "vitest";

import { createWebhookHandler } from "../../../src/modules/telegram/webhook-handler.js";
import type { PurchasesRepository } from "../../../src/modules/payments/purchases-repository.js";
import type { TelegramFetch } from "../../../src/modules/telegram/invoice-link.js";
import type { AppUser, UsersRepository } from "../../../src/modules/users/users-repository.js";

describe("telegram webhook handler", () => {
  test("sends the Mini App launch hint on /start", async () => {
    const sentBodies: unknown[] = [];
    const fetchImpl: TelegramFetch = vi.fn(async (_input, init) => {
      sentBodies.push(JSON.parse(init.body));
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, result: true })
      };
    });
    const usersRepository = createUsersRepositoryStub();
    const handler = createWebhookHandler({
      purchasesRepository: createPurchasesRepositoryStub(),
      usersRepository,
      telegramOptions: { botToken: "123:test", fetchImpl },
      miniAppUrl: "https://example.test/miniapp"
    });

    await handler({
      update_id: 1,
      message: {
        message_id: 10,
        from: {
          id: 42,
          first_name: "Ivan",
          username: "ivan"
        },
        chat: { id: 42 },
        text: "/start",
        entities: [{ type: "bot_command", offset: 0, length: 6 }]
      }
    });

    expect(usersRepository.upsertTelegramUser).toHaveBeenCalledWith({
      telegramUserId: "42",
      firstName: "Ivan",
      lastName: undefined,
      username: "ivan",
      languageCode: undefined,
      isPremium: undefined
    });
    expect(sentBodies).toEqual([
      {
        chat_id: 42,
        text: "↙️ Жми «Играть» и начинай заезд 🏁",
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [{ text: "↙️ нажми на кнопку, чтобы запустит игру", callback_data: "game_launch_hint" }]
          ]
        }
      }
    ]);
  });

  test("sends an explanation when the launch hint button is pressed", async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const fetchImpl: TelegramFetch = vi.fn(async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body) });
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, result: true })
      };
    });
    const handler = createWebhookHandler({
      purchasesRepository: createPurchasesRepositoryStub(),
      usersRepository: createUsersRepositoryStub(),
      telegramOptions: { botToken: "123:test", fetchImpl },
      miniAppUrl: "https://example.test/miniapp"
    });

    await handler({
      update_id: 2,
      callback_query: {
        id: "cb_1",
        from: { id: 42 },
        message: {
          message_id: 10,
          chat: { id: 42 }
        },
        data: "game_launch_hint"
      }
    });

    expect(calls).toEqual([
      {
        url: "https://api.telegram.org/bot123:test/answerCallbackQuery",
        body: {
          callback_query_id: "cb_1"
        }
      },
      {
        url: "https://api.telegram.org/bot123:test/sendMessage",
        body: {
          chat_id: 42,
          text: 'Игра запускается при нажатии кнопки "Play" в левом нижнем углу экрана',
          parse_mode: "HTML"
        }
      }
    ]);
  });
});

function createUsersRepositoryStub(): UsersRepository {
  const user: AppUser = {
    userId: "usr_42",
    telegramUserId: "42",
    firstName: "Ivan",
    username: "ivan",
    ownedCarIds: [],
    garageRevision: 0,
    raceCoinsBalance: 0
  };

  return {
    upsertTelegramUser: vi.fn(async () => user),
    setUtmIfNotSet: vi.fn(async () => undefined)
  } as unknown as UsersRepository;
}

function createPurchasesRepositoryStub(): PurchasesRepository {
  return {
    findByInvoicePayload: vi.fn(async () => null),
    updateStatus: vi.fn(async () => undefined),
    markGranted: vi.fn(async () => undefined)
  } as unknown as PurchasesRepository;
}

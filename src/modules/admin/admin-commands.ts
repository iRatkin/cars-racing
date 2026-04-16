import type { UsersRepository } from "../users/users-repository.js";
import type { CarsCatalogRepository } from "../cars-catalog/cars-catalog-repository.js";
import type { SeasonsRepository } from "../seasons/seasons-repository.js";
import type { PurchasesRepository } from "../payments/purchases-repository.js";
import {
  formatUserCard,
  formatCarCatalog,
  formatSeasonsList,
  formatStats
} from "./admin-format.js";
import {
  buildUserKeyboard,
  buildCarsCatalogKeyboard,
  buildSeasonsKeyboard,
  buildMainMenuKeyboard
} from "./admin-keyboards.js";
import { sendTelegramMessage, type TelegramInvoiceLinkClientOptions } from "../telegram/invoice-link.js";
import { findUserByQuery } from "./admin-user-lookup.js";

export interface AdminDeps {
  usersRepository: UsersRepository;
  carsCatalogRepository: CarsCatalogRepository;
  seasonsRepository: SeasonsRepository;
  purchasesRepository: PurchasesRepository;
  telegramOptions: TelegramInvoiceLinkClientOptions;
}

export async function handleUserCommand(
  deps: AdminDeps,
  chatId: number,
  query: string
): Promise<void> {
  if (!query.trim()) {
    await sendTelegramMessage(deps.telegramOptions, {
      chatId,
      text: "Usage: /user &lt;telegramUserId|username&gt;"
    });
    return;
  }
  const user = await findUserByQuery(deps.usersRepository, query);
  if (!user) {
    await sendTelegramMessage(deps.telegramOptions, {
      chatId,
      text: `❌ User not found: ${escapePlain(query)}`
    });
    return;
  }

  await sendTelegramMessage(deps.telegramOptions, {
    chatId,
    text: formatUserCard(user),
    replyMarkup: buildUserKeyboard(user.userId)
  });
}

export async function handleCarsCommand(deps: AdminDeps, chatId: number): Promise<void> {
  const cars = await deps.carsCatalogRepository.getAllCars();
  await sendTelegramMessage(deps.telegramOptions, {
    chatId,
    text: formatCarCatalog(cars),
    replyMarkup: buildCarsCatalogKeyboard(cars)
  });
}

export async function handleSeasonsCommand(deps: AdminDeps, chatId: number): Promise<void> {
  const seasons = await deps.seasonsRepository.getAllSeasons(new Date());
  await sendTelegramMessage(deps.telegramOptions, {
    chatId,
    text: formatSeasonsList(seasons),
    replyMarkup: buildSeasonsKeyboard(seasons)
  });
}

export async function handleStatsCommand(deps: AdminDeps, chatId: number): Promise<void> {
  const [userCount, utmStats, purchasesSummary] = await Promise.all([
    deps.usersRepository.getUserCount(),
    deps.usersRepository.getTopUtmSources(10),
    deps.purchasesRepository.getStatsSummary(new Date())
  ]);

  await sendTelegramMessage(deps.telegramOptions, {
    chatId,
    text: formatStats(userCount, utmStats, purchasesSummary)
  });
}

export async function handleStartCommand(deps: AdminDeps, chatId: number): Promise<void> {
  await sendTelegramMessage(deps.telegramOptions, {
    chatId,
    text: "🛠️ <b>Admin Bot</b>\n\nSelect a category:",
    replyMarkup: buildMainMenuKeyboard()
  });
}

function escapePlain(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

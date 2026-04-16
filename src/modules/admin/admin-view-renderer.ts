import { sendTelegramMessage, type TelegramInvoiceLinkClientOptions } from "../telegram/invoice-link.js";
import {
  formatUserCard,
  formatCarCatalog,
  formatCarDetail,
  formatSeasonsList,
  formatSeasonDetail,
  formatStats
} from "./admin-format.js";
import {
  buildMainReplyKeyboard,
  buildUsersMenuReplyKeyboard,
  buildUserReplyKeyboard,
  buildCarsReplyKeyboard,
  buildCarDetailReplyKeyboard,
  buildSeasonsReplyKeyboard,
  buildSeasonDetailReplyKeyboard,
  buildStatsReplyKeyboard,
  buildGiveCarReplyKeyboard,
  buildCarsInlineList,
  buildSeasonsInlineList,
  buildGiveCarInlineList
} from "./admin-keyboards.js";
import type { UsersRepository } from "../users/users-repository.js";
import type { CarsCatalogRepository } from "../cars-catalog/cars-catalog-repository.js";
import type { SeasonsRepository } from "../seasons/seasons-repository.js";
import type { PurchasesRepository } from "../payments/purchases-repository.js";
import type { AdminView } from "./admin-session.js";

export interface AdminRendererDeps {
  usersRepository: UsersRepository;
  carsCatalogRepository: CarsCatalogRepository;
  seasonsRepository: SeasonsRepository;
  purchasesRepository: PurchasesRepository;
  telegramOptions: TelegramInvoiceLinkClientOptions;
}

/**
 * Renders an `AdminView` into one or more Telegram messages with reply/inline keyboards.
 * Returns `false` when the view could not be rendered (entity not found) and the caller
 * should fall back to a parent view.
 */
export async function renderAdminView(
  deps: AdminRendererDeps,
  chatId: number,
  view: AdminView
): Promise<boolean> {
  switch (view.type) {
    case "main": {
      await sendTelegramMessage(deps.telegramOptions, {
        chatId,
        text: "🛠️ <b>Admin Bot</b>\n\nSelect a category:",
        replyMarkup: buildMainReplyKeyboard()
      });
      return true;
    }
    case "users_menu": {
      await sendTelegramMessage(deps.telegramOptions, {
        chatId,
        text: "👤 <b>Users Management</b>",
        replyMarkup: buildUsersMenuReplyKeyboard()
      });
      return true;
    }
    case "user": {
      const user = await deps.usersRepository.getUserById(view.userId);
      if (!user) {
        return false;
      }
      await sendTelegramMessage(deps.telegramOptions, {
        chatId,
        text: formatUserCard(user),
        replyMarkup: buildUserReplyKeyboard()
      });
      return true;
    }
    case "cars": {
      const cars = await deps.carsCatalogRepository.getAllCars();
      await sendTelegramMessage(deps.telegramOptions, {
        chatId,
        text: formatCarCatalog(cars),
        replyMarkup: buildCarsReplyKeyboard()
      });
      const inline = buildCarsInlineList(cars);
      if (inline) {
        await sendTelegramMessage(deps.telegramOptions, {
          chatId,
          text: "Tap a car to edit:",
          replyMarkup: inline
        });
      }
      return true;
    }
    case "car": {
      const car = await deps.carsCatalogRepository.getById(view.carId);
      if (!car) {
        return false;
      }
      await sendTelegramMessage(deps.telegramOptions, {
        chatId,
        text: formatCarDetail(car),
        replyMarkup: buildCarDetailReplyKeyboard(car.active)
      });
      return true;
    }
    case "seasons": {
      const seasons = await deps.seasonsRepository.getAllSeasons(new Date());
      await sendTelegramMessage(deps.telegramOptions, {
        chatId,
        text: formatSeasonsList(seasons),
        replyMarkup: buildSeasonsReplyKeyboard()
      });
      const inline = buildSeasonsInlineList(seasons);
      if (inline) {
        await sendTelegramMessage(deps.telegramOptions, {
          chatId,
          text: "Tap a season to edit:",
          replyMarkup: inline
        });
      }
      return true;
    }
    case "season": {
      const season = await deps.seasonsRepository.getSeasonById(view.seasonId, new Date());
      if (!season) {
        return false;
      }
      await sendTelegramMessage(deps.telegramOptions, {
        chatId,
        text: formatSeasonDetail(season),
        replyMarkup: buildSeasonDetailReplyKeyboard(season.status !== "finished")
      });
      return true;
    }
    case "stats": {
      const [userCount, utmStats, purchasesSummary] = await Promise.all([
        deps.usersRepository.getUserCount(),
        deps.usersRepository.getTopUtmSources(10),
        deps.purchasesRepository.getStatsSummary(new Date())
      ]);
      await sendTelegramMessage(deps.telegramOptions, {
        chatId,
        text: formatStats(userCount, utmStats, purchasesSummary),
        replyMarkup: buildStatsReplyKeyboard()
      });
      return true;
    }
    case "give_car": {
      const cars = await deps.carsCatalogRepository.getAllCars();
      await sendTelegramMessage(deps.telegramOptions, {
        chatId,
        text: "🚗 <b>Select a car to give:</b>",
        replyMarkup: buildGiveCarReplyKeyboard()
      });
      const inline = buildGiveCarInlineList(view.userId, cars);
      if (inline) {
        await sendTelegramMessage(deps.telegramOptions, {
          chatId,
          text: "Tap a car to grant:",
          replyMarkup: inline
        });
      }
      return true;
    }
    default: {
      return false;
    }
  }
}

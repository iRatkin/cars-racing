import type { AdminDeps } from "./admin-commands.js";
import {
  answerCallbackQuery,
  editMessageText
} from "../telegram/invoice-link.js";
import {
  formatUserCard,
  formatCarCatalog,
  formatCarDetail,
  formatSeasonsList,
  formatSeasonDetail,
  formatStats
} from "./admin-format.js";
import {
  buildUserKeyboard,
  buildCarsCatalogKeyboard,
  buildCarDetailKeyboard,
  buildSeasonsKeyboard,
  buildSeasonDetailKeyboard,
  buildGiveCarSelectionKeyboard,
  buildMainMenuKeyboard,
  buildUsersMenuKeyboard,
  buildConfirmFinishSeasonKeyboard,
  cancelInlineKeyboard
} from "./admin-keyboards.js";
import {
  ADMIN_PENDING_ACTION_TTL_MS,
  type AdminPendingActionType,
  type PendingAdminAction
} from "./admin-config.js";
import { computeSeasonStatus } from "../seasons/seasons-domain.js";

export interface HandleAdminCallbackParams {
  deps: AdminDeps;
  chatId: number;
  messageId: number;
  data: string;
  callbackQueryId: string;
  pendingActions: Map<string, PendingAdminAction>;
  adminId: string;
  logger?: AdminCallbackLogger;
}

export interface AdminCallbackLogger {
  warn(obj: Record<string, unknown>, msg: string): void;
}

export async function handleAdminCallback(params: HandleAdminCallbackParams): Promise<void> {
  const { deps, chatId, messageId, data, callbackQueryId, pendingActions, adminId, logger } =
    params;
  const [action, ...args] = data.split(":");

  if (action === "main_menu") {
    await answerCallbackQuery(deps.telegramOptions, callbackQueryId);
    await editMessageText(deps.telegramOptions, {
      chatId,
      messageId,
      text: "🛠️ <b>Admin Bot</b>\n\nSelect a category:",
      replyMarkup: buildMainMenuKeyboard()
    });
    return;
  }

  if (action === "menu_users") {
    await answerCallbackQuery(deps.telegramOptions, callbackQueryId);
    await editMessageText(deps.telegramOptions, {
      chatId,
      messageId,
      text: "👤 <b>Users Management</b>",
      replyMarkup: buildUsersMenuKeyboard()
    });
    return;
  }

  if (action === "menu_cars") {
    await answerCallbackQuery(deps.telegramOptions, callbackQueryId);
    const cars = await deps.carsCatalogRepository.getAllCars();
    await editMessageText(deps.telegramOptions, {
      chatId,
      messageId,
      text: formatCarCatalog(cars),
      replyMarkup: buildCarsCatalogKeyboard(cars)
    });
    return;
  }

  if (action === "menu_seasons") {
    await answerCallbackQuery(deps.telegramOptions, callbackQueryId);
    const seasons = await deps.seasonsRepository.getAllSeasons(new Date());
    await editMessageText(deps.telegramOptions, {
      chatId,
      messageId,
      text: formatSeasonsList(seasons),
      replyMarkup: buildSeasonsKeyboard(seasons)
    });
    return;
  }

  if (action === "menu_stats") {
    await answerCallbackQuery(deps.telegramOptions, callbackQueryId);
    const [userCount, utmStats, purchasesSummary] = await Promise.all([
      deps.usersRepository.getUserCount(),
      deps.usersRepository.getTopUtmSources(10),
      deps.purchasesRepository.getStatsSummary(new Date())
    ]);
    await editMessageText(deps.telegramOptions, {
      chatId,
      messageId,
      text: formatStats(userCount, utmStats, purchasesSummary),
      replyMarkup: { inline_keyboard: [[{ text: "« Back to Main Menu", callback_data: "main_menu" }]] }
    });
    return;
  }

  if (action === "finduser_prompt") {
    await answerCallbackQuery(deps.telegramOptions, callbackQueryId);
    setPending(pendingActions, adminId, "finduser", { messageId: String(messageId) });
    await editMessageText(deps.telegramOptions, {
      chatId,
      messageId,
      text: "🔍 <b>Find User</b>\n\nEnter Telegram ID or Username (with or without @):",
      replyMarkup: cancelInlineKeyboard("menu_users")
    });
    return;
  }

  if (action === "addcoins" || action === "subcoins") {
    await answerCallbackQuery(deps.telegramOptions, callbackQueryId);
    const [userId, amountStr] = args;
    if (!userId || !amountStr) {
      logger?.warn({ data }, "admin callback: malformed addcoins/subcoins args");
      return;
    }
    const amount = Number(amountStr);
    if (!Number.isInteger(amount) || amount <= 0) {
      logger?.warn({ data }, "admin callback: invalid numeric amount");
      return;
    }
    await applyCoinDelta({
      deps,
      chatId,
      messageId,
      userId,
      callbackQueryId,
      deltaSign: action === "addcoins" ? 1 : -1,
      amount
    });
    return;
  }

  if (action === "addcoins_prompt" || action === "subcoins_prompt") {
    await answerCallbackQuery(deps.telegramOptions, callbackQueryId);
    const [userId] = args;
    if (!userId) return;
    const pendingType: AdminPendingActionType =
      action === "addcoins_prompt" ? "addcoins" : "subtractcoins";
    setPending(pendingActions, adminId, pendingType, {
      userId,
      messageId: String(messageId)
    });
    const title = action === "addcoins_prompt" ? "Add RC" : "Subtract RC";
    await editMessageText(deps.telegramOptions, {
      chatId,
      messageId,
      text: `💰 <b>${title}</b>\n\nEnter a positive integer amount:`,
      replyMarkup: cancelInlineKeyboard(`user_back:${userId}`)
    });
    return;
  }

  if (action === "setbalance_prompt") {
    await answerCallbackQuery(deps.telegramOptions, callbackQueryId);
    const [userId] = args;
    if (!userId) return;
    setPending(pendingActions, adminId, "setbalance", {
      userId,
      messageId: String(messageId)
    });
    await editMessageText(deps.telegramOptions, {
      chatId,
      messageId,
      text: "💰 <b>Set Balance</b>\n\nEnter the new balance (non-negative integer):",
      replyMarkup: cancelInlineKeyboard(`user_back:${userId}`)
    });
    return;
  }

  if (action === "givecar_prompt") {
    await answerCallbackQuery(deps.telegramOptions, callbackQueryId);
    const [userId] = args;
    if (!userId) return;
    const cars = await deps.carsCatalogRepository.getAllCars();
    await editMessageText(deps.telegramOptions, {
      chatId,
      messageId,
      text: "🚗 <b>Select car to give:</b>",
      replyMarkup: buildGiveCarSelectionKeyboard(userId, cars)
    });
    return;
  }

  if (action === "givecar") {
    await answerCallbackQuery(deps.telegramOptions, callbackQueryId, "Car granted");
    const [userId, carId] = args;
    if (!userId || !carId) return;
    await deps.usersRepository.addOwnedCar(userId, carId);
    const updatedUser = await deps.usersRepository.getUserById(userId);
    if (updatedUser) {
      await editMessageText(deps.telegramOptions, {
        chatId,
        messageId,
        text: formatUserCard(updatedUser),
        replyMarkup: buildUserKeyboard(userId)
      });
    }
    return;
  }

  if (action === "user_back") {
    await answerCallbackQuery(deps.telegramOptions, callbackQueryId);
    const [userId] = args;
    if (!userId) return;
    pendingActions.delete(adminId);
    const user = await deps.usersRepository.getUserById(userId);
    if (user) {
      await editMessageText(deps.telegramOptions, {
        chatId,
        messageId,
        text: formatUserCard(user),
        replyMarkup: buildUserKeyboard(userId)
      });
    }
    return;
  }

  if (action === "editcar") {
    await answerCallbackQuery(deps.telegramOptions, callbackQueryId);
    const [carId] = args;
    if (!carId) return;
    const car = await deps.carsCatalogRepository.getById(carId);
    if (car) {
      await editMessageText(deps.telegramOptions, {
        chatId,
        messageId,
        text: formatCarDetail(car),
        replyMarkup: buildCarDetailKeyboard(carId, car.active)
      });
    }
    return;
  }

  if (action === "togglecar") {
    await answerCallbackQuery(deps.telegramOptions, callbackQueryId);
    const [carId] = args;
    if (!carId) return;
    const car = await deps.carsCatalogRepository.getById(carId);
    if (!car) return;
    const updated = await deps.carsCatalogRepository.setCarActive(carId, !car.active);
    if (updated) {
      await editMessageText(deps.telegramOptions, {
        chatId,
        messageId,
        text: formatCarDetail(updated),
        replyMarkup: buildCarDetailKeyboard(carId, updated.active)
      });
    }
    return;
  }

  if (action === "setprice_prompt") {
    await answerCallbackQuery(deps.telegramOptions, callbackQueryId);
    const [carId] = args;
    if (!carId) return;
    setPending(pendingActions, adminId, "setprice", { carId, messageId: String(messageId) });
    await editMessageText(deps.telegramOptions, {
      chatId,
      messageId,
      text: `✏️ <b>Set Price for ${escapeHtmlLocal(carId)}</b>\n\nEnter new price (non-negative integer, RC):`,
      replyMarkup: cancelInlineKeyboard(`editcar:${carId}`)
    });
    return;
  }

  if (action === "settitle_prompt") {
    await answerCallbackQuery(deps.telegramOptions, callbackQueryId);
    const [carId] = args;
    if (!carId) return;
    setPending(pendingActions, adminId, "settitle", { carId, messageId: String(messageId) });
    await editMessageText(deps.telegramOptions, {
      chatId,
      messageId,
      text: `✏️ <b>Set Title for ${escapeHtmlLocal(carId)}</b>\n\nEnter new title:`,
      replyMarkup: cancelInlineKeyboard(`editcar:${carId}`)
    });
    return;
  }

  if (action === "addcar_prompt") {
    await answerCallbackQuery(deps.telegramOptions, callbackQueryId);
    setPending(pendingActions, adminId, "addcar_carid", { messageId: String(messageId) });
    await editMessageText(deps.telegramOptions, {
      chatId,
      messageId,
      text: "🚗 <b>Add New Car</b>\n\nStep 1/4: Enter Car ID (e.g. <code>car10</code>):",
      replyMarkup: cancelInlineKeyboard("menu_cars")
    });
    return;
  }

  if (action === "addcar_purchasable") {
    await answerCallbackQuery(deps.telegramOptions, callbackQueryId);
    const [answer] = args;
    if (answer !== "yes" && answer !== "no") return;
    await finalizeAddCar({
      deps,
      chatId,
      messageId,
      pendingActions,
      adminId,
      isPurchasable: answer === "yes"
    });
    return;
  }

  if (action === "editseason") {
    await answerCallbackQuery(deps.telegramOptions, callbackQueryId);
    const [seasonId] = args;
    if (!seasonId) return;
    const season = await deps.seasonsRepository.getSeasonById(seasonId, new Date());
    if (season) {
      await editMessageText(deps.telegramOptions, {
        chatId,
        messageId,
        text: formatSeasonDetail(season),
        replyMarkup: buildSeasonDetailKeyboard(seasonId, season.status !== "finished")
      });
    }
    return;
  }

  if (
    action === "editseason_ends_prompt" ||
    action === "editseason_starts_prompt" ||
    action === "editseason_fee_prompt" ||
    action === "editseason_title_prompt" ||
    action === "editseason_mapid_prompt"
  ) {
    await answerCallbackQuery(deps.telegramOptions, callbackQueryId);
    const [seasonId] = args;
    if (!seasonId) return;
    const promptConfig = promptForEditSeason(action);
    setPending(pendingActions, adminId, promptConfig.pendingType, {
      seasonId,
      messageId: String(messageId)
    });
    await editMessageText(deps.telegramOptions, {
      chatId,
      messageId,
      text: promptConfig.text,
      replyMarkup: cancelInlineKeyboard(`editseason:${seasonId}`)
    });
    return;
  }

  if (action === "createseason_prompt") {
    await answerCallbackQuery(deps.telegramOptions, callbackQueryId);
    setPending(pendingActions, adminId, "createseason_title", { messageId: String(messageId) });
    await editMessageText(deps.telegramOptions, {
      chatId,
      messageId,
      text: "🏁 <b>Create Season</b>\n\nStep 1/6: Enter Title:",
      replyMarkup: cancelInlineKeyboard("menu_seasons")
    });
    return;
  }

  if (action === "createseason_confirm") {
    await answerCallbackQuery(deps.telegramOptions, callbackQueryId);
    const pending = pendingActions.get(adminId);
    if (!pending || pending.type !== "createseason_ends") {
      logger?.warn({ adminId }, "createseason_confirm without prepared pending state");
      return;
    }
    try {
      const season = await deps.seasonsRepository.createSeason(
        {
          title: pending.context.title,
          mapId: pending.context.mapId,
          entryFee: Number(pending.context.fee),
          prizePoolShare: Number(pending.context.prize),
          startsAt: new Date(pending.context.starts),
          endsAt: new Date(pending.context.ends)
        },
        new Date()
      );
      pendingActions.delete(adminId);
      await editMessageText(deps.telegramOptions, {
        chatId,
        messageId,
        text: `✅ Season created!\n\n${formatSeasonDetail(season)}`,
        replyMarkup: buildSeasonDetailKeyboard(season.seasonId, season.status !== "finished")
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await editMessageText(deps.telegramOptions, {
        chatId,
        messageId,
        text: `❌ Failed to create season: ${escapeHtmlLocal(message)}`,
        replyMarkup: cancelInlineKeyboard("menu_seasons")
      });
    }
    return;
  }

  if (action === "finishseason_confirm") {
    await answerCallbackQuery(deps.telegramOptions, callbackQueryId);
    const [seasonId] = args;
    if (!seasonId) return;
    await editMessageText(deps.telegramOptions, {
      chatId,
      messageId,
      text:
        "⚠️ <b>Finish Season Now?</b>\n\n" +
        "This will set <code>endsAt</code> to the current time. " +
        "The season will become <b>finished</b> immediately and cannot be resumed.",
      replyMarkup: buildConfirmFinishSeasonKeyboard(seasonId)
    });
    return;
  }

  if (action === "finishseason_apply") {
    await answerCallbackQuery(deps.telegramOptions, callbackQueryId, "Season finished");
    const [seasonId] = args;
    if (!seasonId) return;
    const now = new Date();
    const existing = await deps.seasonsRepository.getSeasonById(seasonId, now);
    if (!existing) return;
    const newStartsAt =
      existing.startsAt.getTime() >= now.getTime()
        ? new Date(now.getTime() - 1000)
        : existing.startsAt;
    const updated = await deps.seasonsRepository.updateSeason(
      seasonId,
      { endsAt: now, startsAt: newStartsAt },
      now
    );
    if (updated) {
      await editMessageText(deps.telegramOptions, {
        chatId,
        messageId,
        text: `✅ Season finished.\n\n${formatSeasonDetail(updated)}`,
        replyMarkup: buildSeasonDetailKeyboard(
          seasonId,
          computeSeasonStatus(updated, now) !== "finished"
        )
      });
    }
    return;
  }

  logger?.warn({ action, data }, "admin callback: unknown action");
  await answerCallbackQuery(deps.telegramOptions, callbackQueryId, "Action not found");
}

async function applyCoinDelta(params: {
  deps: AdminDeps;
  chatId: number;
  messageId: number;
  userId: string;
  callbackQueryId: string;
  deltaSign: 1 | -1;
  amount: number;
}): Promise<void> {
  const { deps, chatId, messageId, userId, deltaSign, amount } = params;
  try {
    if (deltaSign === 1) {
      await deps.usersRepository.addRaceCoins(userId, amount);
    } else {
      const result = await deps.usersRepository.spendRaceCoins(userId, amount);
      if (!result) {
        const user = await deps.usersRepository.getUserById(userId);
        if (user) {
          await editMessageText(deps.telegramOptions, {
            chatId,
            messageId,
            text:
              `❌ Insufficient balance to subtract ${amount} RC.\n\n` +
              formatUserCard(user),
            replyMarkup: buildUserKeyboard(userId)
          });
        }
        return;
      }
    }
    const updatedUser = await deps.usersRepository.getUserById(userId);
    if (updatedUser) {
      await editMessageText(deps.telegramOptions, {
        chatId,
        messageId,
        text: formatUserCard(updatedUser),
        replyMarkup: buildUserKeyboard(userId)
      });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await editMessageText(deps.telegramOptions, {
      chatId,
      messageId,
      text: `❌ ${escapeHtmlLocal(message)}`,
      replyMarkup: buildUserKeyboard(userId)
    });
  }
}

async function finalizeAddCar(params: {
  deps: AdminDeps;
  chatId: number;
  messageId: number;
  pendingActions: Map<string, PendingAdminAction>;
  adminId: string;
  isPurchasable: boolean;
}): Promise<void> {
  const { deps, chatId, messageId, pendingActions, adminId, isPurchasable } = params;
  const pending = pendingActions.get(adminId);
  if (!pending || pending.type !== "addcar_purchasable") {
    return;
  }
  const carId = pending.context.carId;
  const title = pending.context.title;
  const priceStr = pending.context.price;
  const priceAmount = Number(priceStr);
  if (!carId || !title || !Number.isInteger(priceAmount)) {
    return;
  }
  const existing = await deps.carsCatalogRepository.getById(carId);
  if (existing) {
    pendingActions.delete(adminId);
    await editMessageText(deps.telegramOptions, {
      chatId,
      messageId,
      text: `❌ Car with id <code>${escapeHtmlLocal(carId)}</code> already exists.`,
      replyMarkup: cancelInlineKeyboard("menu_cars")
    });
    return;
  }
  const nextSortOrder = (await deps.carsCatalogRepository.getMaxSortOrder()) + 1;
  const car = await deps.carsCatalogRepository.upsertCar({
    carId,
    title,
    sortOrder: nextSortOrder,
    active: true,
    isStarterDefault: false,
    isPurchasable,
    price: { currency: "RC", amount: priceAmount }
  });
  pendingActions.delete(adminId);
  await editMessageText(deps.telegramOptions, {
    chatId,
    messageId,
    text: `✅ Car created!\n\n${formatCarDetail(car)}`,
    replyMarkup: buildCarDetailKeyboard(car.carId, car.active)
  });
}

function promptForEditSeason(action: string): {
  pendingType: AdminPendingActionType;
  text: string;
} {
  switch (action) {
    case "editseason_ends_prompt":
      return {
        pendingType: "editseason_ends",
        text: "🏁 <b>Set End Date</b>\n\nEnter date (YYYY-MM-DD HH:MM UTC):"
      };
    case "editseason_starts_prompt":
      return {
        pendingType: "editseason_starts",
        text: "🏁 <b>Set Start Date</b>\n\nEnter date (YYYY-MM-DD HH:MM UTC):"
      };
    case "editseason_fee_prompt":
      return {
        pendingType: "editseason_fee",
        text: "🏁 <b>Set Entry Fee</b>\n\nEnter fee (non-negative integer, RC):"
      };
    case "editseason_title_prompt":
      return {
        pendingType: "editseason_title",
        text: "🏁 <b>Set Season Title</b>\n\nEnter title:"
      };
    case "editseason_mapid_prompt":
      return {
        pendingType: "editseason_mapid",
        text: "🏁 <b>Set Map ID</b>\n\nEnter mapId:"
      };
    default:
      throw new Error(`Unknown edit season prompt: ${action}`);
  }
}

function setPending(
  pendingActions: Map<string, PendingAdminAction>,
  adminId: string,
  type: AdminPendingActionType,
  context: Record<string, string>
): void {
  pendingActions.set(adminId, {
    type,
    context,
    expiresAt: Date.now() + ADMIN_PENDING_ACTION_TTL_MS
  });
}

function escapeHtmlLocal(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

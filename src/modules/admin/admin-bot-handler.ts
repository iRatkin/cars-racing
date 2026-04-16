import {
  handleUserCommand,
  handleCarsCommand,
  handleSeasonsCommand,
  handleStatsCommand,
  handleStartCommand,
  type AdminDeps
} from "./admin-commands.js";
import { handleAdminCallback, type AdminCallbackLogger } from "./admin-callbacks.js";
import { editMessageText, sendTelegramMessage } from "../telegram/invoice-link.js";
import {
  ADMIN_DEFAULT_PRIZE_POOL_SHARE,
  ADMIN_PENDING_ACTION_TTL_MS,
  type PendingAdminAction
} from "./admin-config.js";
import {
  formatUserCard,
  formatCarDetail,
  formatSeasonDetail
} from "./admin-format.js";
import {
  buildUserKeyboard,
  buildCarDetailKeyboard,
  buildSeasonDetailKeyboard,
  buildConfirmCreateSeasonKeyboard,
  buildAddCarPurchasableKeyboard,
  cancelInlineKeyboard
} from "./admin-keyboards.js";
import {
  extractAdminFromId,
  isAdminCallbackQueryUpdate,
  isAdminTextMessageUpdate,
  type AdminCallbackQueryUpdate,
  type AdminTextMessageUpdate
} from "./admin-webhook-domain.js";
import { findUserByQuery } from "./admin-user-lookup.js";
import {
  AdminInputError,
  escapeHtml,
  parseDateUtcStrict,
  parseNonNegativeIntegerStrict,
  parsePositiveIntegerStrict,
  parsePrizePoolShareStrict
} from "./admin-input.js";
import { computeSeasonStatus } from "../seasons/seasons-domain.js";

export interface AdminBotLogger extends AdminCallbackLogger {
  info(obj: Record<string, unknown>, msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
}

export interface CreateAdminBotHandlerDeps extends AdminDeps {
  allowedTelegramIds: string[];
  logger?: AdminBotLogger;
  pendingActionsSweepIntervalMs?: number;
}

export type AdminWebhookHandler = (update: unknown) => Promise<void>;

export function createAdminBotHandler(deps: CreateAdminBotHandlerDeps): AdminWebhookHandler {
  const pendingActions = new Map<string, PendingAdminAction>();
  const allowedIds = new Set(deps.allowedTelegramIds);
  const sweepInterval = deps.pendingActionsSweepIntervalMs ?? ADMIN_PENDING_ACTION_TTL_MS;

  if (sweepInterval > 0) {
    const timer = setInterval(() => sweepExpired(pendingActions), sweepInterval);
    if (typeof timer.unref === "function") {
      timer.unref();
    }
  }

  return async (update: unknown): Promise<void> => {
    if (isAdminCallbackQueryUpdate(update)) {
      await handleCallbackUpdate(update);
      return;
    }
    if (isAdminTextMessageUpdate(update)) {
      await handleTextUpdate(update);
      return;
    }
    deps.logger?.info({}, "admin webhook: unsupported update ignored");
  };

  async function handleCallbackUpdate(update: AdminCallbackQueryUpdate): Promise<void> {
    const fromId = extractAdminFromId(update);
    if (!fromId || !allowedIds.has(fromId)) {
      deps.logger?.warn({ fromId }, "admin webhook: unauthorized callback");
      return;
    }
    const { callback_query: cb } = update;
    await handleAdminCallback({
      deps,
      chatId: cb.message.chat.id,
      messageId: cb.message.message_id,
      data: cb.data,
      callbackQueryId: cb.id,
      pendingActions,
      adminId: fromId,
      logger: deps.logger
    });
  }

  async function handleTextUpdate(update: AdminTextMessageUpdate): Promise<void> {
    const fromId = extractAdminFromId(update);
    if (!fromId || !allowedIds.has(fromId)) {
      deps.logger?.warn({ fromId }, "admin webhook: unauthorized message");
      return;
    }
    const chatId = update.message.chat.id;
    const text = update.message.text;

    if (text.startsWith("/")) {
      pendingActions.delete(fromId);
      const [command, ...rest] = text.split(" ");
      await dispatchCommand(command, rest.join(" "), chatId);
      return;
    }

    const pending = pendingActions.get(fromId);
    if (!pending) {
      return;
    }
    if (pending.expiresAt < Date.now()) {
      pendingActions.delete(fromId);
      await sendTelegramMessage(deps.telegramOptions, {
        chatId,
        text: "❌ Action expired. Please try again."
      });
      return;
    }

    try {
      await handleConversationalStep({ chatId, text, pending, adminId: fromId });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await sendTelegramMessage(deps.telegramOptions, {
        chatId,
        text: `❌ ${escapeHtml(message)}`
      });
    }
  }

  async function dispatchCommand(command: string, argString: string, chatId: number): Promise<void> {
    if (command === "/start" || command === "/menu") {
      await handleStartCommand(deps, chatId);
      return;
    }
    if (command === "/user") {
      await handleUserCommand(deps, chatId, argString);
      return;
    }
    if (command === "/cars") {
      await handleCarsCommand(deps, chatId);
      return;
    }
    if (command === "/seasons") {
      await handleSeasonsCommand(deps, chatId);
      return;
    }
    if (command === "/stats") {
      await handleStatsCommand(deps, chatId);
      return;
    }
  }

  async function handleConversationalStep(params: {
    chatId: number;
    text: string;
    pending: PendingAdminAction;
    adminId: string;
  }): Promise<void> {
    const { chatId, text, pending, adminId } = params;
    const messageId = Number(pending.context.messageId);
    if (!Number.isInteger(messageId)) {
      throw new AdminInputError("Internal error: invalid pending state.");
    }

    if (pending.type === "finduser") {
      const user = await findUserByQuery(deps.usersRepository, text);
      if (!user) {
        throw new AdminInputError(`User not found: ${text.trim()}`);
      }
      pendingActions.delete(adminId);
      await editMessageText(deps.telegramOptions, {
        chatId,
        messageId,
        text: formatUserCard(user),
        replyMarkup: buildUserKeyboard(user.userId)
      });
      return;
    }

    if (pending.type === "addcoins") {
      const amount = parsePositiveIntegerStrict(text, "amount");
      const userId = pending.context.userId;
      if (!userId) return;
      await deps.usersRepository.addRaceCoins(userId, amount);
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

    if (pending.type === "subtractcoins") {
      const amount = parsePositiveIntegerStrict(text, "amount");
      const userId = pending.context.userId;
      if (!userId) return;
      const result = await deps.usersRepository.spendRaceCoins(userId, amount);
      pendingActions.delete(adminId);
      if (!result) {
        const user = await deps.usersRepository.getUserById(userId);
        const card = user ? `\n\n${formatUserCard(user)}` : "";
        await editMessageText(deps.telegramOptions, {
          chatId,
          messageId,
          text: `❌ Insufficient balance to subtract ${amount} RC.${card}`,
          replyMarkup: buildUserKeyboard(userId)
        });
        return;
      }
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

    if (pending.type === "setbalance") {
      const amount = parseNonNegativeIntegerStrict(text, "balance");
      const userId = pending.context.userId;
      if (!userId) return;
      await deps.usersRepository.setRaceCoinsBalance(userId, amount);
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

    if (pending.type === "setprice") {
      const amount = parseNonNegativeIntegerStrict(text, "price");
      const carId = pending.context.carId;
      if (!carId) return;
      const car = await deps.carsCatalogRepository.getById(carId);
      if (!car) {
        pendingActions.delete(adminId);
        throw new AdminInputError(`Car not found: ${carId}`);
      }
      const updated = await deps.carsCatalogRepository.upsertCar({
        ...car,
        price: { currency: "RC", amount }
      });
      pendingActions.delete(adminId);
      await editMessageText(deps.telegramOptions, {
        chatId,
        messageId,
        text: formatCarDetail(updated),
        replyMarkup: buildCarDetailKeyboard(updated.carId, updated.active)
      });
      return;
    }

    if (pending.type === "settitle") {
      const carId = pending.context.carId;
      if (!carId) return;
      const car = await deps.carsCatalogRepository.getById(carId);
      if (!car) {
        pendingActions.delete(adminId);
        throw new AdminInputError(`Car not found: ${carId}`);
      }
      const updated = await deps.carsCatalogRepository.upsertCar({
        ...car,
        title: text.trim()
      });
      pendingActions.delete(adminId);
      await editMessageText(deps.telegramOptions, {
        chatId,
        messageId,
        text: formatCarDetail(updated),
        replyMarkup: buildCarDetailKeyboard(updated.carId, updated.active)
      });
      return;
    }

    if (pending.type === "addcar_carid") {
      const carId = text.trim();
      if (!/^[a-zA-Z0-9_-]{1,32}$/.test(carId)) {
        throw new AdminInputError("Invalid carId. Use 1-32 chars: letters, digits, _ or -.");
      }
      const existing = await deps.carsCatalogRepository.getById(carId);
      if (existing) {
        throw new AdminInputError(`Car with id ${carId} already exists.`);
      }
      pending.context.carId = carId;
      pending.type = "addcar_title";
      await editMessageText(deps.telegramOptions, {
        chatId,
        messageId,
        text: `🚗 <b>Add New Car</b>\n\nID: <code>${escapeHtml(carId)}</code>\nStep 2/4: Enter Title:`,
        replyMarkup: cancelInlineKeyboard("menu_cars")
      });
      return;
    }

    if (pending.type === "addcar_title") {
      const title = text.trim();
      if (title.length === 0 || title.length > 100) {
        throw new AdminInputError("Invalid title. Use 1-100 characters.");
      }
      pending.context.title = title;
      pending.type = "addcar_price";
      await editMessageText(deps.telegramOptions, {
        chatId,
        messageId,
        text:
          `🚗 <b>Add New Car</b>\n\n` +
          `ID: <code>${escapeHtml(pending.context.carId ?? "")}</code>\n` +
          `Title: ${escapeHtml(title)}\n` +
          `Step 3/4: Enter Price (non-negative integer, RC):`,
        replyMarkup: cancelInlineKeyboard("menu_cars")
      });
      return;
    }

    if (pending.type === "addcar_price") {
      const price = parseNonNegativeIntegerStrict(text, "price");
      pending.context.price = String(price);
      pending.type = "addcar_purchasable";
      await editMessageText(deps.telegramOptions, {
        chatId,
        messageId,
        text:
          `🚗 <b>Add New Car</b>\n\n` +
          `ID: <code>${escapeHtml(pending.context.carId ?? "")}</code>\n` +
          `Title: ${escapeHtml(pending.context.title ?? "")}\n` +
          `Price: ${price} RC\n` +
          `Step 4/4: Is this car purchasable?`,
        replyMarkup: buildAddCarPurchasableKeyboard()
      });
      return;
    }

    if (pending.type === "editseason_ends" || pending.type === "editseason_starts") {
      const date = parseDateUtcStrict(
        text,
        pending.type === "editseason_ends" ? "end date" : "start date"
      );
      const seasonId = pending.context.seasonId;
      if (!seasonId) return;
      const now = new Date();
      const patch =
        pending.type === "editseason_ends" ? { endsAt: date } : { startsAt: date };
      const season = await deps.seasonsRepository.updateSeason(seasonId, patch, now);
      if (!season) {
        pendingActions.delete(adminId);
        throw new AdminInputError(`Season not found: ${seasonId}`);
      }
      pendingActions.delete(adminId);
      await editMessageText(deps.telegramOptions, {
        chatId,
        messageId,
        text: formatSeasonDetail(season),
        replyMarkup: buildSeasonDetailKeyboard(
          season.seasonId,
          computeSeasonStatus(season, now) !== "finished"
        )
      });
      return;
    }

    if (pending.type === "editseason_fee") {
      const fee = parseNonNegativeIntegerStrict(text, "fee");
      const seasonId = pending.context.seasonId;
      if (!seasonId) return;
      const now = new Date();
      const season = await deps.seasonsRepository.updateSeason(
        seasonId,
        { entryFee: fee },
        now
      );
      if (!season) {
        pendingActions.delete(adminId);
        throw new AdminInputError(`Season not found: ${seasonId}`);
      }
      pendingActions.delete(adminId);
      await editMessageText(deps.telegramOptions, {
        chatId,
        messageId,
        text: formatSeasonDetail(season),
        replyMarkup: buildSeasonDetailKeyboard(
          season.seasonId,
          computeSeasonStatus(season, now) !== "finished"
        )
      });
      return;
    }

    if (pending.type === "editseason_title" || pending.type === "editseason_mapid") {
      const value = text.trim();
      if (value.length === 0 || value.length > 100) {
        throw new AdminInputError("Value must be 1-100 characters long.");
      }
      const seasonId = pending.context.seasonId;
      if (!seasonId) return;
      const now = new Date();
      const patch =
        pending.type === "editseason_title" ? { title: value } : { mapId: value };
      const season = await deps.seasonsRepository.updateSeason(seasonId, patch, now);
      if (!season) {
        pendingActions.delete(adminId);
        throw new AdminInputError(`Season not found: ${seasonId}`);
      }
      pendingActions.delete(adminId);
      await editMessageText(deps.telegramOptions, {
        chatId,
        messageId,
        text: formatSeasonDetail(season),
        replyMarkup: buildSeasonDetailKeyboard(
          season.seasonId,
          computeSeasonStatus(season, now) !== "finished"
        )
      });
      return;
    }

    if (pending.type === "createseason_title") {
      const title = text.trim();
      if (title.length === 0 || title.length > 100) {
        throw new AdminInputError("Invalid title. Use 1-100 characters.");
      }
      pending.context.title = title;
      pending.type = "createseason_mapid";
      await editMessageText(deps.telegramOptions, {
        chatId,
        messageId,
        text:
          `🏁 <b>Create Season</b>\n\n` +
          `Title: ${escapeHtml(title)}\n` +
          `Step 2/6: Enter Map ID:`,
        replyMarkup: cancelInlineKeyboard("menu_seasons")
      });
      return;
    }

    if (pending.type === "createseason_mapid") {
      const mapId = text.trim();
      if (mapId.length === 0 || mapId.length > 100) {
        throw new AdminInputError("Invalid mapId. Use 1-100 characters.");
      }
      pending.context.mapId = mapId;
      pending.type = "createseason_fee";
      await editMessageText(deps.telegramOptions, {
        chatId,
        messageId,
        text:
          `🏁 <b>Create Season</b>\n\n` +
          `Title: ${escapeHtml(pending.context.title ?? "")}\n` +
          `Map: ${escapeHtml(mapId)}\n` +
          `Step 3/6: Enter Entry Fee (non-negative integer, RC):`,
        replyMarkup: cancelInlineKeyboard("menu_seasons")
      });
      return;
    }

    if (pending.type === "createseason_fee") {
      const fee = parseNonNegativeIntegerStrict(text, "fee");
      pending.context.fee = String(fee);
      pending.type = "createseason_prize";
      await editMessageText(deps.telegramOptions, {
        chatId,
        messageId,
        text:
          `🏁 <b>Create Season</b>\n\n` +
          `Title: ${escapeHtml(pending.context.title ?? "")}\n` +
          `Fee: ${fee} RC\n` +
          `Step 4/6: Enter Prize Pool Share (0..1, e.g. ${ADMIN_DEFAULT_PRIZE_POOL_SHARE}):`,
        replyMarkup: cancelInlineKeyboard("menu_seasons")
      });
      return;
    }

    if (pending.type === "createseason_prize") {
      const prize = parsePrizePoolShareStrict(text);
      pending.context.prize = String(prize);
      pending.type = "createseason_starts";
      await editMessageText(deps.telegramOptions, {
        chatId,
        messageId,
        text:
          `🏁 <b>Create Season</b>\n\n` +
          `Prize Share: ${prize}\n` +
          `Step 5/6: Enter Start Date (YYYY-MM-DD HH:MM UTC):`,
        replyMarkup: cancelInlineKeyboard("menu_seasons")
      });
      return;
    }

    if (pending.type === "createseason_starts") {
      const date = parseDateUtcStrict(text, "start date");
      pending.context.starts = date.toISOString();
      pending.type = "createseason_ends";
      await editMessageText(deps.telegramOptions, {
        chatId,
        messageId,
        text:
          `🏁 <b>Create Season</b>\n\n` +
          `Starts: ${escapeHtml(pending.context.starts)}\n` +
          `Step 6/6: Enter End Date (YYYY-MM-DD HH:MM UTC):`,
        replyMarkup: cancelInlineKeyboard("menu_seasons")
      });
      return;
    }

    if (pending.type === "createseason_ends") {
      const date = parseDateUtcStrict(text, "end date");
      const startsAt = new Date(pending.context.starts ?? "");
      if (date.getTime() <= startsAt.getTime()) {
        throw new AdminInputError("End date must be strictly after start date.");
      }
      pending.context.ends = date.toISOString();
      const summary =
        `🏁 <b>Confirm Season Creation</b>\n\n` +
        `Title: ${escapeHtml(pending.context.title ?? "")}\n` +
        `Map: ${escapeHtml(pending.context.mapId ?? "")}\n` +
        `Fee: ${pending.context.fee} RC\n` +
        `Prize Share: ${pending.context.prize}\n` +
        `Starts: ${escapeHtml(pending.context.starts)}\n` +
        `Ends: ${escapeHtml(pending.context.ends)}`;
      await editMessageText(deps.telegramOptions, {
        chatId,
        messageId,
        text: summary,
        replyMarkup: buildConfirmCreateSeasonKeyboard()
      });
      return;
    }

    if (pending.type === "addcar_purchasable") {
      await sendTelegramMessage(deps.telegramOptions, {
        chatId,
        text: "Please use the Yes/No buttons above."
      });
      return;
    }

    throw new AdminInputError("Unexpected pending action state.");
  }
}

function sweepExpired(pendingActions: Map<string, PendingAdminAction>): void {
  const now = Date.now();
  for (const [key, value] of pendingActions.entries()) {
    if (value.expiresAt < now) {
      pendingActions.delete(key);
    }
  }
}

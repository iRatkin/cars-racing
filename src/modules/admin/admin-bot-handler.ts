import {
  handleUserCommand,
  handleCarsCommand,
  handleSeasonsCommand,
  handleStatsCommand,
  handleStartCommand,
  type AdminCommandResult,
  type AdminDeps
} from "./admin-commands.js";
import { handleAdminCallback, type AdminCallbackLogger } from "./admin-callbacks.js";
import { sendTelegramDocument, sendTelegramMessage } from "../telegram/invoice-link.js";
import {
  ADMIN_USERS_EXPORT_MIME,
  buildUsersExportFileName,
  buildUsersExportWorkbook
} from "./admin-users-export.js";
import {
  ADMIN_DEFAULT_PRIZE_POOL_SHARE,
  ADMIN_PENDING_ACTION_TTL_MS,
  type AdminPendingActionType,
  type PendingAdminAction
} from "./admin-config.js";
import {
  ADMIN_SESSION_TTL_MS,
  sweepSessions,
  touchSessionExpiry,
  type AdminSession,
  type AdminView,
  type AdminViewBase
} from "./admin-session.js";
import { formatCarDetail, formatSeasonDetail } from "./admin-format.js";
import {
  ADMIN_BTN,
  buildAddCarPurchasableReplyKeyboard,
  buildCancelReplyKeyboard,
  buildCarDetailReplyKeyboard,
  buildConfirmCreateSeasonReplyKeyboard,
  buildConfirmFinishSeasonReplyKeyboard,
  buildSeasonDetailReplyKeyboard
} from "./admin-keyboards.js";
import { renderAdminView } from "./admin-view-renderer.js";
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

/**
 * Creates the admin webhook handler with reply-keyboard-based navigation.
 * Dynamic lists (cars, seasons, give-car picker) use inline keyboards; everything
 * else is driven by reply-keyboard button taps matched against the current session view.
 */
export function createAdminBotHandler(deps: CreateAdminBotHandlerDeps): AdminWebhookHandler {
  const sessions = new Map<string, AdminSession>();
  const allowedIds = new Set(deps.allowedTelegramIds);
  const sweepInterval = deps.pendingActionsSweepIntervalMs ?? ADMIN_SESSION_TTL_MS;

  if (sweepInterval > 0) {
    const timer = setInterval(() => sweepSessions(sessions), sweepInterval);
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
      data: cb.data,
      callbackQueryId: cb.id,
      sessions,
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
      await dispatchCommand(text, chatId, fromId);
      return;
    }

    try {
      await dispatchText({ chatId, text: text.trim(), rawText: text, adminId: fromId });
    } catch (err) {
      if (err instanceof AdminInputError) {
        await sendTelegramMessage(deps.telegramOptions, {
          chatId,
          text: `❌ ${escapeHtml(err.message)}`
        });
        return;
      }
      throw err;
    }
  }

  async function dispatchCommand(raw: string, chatId: number, adminId: string): Promise<void> {
    const [command, ...rest] = raw.split(" ");
    const argString = rest.join(" ");
    let result: AdminCommandResult | null = null;
    if (command === "/start" || command === "/menu") {
      result = await handleStartCommand(deps, chatId);
    } else if (command === "/user") {
      result = await handleUserCommand(deps, chatId, argString);
    } else if (command === "/cars") {
      result = await handleCarsCommand(deps, chatId);
    } else if (command === "/seasons") {
      result = await handleSeasonsCommand(deps, chatId);
    } else if (command === "/stats") {
      result = await handleStatsCommand(deps, chatId);
    }
    if (result) {
      setSession(adminId, result.view, null);
    }
  }

  async function dispatchText(params: {
    chatId: number;
    text: string;
    rawText: string;
    adminId: string;
  }): Promise<void> {
    const { chatId, text, rawText, adminId } = params;
    const session = sessions.get(adminId);
    if (!session) {
      return;
    }
    if (session.expiresAt < Date.now()) {
      sessions.delete(adminId);
      return;
    }

    if (session.view.type === "addcar_purchasable") {
      await handleAddCarPurchasableView(chatId, text, session, adminId);
      return;
    }
    if (session.view.type === "confirm_create_season") {
      await handleConfirmCreateSeasonView(chatId, text, session, adminId);
      return;
    }
    if (session.view.type === "confirm_finish_season") {
      await handleConfirmFinishSeasonView(chatId, text, session, adminId);
      return;
    }

    if (session.pending) {
      if (text === ADMIN_BTN.CANCEL) {
        await cancelWizard(chatId, session, adminId);
        return;
      }
      await handleWizardStep({ chatId, rawText, session, adminId });
      return;
    }

    await handleViewButton({ chatId, text, session, adminId });
  }

  async function handleViewButton(params: {
    chatId: number;
    text: string;
    session: AdminSession;
    adminId: string;
  }): Promise<void> {
    const { chatId, text, session, adminId } = params;
    const view = session.view;

    if (view.type === "main") {
      if (text === ADMIN_BTN.MAIN_USERS) {
        await navigate(chatId, adminId, { type: "users_menu" });
        return;
      }
      if (text === ADMIN_BTN.MAIN_CARS) {
        await navigate(chatId, adminId, { type: "cars" });
        return;
      }
      if (text === ADMIN_BTN.MAIN_SEASONS) {
        await navigate(chatId, adminId, { type: "seasons" });
        return;
      }
      if (text === ADMIN_BTN.MAIN_STATS) {
        await navigate(chatId, adminId, { type: "stats" });
        return;
      }
      return;
    }

    if (view.type === "users_menu") {
      if (text === ADMIN_BTN.USERS_FIND) {
        await startWizard({
          chatId,
          adminId,
          pendingType: "finduser",
          context: {},
          cancelTo: { type: "users_menu" },
          promptText: "🔍 <b>Find User</b>\n\nEnter Telegram ID or Username (with or without @):"
        });
        return;
      }
      if (text === ADMIN_BTN.USERS_EXPORT) {
        await exportUsersToExcel(chatId);
        return;
      }
      if (text === ADMIN_BTN.BACK) {
        await navigate(chatId, adminId, { type: "main" });
        return;
      }
      return;
    }

    if (view.type === "user") {
      const userId = view.userId;
      if (text === ADMIN_BTN.USER_ADD_100) {
        await applyCoinDelta(chatId, adminId, userId, 100, 1);
        return;
      }
      if (text === ADMIN_BTN.USER_ADD_500) {
        await applyCoinDelta(chatId, adminId, userId, 500, 1);
        return;
      }
      if (text === ADMIN_BTN.USER_SUB_100) {
        await applyCoinDelta(chatId, adminId, userId, 100, -1);
        return;
      }
      if (text === ADMIN_BTN.USER_SUB_500) {
        await applyCoinDelta(chatId, adminId, userId, 500, -1);
        return;
      }
      if (text === ADMIN_BTN.USER_ADD_CUSTOM) {
        await startWizard({
          chatId,
          adminId,
          pendingType: "addcoins",
          context: { userId },
          cancelTo: { type: "user", userId },
          promptText: "💰 <b>Add RC</b>\n\nEnter a positive integer amount:"
        });
        return;
      }
      if (text === ADMIN_BTN.USER_SUB_CUSTOM) {
        await startWizard({
          chatId,
          adminId,
          pendingType: "subtractcoins",
          context: { userId },
          cancelTo: { type: "user", userId },
          promptText: "💰 <b>Subtract RC</b>\n\nEnter a positive integer amount:"
        });
        return;
      }
      if (text === ADMIN_BTN.USER_SET_BALANCE) {
        await startWizard({
          chatId,
          adminId,
          pendingType: "setbalance",
          context: { userId },
          cancelTo: { type: "user", userId },
          promptText: "💰 <b>Set Balance</b>\n\nEnter the new balance (non-negative integer):"
        });
        return;
      }
      if (text === ADMIN_BTN.USER_GIVE_CAR) {
        await navigate(chatId, adminId, { type: "give_car", userId });
        return;
      }
      if (text === ADMIN_BTN.BACK) {
        await navigate(chatId, adminId, { type: "main" });
        return;
      }
      return;
    }

    if (view.type === "cars") {
      if (text === ADMIN_BTN.CARS_ADD) {
        await startWizard({
          chatId,
          adminId,
          pendingType: "addcar_carid",
          context: {},
          cancelTo: { type: "cars" },
          promptText: "🚗 <b>Add New Car</b>\n\nStep 1/4: Enter Car ID (e.g. <code>car10</code>):"
        });
        return;
      }
      if (text === ADMIN_BTN.BACK) {
        await navigate(chatId, adminId, { type: "main" });
        return;
      }
      return;
    }

    if (view.type === "car") {
      const carId = view.carId;
      if (text === ADMIN_BTN.CAR_ACTIVATE || text === ADMIN_BTN.CAR_DEACTIVATE) {
        const car = await deps.carsCatalogRepository.getById(carId);
        if (!car) {
          await navigate(chatId, adminId, { type: "cars" });
          return;
        }
        const updated = await deps.carsCatalogRepository.setCarActive(carId, !car.active);
        if (updated) {
          await sendTelegramMessage(deps.telegramOptions, {
            chatId,
            text: formatCarDetail(updated),
            replyMarkup: buildCarDetailReplyKeyboard(updated.active)
          });
        }
        return;
      }
      if (text === ADMIN_BTN.CAR_SET_PRICE) {
        await startWizard({
          chatId,
          adminId,
          pendingType: "setprice",
          context: { carId },
          cancelTo: { type: "car", carId },
          promptText: `✏️ <b>Set Price for ${escapeHtml(carId)}</b>\n\nEnter new price (non-negative integer, RC):`
        });
        return;
      }
      if (text === ADMIN_BTN.CAR_SET_TITLE) {
        await startWizard({
          chatId,
          adminId,
          pendingType: "settitle",
          context: { carId },
          cancelTo: { type: "car", carId },
          promptText: `✏️ <b>Set Title for ${escapeHtml(carId)}</b>\n\nEnter new title:`
        });
        return;
      }
      if (text === ADMIN_BTN.BACK) {
        await navigate(chatId, adminId, { type: "cars" });
        return;
      }
      return;
    }

    if (view.type === "give_car") {
      if (text === ADMIN_BTN.BACK) {
        await navigate(chatId, adminId, { type: "user", userId: view.userId });
        return;
      }
      return;
    }

    if (view.type === "seasons") {
      if (text === ADMIN_BTN.SEASONS_CREATE) {
        await startWizard({
          chatId,
          adminId,
          pendingType: "createseason_title",
          context: {},
          cancelTo: { type: "seasons" },
          promptText: "🏁 <b>Create Season</b>\n\nStep 1/6: Enter Title:"
        });
        return;
      }
      if (text === ADMIN_BTN.BACK) {
        await navigate(chatId, adminId, { type: "main" });
        return;
      }
      return;
    }

    if (view.type === "season") {
      const seasonId = view.seasonId;
      if (text === ADMIN_BTN.SEASON_EDIT_TITLE) {
        await startWizard({
          chatId,
          adminId,
          pendingType: "editseason_title",
          context: { seasonId },
          cancelTo: { type: "season", seasonId },
          promptText: "🏁 <b>Set Season Title</b>\n\nEnter title:"
        });
        return;
      }
      if (text === ADMIN_BTN.SEASON_EDIT_MAP) {
        await startWizard({
          chatId,
          adminId,
          pendingType: "editseason_mapid",
          context: { seasonId },
          cancelTo: { type: "season", seasonId },
          promptText: "🏁 <b>Set Map ID</b>\n\nEnter mapId:"
        });
        return;
      }
      if (text === ADMIN_BTN.SEASON_EDIT_STARTS) {
        await startWizard({
          chatId,
          adminId,
          pendingType: "editseason_starts",
          context: { seasonId },
          cancelTo: { type: "season", seasonId },
          promptText: "🏁 <b>Set Start Date</b>\n\nEnter date (YYYY-MM-DD HH:MM UTC):"
        });
        return;
      }
      if (text === ADMIN_BTN.SEASON_EDIT_ENDS) {
        await startWizard({
          chatId,
          adminId,
          pendingType: "editseason_ends",
          context: { seasonId },
          cancelTo: { type: "season", seasonId },
          promptText: "🏁 <b>Set End Date</b>\n\nEnter date (YYYY-MM-DD HH:MM UTC):"
        });
        return;
      }
      if (text === ADMIN_BTN.SEASON_EDIT_FEE) {
        await startWizard({
          chatId,
          adminId,
          pendingType: "editseason_fee",
          context: { seasonId },
          cancelTo: { type: "season", seasonId },
          promptText: "🏁 <b>Set Entry Fee</b>\n\nEnter fee (non-negative integer, RC):"
        });
        return;
      }
      if (text === ADMIN_BTN.SEASON_FINISH) {
        await sendTelegramMessage(deps.telegramOptions, {
          chatId,
          text:
            "⚠️ <b>Finish Season Now?</b>\n\n" +
            "This will set <code>endsAt</code> to the current time. " +
            "The season will become <b>finished</b> immediately and cannot be resumed.",
          replyMarkup: buildConfirmFinishSeasonReplyKeyboard()
        });
        setSession(adminId, { type: "confirm_finish_season", seasonId }, null);
        return;
      }
      if (text === ADMIN_BTN.BACK) {
        await navigate(chatId, adminId, { type: "seasons" });
        return;
      }
      return;
    }

    if (view.type === "stats") {
      if (text === ADMIN_BTN.BACK) {
        await navigate(chatId, adminId, { type: "main" });
        return;
      }
      return;
    }
  }

  async function handleWizardStep(params: {
    chatId: number;
    rawText: string;
    session: AdminSession;
    adminId: string;
  }): Promise<void> {
    const { chatId, rawText, session, adminId } = params;
    const pending = session.pending;
    if (!pending) {
      return;
    }

    if (pending.type === "finduser") {
      const user = await findUserByQuery(deps.usersRepository, rawText);
      if (!user) {
        throw new AdminInputError(`User not found: ${rawText.trim()}`);
      }
      await navigate(chatId, adminId, { type: "user", userId: user.userId });
      return;
    }

    if (pending.type === "addcoins") {
      const amount = parsePositiveIntegerStrict(rawText, "amount");
      const userId = requireContext(pending, "userId");
      await deps.usersRepository.addRaceCoins(userId, amount);
      await navigate(chatId, adminId, { type: "user", userId });
      return;
    }

    if (pending.type === "subtractcoins") {
      const amount = parsePositiveIntegerStrict(rawText, "amount");
      const userId = requireContext(pending, "userId");
      const result = await deps.usersRepository.spendRaceCoins(userId, amount);
      if (!result) {
        await sendTelegramMessage(deps.telegramOptions, {
          chatId,
          text: `❌ Insufficient balance to subtract ${amount} RC.`
        });
        await navigate(chatId, adminId, { type: "user", userId });
        return;
      }
      await navigate(chatId, adminId, { type: "user", userId });
      return;
    }

    if (pending.type === "setbalance") {
      const amount = parseNonNegativeIntegerStrict(rawText, "balance");
      const userId = requireContext(pending, "userId");
      await deps.usersRepository.setRaceCoinsBalance(userId, amount);
      await navigate(chatId, adminId, { type: "user", userId });
      return;
    }

    if (pending.type === "setprice") {
      const amount = parseNonNegativeIntegerStrict(rawText, "price");
      const carId = requireContext(pending, "carId");
      const car = await deps.carsCatalogRepository.getById(carId);
      if (!car) {
        throw new AdminInputError(`Car not found: ${carId}`);
      }
      const updated = await deps.carsCatalogRepository.upsertCar({
        ...car,
        price: { currency: "RC", amount }
      });
      await sendTelegramMessage(deps.telegramOptions, {
        chatId,
        text: formatCarDetail(updated),
        replyMarkup: buildCarDetailReplyKeyboard(updated.active)
      });
      setSession(adminId, { type: "car", carId }, null);
      return;
    }

    if (pending.type === "settitle") {
      const carId = requireContext(pending, "carId");
      const car = await deps.carsCatalogRepository.getById(carId);
      if (!car) {
        throw new AdminInputError(`Car not found: ${carId}`);
      }
      const updated = await deps.carsCatalogRepository.upsertCar({
        ...car,
        title: rawText.trim()
      });
      await sendTelegramMessage(deps.telegramOptions, {
        chatId,
        text: formatCarDetail(updated),
        replyMarkup: buildCarDetailReplyKeyboard(updated.active)
      });
      setSession(adminId, { type: "car", carId }, null);
      return;
    }

    if (pending.type === "addcar_carid") {
      const carId = rawText.trim();
      if (!/^[a-zA-Z0-9_-]{1,32}$/.test(carId)) {
        throw new AdminInputError("Invalid carId. Use 1-32 chars: letters, digits, _ or -.");
      }
      const existing = await deps.carsCatalogRepository.getById(carId);
      if (existing) {
        throw new AdminInputError(`Car with id ${carId} already exists.`);
      }
      pending.context.carId = carId;
      pending.type = "addcar_title";
      await sendTelegramMessage(deps.telegramOptions, {
        chatId,
        text: `🚗 <b>Add New Car</b>\n\nID: <code>${escapeHtml(carId)}</code>\nStep 2/4: Enter Title:`,
        replyMarkup: buildCancelReplyKeyboard()
      });
      return;
    }

    if (pending.type === "addcar_title") {
      const title = rawText.trim();
      if (title.length === 0 || title.length > 100) {
        throw new AdminInputError("Invalid title. Use 1-100 characters.");
      }
      pending.context.title = title;
      pending.type = "addcar_price";
      await sendTelegramMessage(deps.telegramOptions, {
        chatId,
        text:
          `🚗 <b>Add New Car</b>\n\n` +
          `ID: <code>${escapeHtml(pending.context.carId ?? "")}</code>\n` +
          `Title: ${escapeHtml(title)}\n` +
          `Step 3/4: Enter Price (non-negative integer, RC):`,
        replyMarkup: buildCancelReplyKeyboard()
      });
      return;
    }

    if (pending.type === "addcar_price") {
      const price = parseNonNegativeIntegerStrict(rawText, "price");
      pending.context.price = String(price);
      pending.type = "addcar_purchasable";
      setSession(adminId, { type: "addcar_purchasable" }, pending);
      await sendTelegramMessage(deps.telegramOptions, {
        chatId,
        text:
          `🚗 <b>Add New Car</b>\n\n` +
          `ID: <code>${escapeHtml(pending.context.carId ?? "")}</code>\n` +
          `Title: ${escapeHtml(pending.context.title ?? "")}\n` +
          `Price: ${price} RC\n` +
          `Step 4/4: Is this car purchasable?`,
        replyMarkup: buildAddCarPurchasableReplyKeyboard()
      });
      return;
    }

    if (
      pending.type === "editseason_ends" ||
      pending.type === "editseason_starts"
    ) {
      const date = parseDateUtcStrict(
        rawText,
        pending.type === "editseason_ends" ? "end date" : "start date"
      );
      const seasonId = requireContext(pending, "seasonId");
      const now = new Date();
      const patch =
        pending.type === "editseason_ends" ? { endsAt: date } : { startsAt: date };
      const season = await deps.seasonsRepository.updateSeason(seasonId, patch, now);
      if (!season) {
        throw new AdminInputError(`Season not found: ${seasonId}`);
      }
      await sendTelegramMessage(deps.telegramOptions, {
        chatId,
        text: formatSeasonDetail(season),
        replyMarkup: buildSeasonDetailReplyKeyboard(
          computeSeasonStatus(season, now) !== "finished"
        )
      });
      setSession(adminId, { type: "season", seasonId }, null);
      return;
    }

    if (pending.type === "editseason_fee") {
      const fee = parseNonNegativeIntegerStrict(rawText, "fee");
      const seasonId = requireContext(pending, "seasonId");
      const now = new Date();
      const season = await deps.seasonsRepository.updateSeason(
        seasonId,
        { entryFee: fee },
        now
      );
      if (!season) {
        throw new AdminInputError(`Season not found: ${seasonId}`);
      }
      await sendTelegramMessage(deps.telegramOptions, {
        chatId,
        text: formatSeasonDetail(season),
        replyMarkup: buildSeasonDetailReplyKeyboard(
          computeSeasonStatus(season, now) !== "finished"
        )
      });
      setSession(adminId, { type: "season", seasonId }, null);
      return;
    }

    if (pending.type === "editseason_title" || pending.type === "editseason_mapid") {
      const value = rawText.trim();
      if (value.length === 0 || value.length > 100) {
        throw new AdminInputError("Value must be 1-100 characters long.");
      }
      const seasonId = requireContext(pending, "seasonId");
      const now = new Date();
      const patch =
        pending.type === "editseason_title" ? { title: value } : { mapId: value };
      const season = await deps.seasonsRepository.updateSeason(seasonId, patch, now);
      if (!season) {
        throw new AdminInputError(`Season not found: ${seasonId}`);
      }
      await sendTelegramMessage(deps.telegramOptions, {
        chatId,
        text: formatSeasonDetail(season),
        replyMarkup: buildSeasonDetailReplyKeyboard(
          computeSeasonStatus(season, now) !== "finished"
        )
      });
      setSession(adminId, { type: "season", seasonId }, null);
      return;
    }

    if (pending.type === "createseason_title") {
      const title = rawText.trim();
      if (title.length === 0 || title.length > 100) {
        throw new AdminInputError("Invalid title. Use 1-100 characters.");
      }
      pending.context.title = title;
      pending.type = "createseason_mapid";
      await sendTelegramMessage(deps.telegramOptions, {
        chatId,
        text: `🏁 <b>Create Season</b>\n\nTitle: ${escapeHtml(title)}\nStep 2/6: Enter Map ID:`,
        replyMarkup: buildCancelReplyKeyboard()
      });
      return;
    }

    if (pending.type === "createseason_mapid") {
      const mapId = rawText.trim();
      if (mapId.length === 0 || mapId.length > 100) {
        throw new AdminInputError("Invalid mapId. Use 1-100 characters.");
      }
      pending.context.mapId = mapId;
      pending.type = "createseason_fee";
      await sendTelegramMessage(deps.telegramOptions, {
        chatId,
        text:
          `🏁 <b>Create Season</b>\n\n` +
          `Title: ${escapeHtml(pending.context.title ?? "")}\n` +
          `Map: ${escapeHtml(mapId)}\n` +
          `Step 3/6: Enter Entry Fee (non-negative integer, RC):`,
        replyMarkup: buildCancelReplyKeyboard()
      });
      return;
    }

    if (pending.type === "createseason_fee") {
      const fee = parseNonNegativeIntegerStrict(rawText, "fee");
      pending.context.fee = String(fee);
      pending.type = "createseason_prize";
      await sendTelegramMessage(deps.telegramOptions, {
        chatId,
        text:
          `🏁 <b>Create Season</b>\n\n` +
          `Title: ${escapeHtml(pending.context.title ?? "")}\n` +
          `Fee: ${fee} RC\n` +
          `Step 4/6: Enter Prize Pool Share (0..1, e.g. ${ADMIN_DEFAULT_PRIZE_POOL_SHARE}):`,
        replyMarkup: buildCancelReplyKeyboard()
      });
      return;
    }

    if (pending.type === "createseason_prize") {
      const prize = parsePrizePoolShareStrict(rawText);
      pending.context.prize = String(prize);
      pending.type = "createseason_starts";
      await sendTelegramMessage(deps.telegramOptions, {
        chatId,
        text:
          `🏁 <b>Create Season</b>\n\n` +
          `Prize Share: ${prize}\n` +
          `Step 5/6: Enter Start Date (YYYY-MM-DD HH:MM UTC):`,
        replyMarkup: buildCancelReplyKeyboard()
      });
      return;
    }

    if (pending.type === "createseason_starts") {
      const date = parseDateUtcStrict(rawText, "start date");
      pending.context.starts = date.toISOString();
      pending.type = "createseason_ends";
      await sendTelegramMessage(deps.telegramOptions, {
        chatId,
        text:
          `🏁 <b>Create Season</b>\n\n` +
          `Starts: ${escapeHtml(pending.context.starts)}\n` +
          `Step 6/6: Enter End Date (YYYY-MM-DD HH:MM UTC):`,
        replyMarkup: buildCancelReplyKeyboard()
      });
      return;
    }

    if (pending.type === "createseason_ends") {
      const date = parseDateUtcStrict(rawText, "end date");
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
      setSession(adminId, { type: "confirm_create_season" }, pending);
      await sendTelegramMessage(deps.telegramOptions, {
        chatId,
        text: summary,
        replyMarkup: buildConfirmCreateSeasonReplyKeyboard()
      });
      return;
    }

    throw new AdminInputError("Unexpected pending action state.");
  }

  async function handleAddCarPurchasableView(
    chatId: number,
    text: string,
    session: AdminSession,
    adminId: string
  ): Promise<void> {
    if (text === ADMIN_BTN.CANCEL) {
      await cancelWizard(chatId, session, adminId);
      return;
    }
    if (text !== ADMIN_BTN.PURCHASABLE_YES && text !== ADMIN_BTN.PURCHASABLE_NO) {
      await sendTelegramMessage(deps.telegramOptions, {
        chatId,
        text: "Please tap Yes or No."
      });
      return;
    }
    const pending = session.pending;
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
      await sendTelegramMessage(deps.telegramOptions, {
        chatId,
        text: `❌ Car with id <code>${escapeHtml(carId)}</code> already exists.`
      });
      await navigate(chatId, adminId, { type: "cars" });
      return;
    }
    const nextSortOrder = (await deps.carsCatalogRepository.getMaxSortOrder()) + 1;
    const car = await deps.carsCatalogRepository.upsertCar({
      carId,
      title,
      sortOrder: nextSortOrder,
      active: true,
      isStarterDefault: false,
      isPurchasable: text === ADMIN_BTN.PURCHASABLE_YES,
      price: { currency: "RC", amount: priceAmount }
    });
    await sendTelegramMessage(deps.telegramOptions, {
      chatId,
      text: `✅ Car created!\n\n${formatCarDetail(car)}`,
      replyMarkup: buildCarDetailReplyKeyboard(car.active)
    });
    setSession(adminId, { type: "car", carId: car.carId }, null);
  }

  async function handleConfirmCreateSeasonView(
    chatId: number,
    text: string,
    session: AdminSession,
    adminId: string
  ): Promise<void> {
    if (text === ADMIN_BTN.CANCEL) {
      sessions.delete(adminId);
      await navigate(chatId, adminId, { type: "seasons" });
      return;
    }
    if (text !== ADMIN_BTN.CONFIRM_CREATE) {
      return;
    }
    const pending = session.pending;
    if (!pending || pending.type !== "createseason_ends") {
      return;
    }
    try {
      const now = new Date();
      const season = await deps.seasonsRepository.createSeason(
        {
          title: pending.context.title ?? "",
          mapId: pending.context.mapId ?? "",
          entryFee: Number(pending.context.fee),
          prizePoolShare: Number(pending.context.prize),
          startsAt: new Date(pending.context.starts ?? ""),
          endsAt: new Date(pending.context.ends ?? "")
        },
        now
      );
      await sendTelegramMessage(deps.telegramOptions, {
        chatId,
        text: `✅ Season created!\n\n${formatSeasonDetail(season)}`,
        replyMarkup: buildSeasonDetailReplyKeyboard(
          computeSeasonStatus(season, now) !== "finished"
        )
      });
      setSession(adminId, { type: "season", seasonId: season.seasonId }, null);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await sendTelegramMessage(deps.telegramOptions, {
        chatId,
        text: `❌ Failed to create season: ${escapeHtml(message)}`
      });
      await navigate(chatId, adminId, { type: "seasons" });
    }
  }

  async function handleConfirmFinishSeasonView(
    chatId: number,
    text: string,
    session: AdminSession,
    adminId: string
  ): Promise<void> {
    const view = session.view;
    if (view.type !== "confirm_finish_season") {
      return;
    }
    const seasonId = view.seasonId;
    if (text === ADMIN_BTN.CANCEL) {
      await navigate(chatId, adminId, { type: "season", seasonId });
      return;
    }
    if (text !== ADMIN_BTN.CONFIRM_FINISH) {
      return;
    }
    const now = new Date();
    const existing = await deps.seasonsRepository.getSeasonById(seasonId, now);
    if (!existing) {
      await navigate(chatId, adminId, { type: "seasons" });
      return;
    }
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
      await sendTelegramMessage(deps.telegramOptions, {
        chatId,
        text: `✅ Season finished.\n\n${formatSeasonDetail(updated)}`,
        replyMarkup: buildSeasonDetailReplyKeyboard(
          computeSeasonStatus(updated, now) !== "finished"
        )
      });
      setSession(adminId, { type: "season", seasonId }, null);
    }
  }

  async function exportUsersToExcel(chatId: number): Promise<void> {
    try {
      const users = await deps.usersRepository.getAllUsers();
      const buffer = await buildUsersExportWorkbook(users);
      const fileName = buildUsersExportFileName(new Date());
      await sendTelegramDocument(
        { botToken: deps.telegramOptions.botToken },
        {
          chatId,
          fileName,
          fileBuffer: buffer,
          mimeType: ADMIN_USERS_EXPORT_MIME,
          caption: `📥 Users export (${users.length} rows)`
        }
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      deps.logger?.warn({ err: message }, "admin: users export failed");
      await sendTelegramMessage(deps.telegramOptions, {
        chatId,
        text: `❌ Export failed: ${escapeHtml(message)}`
      });
    }
  }

  async function applyCoinDelta(
    chatId: number,
    adminId: string,
    userId: string,
    amount: number,
    sign: 1 | -1
  ): Promise<void> {
    try {
      if (sign === 1) {
        await deps.usersRepository.addRaceCoins(userId, amount);
      } else {
        const result = await deps.usersRepository.spendRaceCoins(userId, amount);
        if (!result) {
          await sendTelegramMessage(deps.telegramOptions, {
            chatId,
            text: `❌ Insufficient balance to subtract ${amount} RC.`
          });
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await sendTelegramMessage(deps.telegramOptions, {
        chatId,
        text: `❌ ${escapeHtml(message)}`
      });
    }
    await navigate(chatId, adminId, { type: "user", userId });
  }

  async function startWizard(params: {
    chatId: number;
    adminId: string;
    pendingType: AdminPendingActionType;
    context: Record<string, string>;
    cancelTo: AdminViewBase;
    promptText: string;
  }): Promise<void> {
    const { chatId, adminId, pendingType, context, cancelTo, promptText } = params;
    const pending: PendingAdminAction = {
      type: pendingType,
      context: { ...context },
      expiresAt: Date.now() + ADMIN_PENDING_ACTION_TTL_MS
    };
    setSession(adminId, { type: "wizard", cancelTo }, pending);
    await sendTelegramMessage(deps.telegramOptions, {
      chatId,
      text: promptText,
      replyMarkup: buildCancelReplyKeyboard()
    });
  }

  async function cancelWizard(
    chatId: number,
    session: AdminSession,
    adminId: string
  ): Promise<void> {
    const target =
      session.view.type === "wizard"
        ? session.view.cancelTo
        : session.view.type === "addcar_purchasable"
          ? ({ type: "cars" } as AdminViewBase)
          : session.view.type === "confirm_create_season"
            ? ({ type: "seasons" } as AdminViewBase)
            : session.view.type === "confirm_finish_season"
              ? ({ type: "season", seasonId: session.view.seasonId } as AdminViewBase)
              : ({ type: "main" } as AdminViewBase);
    sessions.delete(adminId);
    await navigate(chatId, adminId, target);
  }

  async function navigate(chatId: number, adminId: string, view: AdminView): Promise<void> {
    const rendered = await renderAdminView(deps, chatId, view);
    if (rendered) {
      setSession(adminId, view, null);
    }
  }

  function setSession(
    adminId: string,
    view: AdminView,
    pending: PendingAdminAction | null
  ): void {
    sessions.set(adminId, {
      view,
      pending,
      expiresAt: touchSessionExpiry()
    });
  }

  function requireContext(pending: PendingAdminAction, key: string): string {
    const value = pending.context[key];
    if (!value) {
      throw new AdminInputError("Internal error: missing context.");
    }
    return value;
  }
}

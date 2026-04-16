import type {
  TelegramInlineKeyboardButton,
  TelegramInlineKeyboardMarkup,
  TelegramReplyKeyboardButton,
  TelegramReplyKeyboardMarkup
} from "../telegram/invoice-link.js";
import type { CatalogCar } from "../cars-catalog/cars-catalog-repository.js";
import type { Season } from "../seasons/seasons-domain.js";

export const ADMIN_BTN = {
  MAIN_USERS: "👤 Users",
  MAIN_CARS: "🚗 Cars",
  MAIN_SEASONS: "🏁 Seasons",
  MAIN_STATS: "📊 Stats",
  BACK: "« Back",
  CANCEL: "❌ Cancel",
  USERS_FIND: "🔍 Find User",
  USERS_EXPORT: "📥 Export Users",
  USERS_TODAY_UTM: "📈 Today UTM",
  USER_ADD_100: "➕ 100 RC",
  USER_ADD_500: "➕ 500 RC",
  USER_ADD_CUSTOM: "➕ Custom RC",
  USER_SUB_100: "➖ 100 RC",
  USER_SUB_500: "➖ 500 RC",
  USER_SUB_CUSTOM: "➖ Custom RC",
  USER_GIVE_CAR: "🚗 Give Car",
  USER_SET_BALANCE: "💰 Set Balance",
  CARS_ADD: "➕ Add Car",
  CAR_ACTIVATE: "🟢 Activate",
  CAR_DEACTIVATE: "🔴 Deactivate",
  CAR_SET_PRICE: "✏️ Set Price",
  CAR_SET_TITLE: "✏️ Set Title",
  SEASONS_CREATE: "➕ Create Season",
  SEASON_EDIT_TITLE: "✏️ Title",
  SEASON_EDIT_MAP: "✏️ Map",
  SEASON_EDIT_STARTS: "✏️ Starts",
  SEASON_EDIT_ENDS: "✏️ Ends",
  SEASON_EDIT_FEE: "✏️ Entry Fee",
  SEASON_FINISH: "🏁 Finish Now",
  CONFIRM_CREATE: "✅ Create",
  CONFIRM_FINISH: "✅ Finish Now",
  PURCHASABLE_YES: "✅ Yes",
  PURCHASABLE_NO: "❌ No"
} as const;

type ReplyRow = TelegramReplyKeyboardButton[];

export function buildMainReplyKeyboard(): TelegramReplyKeyboardMarkup {
  return replyKeyboard([
    [ADMIN_BTN.MAIN_USERS, ADMIN_BTN.MAIN_CARS],
    [ADMIN_BTN.MAIN_SEASONS, ADMIN_BTN.MAIN_STATS]
  ]);
}

export function buildUsersMenuReplyKeyboard(): TelegramReplyKeyboardMarkup {
  return replyKeyboard([
    [ADMIN_BTN.USERS_FIND],
    [ADMIN_BTN.USERS_EXPORT, ADMIN_BTN.USERS_TODAY_UTM],
    [ADMIN_BTN.BACK]
  ]);
}

export function buildUserReplyKeyboard(): TelegramReplyKeyboardMarkup {
  return replyKeyboard([
    [ADMIN_BTN.USER_ADD_100, ADMIN_BTN.USER_ADD_500, ADMIN_BTN.USER_ADD_CUSTOM],
    [ADMIN_BTN.USER_SUB_100, ADMIN_BTN.USER_SUB_500, ADMIN_BTN.USER_SUB_CUSTOM],
    [ADMIN_BTN.USER_GIVE_CAR, ADMIN_BTN.USER_SET_BALANCE],
    [ADMIN_BTN.BACK]
  ]);
}

export function buildCarsReplyKeyboard(): TelegramReplyKeyboardMarkup {
  return replyKeyboard([[ADMIN_BTN.CARS_ADD], [ADMIN_BTN.BACK]]);
}

export function buildCarDetailReplyKeyboard(isActive: boolean): TelegramReplyKeyboardMarkup {
  const toggle = isActive ? ADMIN_BTN.CAR_DEACTIVATE : ADMIN_BTN.CAR_ACTIVATE;
  return replyKeyboard([
    [toggle, ADMIN_BTN.CAR_SET_PRICE, ADMIN_BTN.CAR_SET_TITLE],
    [ADMIN_BTN.BACK]
  ]);
}

export function buildSeasonsReplyKeyboard(): TelegramReplyKeyboardMarkup {
  return replyKeyboard([[ADMIN_BTN.SEASONS_CREATE], [ADMIN_BTN.BACK]]);
}

export function buildSeasonDetailReplyKeyboard(canFinishNow: boolean): TelegramReplyKeyboardMarkup {
  const rows: ReplyRow[] = [
    [btn(ADMIN_BTN.SEASON_EDIT_TITLE), btn(ADMIN_BTN.SEASON_EDIT_MAP)],
    [btn(ADMIN_BTN.SEASON_EDIT_STARTS), btn(ADMIN_BTN.SEASON_EDIT_ENDS)],
    [btn(ADMIN_BTN.SEASON_EDIT_FEE)]
  ];
  if (canFinishNow) {
    rows.push([btn(ADMIN_BTN.SEASON_FINISH)]);
  }
  rows.push([btn(ADMIN_BTN.BACK)]);
  return {
    keyboard: rows,
    resize_keyboard: true,
    is_persistent: true
  };
}

export function buildStatsReplyKeyboard(): TelegramReplyKeyboardMarkup {
  return replyKeyboard([[ADMIN_BTN.BACK]]);
}

export function buildCancelReplyKeyboard(): TelegramReplyKeyboardMarkup {
  return replyKeyboard([[ADMIN_BTN.CANCEL]]);
}

export function buildGiveCarReplyKeyboard(): TelegramReplyKeyboardMarkup {
  return replyKeyboard([[ADMIN_BTN.BACK]]);
}

export function buildAddCarPurchasableReplyKeyboard(): TelegramReplyKeyboardMarkup {
  return replyKeyboard([
    [ADMIN_BTN.PURCHASABLE_YES, ADMIN_BTN.PURCHASABLE_NO],
    [ADMIN_BTN.CANCEL]
  ]);
}

export function buildConfirmCreateSeasonReplyKeyboard(): TelegramReplyKeyboardMarkup {
  return replyKeyboard([[ADMIN_BTN.CONFIRM_CREATE], [ADMIN_BTN.CANCEL]]);
}

export function buildConfirmFinishSeasonReplyKeyboard(): TelegramReplyKeyboardMarkup {
  return replyKeyboard([[ADMIN_BTN.CONFIRM_FINISH], [ADMIN_BTN.CANCEL]]);
}

export function buildCarsInlineList(cars: CatalogCar[]): TelegramInlineKeyboardMarkup | null {
  if (cars.length === 0) {
    return null;
  }
  const buttons: TelegramInlineKeyboardButton[] = cars.map((car) => ({
    text: `✏️ ${car.carId}`,
    callback_data: `editcar:${car.carId}`
  }));
  return { inline_keyboard: chunkInPairs(buttons) };
}

export function buildSeasonsInlineList(seasons: Season[]): TelegramInlineKeyboardMarkup | null {
  if (seasons.length === 0) {
    return null;
  }
  const buttons: TelegramInlineKeyboardButton[] = seasons.map((s) => ({
    text: `✏️ ${s.title}`,
    callback_data: `editseason:${s.seasonId}`
  }));
  return { inline_keyboard: chunkInPairs(buttons) };
}

export function buildGiveCarInlineList(
  userId: string,
  cars: CatalogCar[]
): TelegramInlineKeyboardMarkup | null {
  if (cars.length === 0) {
    return null;
  }
  const buttons: TelegramInlineKeyboardButton[] = cars.map((car) => ({
    text: car.title,
    callback_data: `givecar:${userId}:${car.carId}`
  }));
  return { inline_keyboard: chunkInPairs(buttons) };
}

function replyKeyboard(rows: string[][]): TelegramReplyKeyboardMarkup {
  return {
    keyboard: rows.map((row) => row.map(btn)),
    resize_keyboard: true,
    is_persistent: true
  };
}

function btn(text: string): TelegramReplyKeyboardButton {
  return { text };
}

function chunkInPairs(buttons: TelegramInlineKeyboardButton[]): TelegramInlineKeyboardButton[][] {
  const rows: TelegramInlineKeyboardButton[][] = [];
  for (let i = 0; i < buttons.length; i += 2) {
    rows.push(buttons.slice(i, i + 2));
  }
  return rows;
}

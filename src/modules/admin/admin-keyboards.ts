import type {
  TelegramInlineKeyboardButton,
  TelegramInlineKeyboardMarkup
} from "../telegram/invoice-link.js";
import type { CatalogCar } from "../cars-catalog/cars-catalog-repository.js";
import type { Season } from "../seasons/seasons-domain.js";

type ButtonRow = TelegramInlineKeyboardButton[];

export function buildMainMenuKeyboard(): TelegramInlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: "👤 Users", callback_data: "menu_users" },
        { text: "🚗 Cars", callback_data: "menu_cars" }
      ],
      [
        { text: "🏁 Seasons", callback_data: "menu_seasons" },
        { text: "📊 Stats", callback_data: "menu_stats" }
      ]
    ]
  };
}

export function buildUsersMenuKeyboard(): TelegramInlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [{ text: "🔍 Find User", callback_data: "finduser_prompt" }],
      [{ text: "« Back to Main Menu", callback_data: "main_menu" }]
    ]
  };
}

export function buildUserKeyboard(userId: string): TelegramInlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: "➕ 100 RC", callback_data: `addcoins:${userId}:100` },
        { text: "➕ 500 RC", callback_data: `addcoins:${userId}:500` },
        { text: "➕ Custom", callback_data: `addcoins_prompt:${userId}` }
      ],
      [
        { text: "➖ 100 RC", callback_data: `subcoins:${userId}:100` },
        { text: "➖ 500 RC", callback_data: `subcoins:${userId}:500` },
        { text: "➖ Custom", callback_data: `subcoins_prompt:${userId}` }
      ],
      [
        { text: "🚗 Give Car", callback_data: `givecar_prompt:${userId}` },
        { text: "💰 Set Balance", callback_data: `setbalance_prompt:${userId}` }
      ],
      [{ text: "« Back to Users Menu", callback_data: "menu_users" }]
    ]
  };
}

export function buildCarsCatalogKeyboard(cars: CatalogCar[]): TelegramInlineKeyboardMarkup {
  const editButtons: TelegramInlineKeyboardButton[] = cars.map((car) => ({
    text: `✏️ ${car.carId}`,
    callback_data: `editcar:${car.carId}`
  }));

  const rows: ButtonRow[] = chunkInPairs(editButtons);
  rows.push([{ text: "➕ Add Car", callback_data: "addcar_prompt" }]);
  rows.push([{ text: "« Back to Main Menu", callback_data: "main_menu" }]);

  return { inline_keyboard: rows };
}

export function buildCarDetailKeyboard(
  carId: string,
  isActive: boolean
): TelegramInlineKeyboardMarkup {
  const toggleText = isActive ? "🔴 Deactivate" : "🟢 Activate";
  return {
    inline_keyboard: [
      [
        { text: toggleText, callback_data: `togglecar:${carId}` },
        { text: "✏️ Set Price", callback_data: `setprice_prompt:${carId}` },
        { text: "✏️ Set Title", callback_data: `settitle_prompt:${carId}` }
      ],
      [{ text: "« Back to Catalog", callback_data: "menu_cars" }]
    ]
  };
}

export function buildSeasonsKeyboard(seasons: Season[]): TelegramInlineKeyboardMarkup {
  const editButtons: TelegramInlineKeyboardButton[] = seasons.map((s) => ({
    text: `✏️ ${s.title}`,
    callback_data: `editseason:${s.seasonId}`
  }));

  const rows: ButtonRow[] = chunkInPairs(editButtons);
  rows.push([{ text: "➕ Create Season", callback_data: "createseason_prompt" }]);
  rows.push([{ text: "« Back to Main Menu", callback_data: "main_menu" }]);

  return { inline_keyboard: rows };
}

export function buildSeasonDetailKeyboard(
  seasonId: string,
  canFinishNow: boolean
): TelegramInlineKeyboardMarkup {
  const rows: ButtonRow[] = [
    [
      { text: "✏️ Title", callback_data: `editseason_title_prompt:${seasonId}` },
      { text: "✏️ Map", callback_data: `editseason_mapid_prompt:${seasonId}` }
    ],
    [
      { text: "✏️ Starts", callback_data: `editseason_starts_prompt:${seasonId}` },
      { text: "✏️ Ends", callback_data: `editseason_ends_prompt:${seasonId}` }
    ],
    [{ text: "✏️ Entry Fee", callback_data: `editseason_fee_prompt:${seasonId}` }]
  ];
  if (canFinishNow) {
    rows.push([{ text: "🏁 Finish Now", callback_data: `finishseason_confirm:${seasonId}` }]);
  }
  rows.push([{ text: "« Back to Seasons", callback_data: "menu_seasons" }]);
  return { inline_keyboard: rows };
}

export function buildGiveCarSelectionKeyboard(
  userId: string,
  cars: CatalogCar[]
): TelegramInlineKeyboardMarkup {
  const buttons: TelegramInlineKeyboardButton[] = cars.map((car) => ({
    text: car.title,
    callback_data: `givecar:${userId}:${car.carId}`
  }));

  const rows: ButtonRow[] = chunkInPairs(buttons);
  rows.push([{ text: "« Back", callback_data: `user_back:${userId}` }]);
  return { inline_keyboard: rows };
}

export function buildConfirmCreateSeasonKeyboard(): TelegramInlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: "✅ Create", callback_data: "createseason_confirm" },
        { text: "❌ Cancel", callback_data: "menu_seasons" }
      ]
    ]
  };
}

export function buildConfirmFinishSeasonKeyboard(seasonId: string): TelegramInlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: "✅ Finish Now", callback_data: `finishseason_apply:${seasonId}` },
        { text: "❌ Cancel", callback_data: `editseason:${seasonId}` }
      ]
    ]
  };
}

export function buildAddCarPurchasableKeyboard(): TelegramInlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: "✅ Yes", callback_data: "addcar_purchasable:yes" },
        { text: "❌ No", callback_data: "addcar_purchasable:no" }
      ],
      [{ text: "« Cancel", callback_data: "menu_cars" }]
    ]
  };
}

export function cancelInlineKeyboard(backCallback: string): TelegramInlineKeyboardMarkup {
  return {
    inline_keyboard: [[{ text: "❌ Cancel", callback_data: backCallback }]]
  };
}

function chunkInPairs(buttons: TelegramInlineKeyboardButton[]): ButtonRow[] {
  const rows: ButtonRow[] = [];
  for (let i = 0; i < buttons.length; i += 2) {
    rows.push(buttons.slice(i, i + 2));
  }
  return rows;
}

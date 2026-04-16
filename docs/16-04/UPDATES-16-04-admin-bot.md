# Backend Updates — 16 April 2026

## Что сделано

Добавлен отдельный админский Telegram-бот для управления игрой из Telegram. Бот работает в том же процессе, что и основной API, через отдельный webhook. Весь функционал — через команды и inline-кнопки.

## Новый роут

### POST /v1/admin/telegram/webhook

Webhook админ-бота. Регистрируется только при полном наборе admin env-переменных.

**Защита (defense-in-depth):**

1. `x-telegram-bot-api-secret-token` сравнивается с `ADMIN_WEBHOOK_SECRET` (timing-safe) — иначе `401 INVALID_WEBHOOK_SECRET`.
2. Валидация формы update через type-guards `isAdminCallbackQueryUpdate` / `isAdminTextMessageUpdate`.
3. Проверка `from.id` против `ADMIN_TELEGRAM_IDS` whitelist — любой чужой апдейт молча игнорируется (лог `warn`).
4. Отдельный бот-токен (`ADMIN_BOT_TOKEN`), не пересекается с `BOT_TOKEN`.

Handler не использует публичные HTTP-роуты — ходит напрямую в репозитории.

## Новые env-переменные

Все три обязаны быть заданы одновременно, иначе admin webhook **не** регистрируется.

| Variable | Назначение |
|---|---|
| `ADMIN_BOT_TOKEN` | токен отдельного Telegram-бота для админки |
| `ADMIN_WEBHOOK_SECRET` | секрет для заголовка `x-telegram-bot-api-secret-token` |
| `ADMIN_TELEGRAM_IDS` | whitelist `from.id`, через запятую (например `374579614,411954`) |

После добавления на Railway:

```bash
railway variables set ADMIN_BOT_TOKEN=<token>
railway variables set ADMIN_WEBHOOK_SECRET=<secret>
railway variables set ADMIN_TELEGRAM_IDS=374579614,411954
```

Регистрация webhook в Telegram (один раз):

```bash
curl -X POST "https://api.telegram.org/bot<ADMIN_BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://<host>/v1/admin/telegram/webhook",
    "secret_token": "<ADMIN_WEBHOOK_SECRET>",
    "allowed_updates": ["message", "callback_query"]
  }'
```

## Команды админ-бота

| Команда | Что делает |
|---|---|
| `/start`, `/menu` | главное меню (Users / Cars / Seasons / Stats) |
| `/user <telegramUserId\|username>` | карточка пользователя с inline-действиями |
| `/cars` | список каталога (включая неактивные) |
| `/seasons` | список всех сезонов (любой статус) |
| `/stats` | users count, top-10 UTM, purchases summary |

## Функционал

### Users

- Найти по Telegram ID или username (`@name` или без `@`).
- Просмотр: имя, userId, telegramId, баланс RC, машины, UTM.
- `➕ 100 / 500 / Custom RC` — начислить.
- `➖ 100 / 500 / Custom RC` — списать (через `spendRaceCoins` с `$gte`-гардом, не уходит в минус).
- `💰 Set Balance` — задать абсолютное значение (≥ 0).
- `🚗 Give Car` — выбор из каталога и выдача.

### Cars catalog

- Список всех машин (активные и неактивные).
- Детали машины: title, price, sortOrder, purchasable, starter, active.
- `🟢 Activate` / `🔴 Deactivate` (toggle `active`).
- `✏️ Set Price` — non-negative integer, RC.
- `✏️ Set Title`.
- `➕ Add Car` — мастер 4 шага: carId → title → price → purchasable (Yes/No). `sortOrder` выставляется автоматически как `max + 1`.

### Seasons

- Список всех сезонов со статусом (`upcoming` / `active` / `finished`) и датой.
- Детали сезона: title, mapId, entryFee, prizePoolShare, starts, ends, status.
- Редактирование title, mapId, starts, ends, entryFee.
- `🏁 Finish Now` — досрочное завершение (2-step confirm). Выставляет `endsAt = now` и при необходимости подправляет `startsAt`, чтобы сохранить инвариант `endsAt > startsAt`.
- `➕ Create Season` — мастер 6 шагов: title → mapId → entryFee → prizePoolShare → starts → ends → confirm.

### Stats

- Total users.
- Top-10 UTM sources (агрегация `$group` с `$ifNull: "direct"`).
- Purchases: active intents, granted total, granted за последние 24h, суммарно granted coins, суммарная Stars revenue.

## Инварианты и валидация

Все введено на уровне репозиториев, не только UI:

- `addRaceCoins(userId, amount)` и `setRaceCoinsBalance(userId, amount)` отклоняют отрицательные `amount` (throw).
- «Списание» всегда идёт через `spendRaceCoins` с атомарным `$gte`-гардом в Mongo.
- `createSeason` / `updateSeason` валидируют `endsAt > startsAt` (`validateSeasonDateRange`), `entryFee ≥ 0`, `prizePoolShare ∈ [0, 1]`.
- Строгий парсинг админского ввода (`admin-input.ts`):
  - `parseIntegerStrict` / `parseNonNegativeIntegerStrict` / `parsePositiveIntegerStrict` — через regex, отбрасывает «100abc».
  - `parsePrizePoolShareStrict` — только `0..1`.
  - `parseDateUtcStrict` — формат `YYYY-MM-DD HH:MM`, интерпретируется как UTC через `Date.UTC`.
- HTML-escape всего пользовательского текста в `parse_mode: "HTML"` через `escapeHtml`.

## Новые файлы

```
src/modules/admin/
  admin-bot-handler.ts       — top-level webhook dispatcher
  admin-callbacks.ts         — routing по callback_data
  admin-commands.ts          — /user, /cars, /seasons, /stats, /start
  admin-config.ts            — типы pending state, константы, parseAdminTelegramIds
  admin-format.ts            — HTML-safe форматтеры карточек
  admin-input.ts             — строгие парсеры + escapeHtml
  admin-keyboards.ts         — inline-keyboard builders
  admin-user-lookup.ts       — findUserByQuery
  admin-webhook-domain.ts    — type guards для admin update
```

## Расширение репозиториев

### `UsersRepository`

Добавлено:

- `getUserByTelegramId(telegramUserId)`
- `getUserByUsername(username)`
- `setRaceCoinsBalance(userId, amount)` — guard `>=0`
- `getUserCount()`
- `getTopUtmSources(limit)` — агрегация с лимитом

`addRaceCoins` теперь rejects negative amount.

### `CarsCatalogRepository`

Добавлено:

- `getAllCars()` — включая неактивные
- `upsertCar(car)`
- `setCarActive(carId, active)`
- `getMaxSortOrder()` — для авто-инкремента при добавлении машины

### `SeasonsRepository`

Добавлено:

- `getAllSeasons(referenceNow)` — все статусы
- `createSeason(input, referenceNow)` — с валидацией
- `updateSeason(seasonId, patch, referenceNow)` — с валидацией итогового `startsAt`/`endsAt`
- `UpdateSeasonInput` теперь поддерживает `title`, `mapId`, `entryFee`, `prizePoolShare`, `startsAt`, `endsAt`

Экспорт `validateSeasonDateRange(startsAt, endsAt)`.

### `PurchasesRepository`

Добавлено:

- `getStatsSummary(referenceNow)` → `PurchaseStatsSummary` (`activeIntents`, `grantedTotal`, `grantedLast24h`, `coinsGrantedTotal`, `starsRevenueTotal`).

## Telegram API helpers

В `src/modules/telegram/invoice-link.ts` добавлены:

- `answerCallbackQuery(options, callbackQueryId, text?)` — гасит спиннер на кнопке
- `editMessageText(options, { chatId, messageId, text, replyMarkup? })` — обновление сообщения после действия
- Типы `TelegramInlineKeyboardMarkup`, `TelegramInlineKeyboardButton`, `TelegramSendMessageInput`, `TelegramEditMessageTextInput`

## Mongo индексы (новые)

`src/infra/mongo/indexes.ts`:

- `users.username` (partial: `{ username: { $type: "string" } }`) — быстрый `getUserByUsername`.
- `users.utmSource` (partial) — ускорение `$group` по UTM.

## Swagger

`swagger.yaml`:

- Тег `Admin`.
- Маршрут `POST /v1/admin/telegram/webhook` с описанием и ответами `200`/`401`.
- Security-схема `adminWebhookSecret` (отдельная от `telegramWebhookSecret`).
- Version bump → `0.4.0`, расширенный `info.description`.

## Code review

Перед релизом был проведён строгий review (см. ответ ассистента в этой сессии). Исправлено:

**Critical:**

- Убраны все `any`/`unknown` касты (нарушение user-rule).
- Удалены все narrative-комментарии в коде.
- Защищены инварианты баланса.
- HTML-escape для `parse_mode: HTML`.
- Добавлены кнопки списания RC.
- Добавлена purchases-аналитика.
- Обновлён swagger.

**Important:**

- Type-guards вместо `update: any`.
- Строгие парсеры чисел и дат (вместо `parseInt`/`new Date(text)`).
- Валидация `endsAt > startsAt`.
- `prizePoolShare` как шаг мастера.
- Auto-increment `sortOrder`.
- Лимит top-10 UTM.
- Sweep устаревших pending actions.
- Дедупликация поиска пользователя.
- Убраны дубли callback-экшенов `menu_cars`/`cars`, `menu_seasons`/`seasons`.
- Редактирование `startsAt`, `mapId` сезона.
- Явная кнопка «Finish Now» с confirm.
- `/user` без аргумента показывает usage.
- Индексы на `username`, `utmSource`.

## Проверки

- `npm run typecheck` — зелёный.
- `npm run build` — зелёный.
- `.env` дополнен `ADMIN_WEBHOOK_SECRET` и `ADMIN_TELEGRAM_IDS=374579614,411954`.

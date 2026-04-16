# Admin Bot Implementation Prompt

## Context

This is a Telegram Mini App backend (Node.js 22, TypeScript ESM, Fastify 5, MongoDB 6).
Read `AGENTS.md` fully before starting — it describes the full project structure, conventions, and rules.

The game bot (`BOT_TOKEN`) already handles `/start`, payments, and Mini App launch.
We are adding a **second admin Telegram bot** (`ADMIN_BOT_TOKEN`) that lets whitelisted admins manage the app via bot commands and inline keyboard buttons.

---

## Architecture

All admin bot logic runs **in the same process** as the main API (Variant A — no separate service).

- Admin bot webhook route: `POST /v1/admin/telegram/webhook`
- Separate webhook secret: `ADMIN_WEBHOOK_SECRET`
- Admin whitelist: `ADMIN_TELEGRAM_IDS` env var (comma-separated Telegram user IDs, e.g. `123456,789012`)
- All admin operations call existing repositories directly (no HTTP round-trips)
- New env vars are optional — if `ADMIN_BOT_TOKEN` is absent, the admin webhook route is not registered

---

## New Env Vars

Add to `src/config/config.ts` (all optional):

- `ADMIN_BOT_TOKEN` — token of the admin bot
- `ADMIN_WEBHOOK_SECRET` — webhook secret for `POST /v1/admin/telegram/webhook`
- `ADMIN_TELEGRAM_IDS` — comma-separated list of allowed Telegram user IDs

---

## New Files

```
src/modules/admin/
  admin-config.ts          — AdminConfig type, parseAdminTelegramIds(str): string[]
  admin-bot-handler.ts     — createAdminBotHandler(deps): (update: unknown) => Promise<void>
  admin-commands.ts        — command routing: /user, /cars, /seasons, /stats
  admin-callbacks.ts       — callback_query routing by prefix
  admin-keyboards.ts       — inline keyboard builders
  admin-format.ts          — text formatters for user/car/season cards
```

---

## Repository Extensions Needed

### UsersRepository (interface + Mongo impl)

Add:
- `getUserByTelegramId(telegramUserId: string): Promise<AppUser | null>`
- `setRaceCoinsBalance(userId: string, amount: number): Promise<AppUser>`
- `getUserCount(): Promise<number>`
- `getUsersGroupedByUtmSource(): Promise<Array<{ utmSource: string; count: number }>>`

### CarsCatalogRepository (interface + Mongo impl)

Add:
- `getAllCars(): Promise<CatalogCar[]>` — all cars including inactive
- `upsertCar(car: CatalogCar): Promise<CatalogCar>`
- `setCarActive(carId: string, active: boolean): Promise<CatalogCar | null>`

### SeasonsRepository (interface + Mongo impl)

Add:
- `getAllSeasons(): Promise<Season[]>` — all seasons regardless of status
- `createSeason(input: CreateSeasonInput): Promise<Season>`
- `updateSeason(seasonId: string, patch: UpdateSeasonInput): Promise<Season | null>`

Where:
```ts
interface CreateSeasonInput {
  title: string;
  mapId: string;
  entryFee: number;
  prizePoolShare: number;
  startsAt: Date;
  endsAt: Date;
}

interface UpdateSeasonInput {
  title?: string;
  entryFee?: number;
  startsAt?: Date;
  endsAt?: Date;
}
```

---

## Bot Commands and UX

All commands check if `message.from.id` is in the admin whitelist. If not — silently ignore.

### `/user <telegramUserId|username>`

Finds user by Telegram ID or username. Replies with a card:

```
👤 Ivan Petrov (@ivan)
ID: usr_123456
Telegram: 123456
Balance: 250 RC
Cars: car0, car1
UTM: google / cpc / winter

[➕ 100 RC] [➕ 500 RC] [➕ Custom RC]
[🚗 Give Car] [💰 Set Balance]
```

Buttons:
- `addcoins:<userId>:100` — add 100 RC, edit message with updated balance
- `addcoins:<userId>:500` — add 500 RC, same
- `addcoins_prompt:<userId>` — bot sends "Enter amount:" and waits for next message (conversational input)
- `givecar_prompt:<userId>` — bot replies with car selection keyboard
- `setbalance_prompt:<userId>` — bot sends "Enter new balance:" and waits

### `/cars`

Lists all cars from `carsCatalog` (including inactive):

```
🚗 Car Catalog

car0 — 0 RC — starter ✅ active
car1 — 1 RC ✅ active
car2 — 50 RC ✅ active
car3 — 100 RC ❌ inactive

[➕ Add Car] [✏️ Edit car1] [✏️ Edit car2] ...
```

Buttons:
- `editcar:<carId>` — shows car detail with edit options
- `togglecar:<carId>` — toggles `active`, edits message
- `addcar_prompt` — starts flow: bot asks for carId, title, price, isPurchasable step by step

Car detail card on `editcar:<carId>`:
```
✏️ car2
Title: car2
Price: 50 RC
Purchasable: yes
Active: yes

[🔴 Deactivate] [✏️ Set Price] [✏️ Set Title]
[« Back to Catalog]
```

### `/seasons`

Lists all seasons (all statuses):

```
🏁 Seasons

[upcoming] Spring Cup — starts 2025-05-01
[active]   Winter Race — ends 2025-04-20
[finished] Test Season

[➕ Create Season] [✏️ Spring Cup] [✏️ Winter Race]
```

Button `createseason_prompt` — step-by-step flow:
1. "Enter title:"
2. "Enter mapId:"
3. "Enter entry fee (RC):"
4. "Enter start date (YYYY-MM-DD HH:MM UTC):"
5. "Enter end date (YYYY-MM-DD HH:MM UTC):"
6. Confirm card with [✅ Create] [❌ Cancel]

Button `editseason:<seasonId>` — shows season card:
```
✏️ Winter Race
Map: map_winter
Entry Fee: 10 RC
Starts: 2025-04-10 12:00 UTC
Ends:   2025-04-20 12:00 UTC
Status: active

[✏️ Set End Date] [✏️ Set Entry Fee] [✏️ Set Title]
[« Back to Seasons]
```

### `/stats`

```
📊 Stats

👥 Total users: 1 842
💰 Top UTM sources:
   google — 540
   telegram — 310
   direct — 210
   (other) — 782
```

No buttons, just a formatted message.

---

## Conversational Input Flow

When admin presses a "prompt" button (e.g. `addcoins_prompt:<userId>`), the bot:
1. Sends "Enter amount:" and stores pending state in a **in-memory Map** keyed by admin Telegram ID: `Map<string, PendingAdminAction>`
2. On the next text message from that admin — checks if pending state exists, processes it, clears state
3. If the next message is a command — clears pending state and processes the command normally

```ts
interface PendingAdminAction {
  type: "addcoins" | "setbalance" | "givecar" | "setprice" | "settitle"
        | "createseason_title" | "createseason_mapid" | ... ;
  context: Record<string, string>;
  expiresAt: number; // Date.now() + 5 * 60 * 1000
}
```

Pending state lives in-memory only (no Mongo needed). It expires after 5 minutes.

---

## Wiring

### `src/config/config.ts`

```ts
interface AdminConfig {
  adminBotToken: string;
  adminWebhookSecret: string;
  adminTelegramIds: string[];
}

// Add optional adminConfig: AdminConfig | undefined to AppConfig
```

### `src/runtime.ts`

```ts
if (input.config.adminConfig) {
  const adminWebhookHandler = createAdminBotHandler({
    usersRepository,
    carsCatalogRepository,
    seasonsRepository,
    telegramOptions: { botToken: input.config.adminConfig.adminBotToken },
    allowedTelegramIds: input.config.adminConfig.adminTelegramIds
  });
  // pass adminWebhookHandler to buildApp
}
```

### `src/app.ts`

```ts
// New optional dep:
adminHandleTelegramWebhook?: (update: unknown) => Promise<void>;

// New route (only registered when dep is present):
app.post("/v1/admin/telegram/webhook", async (request, reply) => {
  // verify ADMIN_WEBHOOK_SECRET header
  // call adminHandleTelegramWebhook(request.body)
  return reply.send({ ok: true });
});
```

---

## Telegram API Calls Needed

Add to `src/modules/telegram/invoice-link.ts` or a new `src/modules/telegram/bot-api.ts`:

- `answerCallbackQuery(options, callbackQueryId, text?)` — clears button spinner
- `editMessageText(options, chatId, messageId, text, replyMarkup?)` — update message after action

---

## Conventions

- Follow all rules in `AGENTS.md`: no comments in code, no `any`/`unknown` casts, typecheck must pass.
- Keep admin handler in `src/modules/admin/`, not in `src/app.ts`.
- Pending state Map lives inside `createAdminBotHandler` closure.
- New repository methods go to existing interfaces and Mongo implementations.
- Run `npm run typecheck` before claiming done.

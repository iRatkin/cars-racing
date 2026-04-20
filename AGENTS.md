# Agent Context: Telegram Miniapp Cars Phase 0

This file is optimized for future coding agents. Prefer it over rediscovering the project from scratch.

## System Intent

Build a Phase 0 Telegram Mini App backend for a simple cars game/shop with an internal **race coins** currency and **battle seasons** (time-limited solo races, server-issued seeds, per-season leaderboards, plus free training runs with a separate personal seasonal highscore).

Target behavior:
- Telegram Mini App sends signed `initData`.
- API validates `initData` with `BOT_TOKEN`.
- API creates or updates an app user.
- User always sees a starter car.
- User can view garage/catalog state and their race coins balance.
- User can purchase race coins bundles for Telegram Stars via invoice flow.
- User can buy cars with race coins (no Telegram Stars involved).
- Users can enter battle seasons for a configurable race-coins entry fee, run solo races with a server `seed`, submit scores, and view per-season leaderboards (competition ranking).
- Users can also run **training** races on the active season map for free, without entering the season, and receive a separate personal per-season training highscore.
- API asks Telegram Bot API for an invoice link when purchasing race coins bundles.
- Telegram POSTs payment webhook updates (`pre_checkout_query`, `successful_payment`) to the backend.
- Webhook handler approves pre-checkout, grants race coins on successful payment.
- Bot registers users and captures UTM attribution on `/start` command.
- Separate admin Telegram bot (behind a second webhook) exposes whitelist-gated management UI for users, cars catalog, seasons, and lightweight analytics.
- MongoDB is the persistence layer.

## Current Reality

Runtime exists, starts, and is deployed on Railway:
- Entry point: `src/server.ts`
- App factory: `src/app.ts`
- Mongo wiring factory: `src/runtime.ts`
- Docker (local): `Dockerfile.local`
- Compose (local): `docker-compose.yml`
- Railway config: `railway.toml` (Nixpacks builder)
- OpenAPI: `swagger.yaml`

Payment webhook processing is fully implemented:
- `POST /v1/telegram/webhook` is wired to a real handler via `src/modules/telegram/webhook-handler.ts`.
- `pre_checkout_query` → validates purchase, calls `answerPreCheckoutQuery(ok=true)`, updates status to `pre_checkout_approved`.
- `successful_payment` → finds purchase by `invoicePayload`, grants race coins via `addRaceCoins`, marks purchase as `granted`.
- Idempotent: already-granted purchases are skipped.

Game bot `/start` handling:
- On `/start`, bot upserts user by Telegram profile fields from `message.from` (registers before Mini App loads).
- If `/start <payload>` contains a base64url-encoded UTM payload, it is parsed and saved via `setUtmIfNotSet` (first-touch attribution, never overwritten).
- Bot replies with a welcome message; if `MINI_APP_URL` is set, includes an inline `web_app` button to open the Mini App.
- UTM payload format: base64url of `{"s":"<source>","m":"<medium>","c":"<campaign>","cn":"<content>","t":"<term>"}` (all keys except `s` are optional).

Battle seasons:
- Season documents live in Mongo (`seasons`); `status` is always derived from `startsAt` / `endsAt` and a single request clock (`requestNow`), not stored.
- Entering a season charges `entryFee` race coins and creates a `seasonEntries` row in one Mongo **multi-document transaction** (requires replica set; local Compose runs Mongo as single-node replica set `rs0`).
- Ranked race runs and training race runs share the `raceRuns` collection; each run now has `mode: "ranked" | "training"` (legacy rows without `mode` are treated as ranked reads).
- Finishing a **ranked** race moves `raceRuns` to `finished` and updates `seasonEntries` (`totalRaces`, `bestScore` via `$max`) in one transaction.
- Finishing a **training** race moves `raceRuns` to `finished` and updates `seasonTrainingEntries` (`totalRaces`, `bestScore` via `$max`) in one transaction.
- `POST /v1/seasons/:seasonId/races/start` creates a ranked `raceRuns` row with `started` and returns `{ raceId, seed }`; finish requires matching `raceId`, `seed`, `started`, and `mode: "ranked"`.
- `POST /v1/seasons/:seasonId/training-races/start` creates a training `raceRuns` row with `started` and returns `{ raceId, seed }`; it requires only an active season, not season entry or payment.
- `GET /v1/seasons` and `GET /v1/seasons/:seasonId` now include a `training` block with the caller's personal training `bestScore` and `totalRaces` for that season.

Starter car detail:
- Users are inserted into Mongo with `ownedCarIds: []`, `garageRevision: 0`, and `raceCoinsBalance: 0`.
- Routes call `ensureStarterCarState()` and return derived starter ownership.
- Current routes do not persist that derived starter state back to Mongo.

Admin bot:
- Runs in the **same process** as the main API (no separate service).
- Registered only when `ADMIN_BOT_TOKEN`, `ADMIN_WEBHOOK_SECRET`, `ADMIN_TELEGRAM_IDS` env vars are all provided — otherwise the admin webhook route is not registered.
- Webhook route: `POST /v1/admin/telegram/webhook` (separate secret `ADMIN_WEBHOOK_SECRET`, compared via `compareTelegramWebhookSecretToken`).
- Access inside the handler is further gated by the `ADMIN_TELEGRAM_IDS` whitelist; unauthorized senders are silently ignored (warn logged).
- Admin operations call existing repositories directly (no HTTP round-trips to the public API).
- Supports commands `/start`, `/menu`, `/user <id|username>`, `/cars`, `/seasons`, `/stats`.
- **Navigation model**: reply-keyboard-based. Every menu/detail screen attaches a persistent reply keyboard (`is_persistent: true`, `resize_keyboard: true`) to the chat; button taps are plain text messages matched against the current session view. Inline keyboards are used **only** for three dynamic lists where the item IDs are dynamic: cars catalog (`editcar:<carId>`), seasons list (`editseason:<seasonId>`), and give-car picker (`givecar:<userId>:<carId>`). Each list view sends two messages: one carrying the reply keyboard (e.g. `[➕ Add Car] [« Back]`), the other carrying the inline list.
- **Session state** (in-memory `Map<adminId, AdminSession>`, 30-minute TTL, periodic sweep): `{ view: AdminView, pending: PendingAdminAction | null, expiresAt }`. `AdminView` union tracks the currently rendered screen (`main` / `users_menu` / `user` / `cars` / `car` / `give_car` / `seasons` / `season` / `stats`) plus wizard states (`wizard { cancelTo }`, `addcar_purchasable`, `confirm_create_season`, `confirm_finish_season`). Inbound text is dispatched by current view + label; sessions are lost on process restart.
- **Wizards** (multi-step text input): set view to `wizard { cancelTo }` and show a `[❌ Cancel]` reply keyboard. Cancel returns to `cancelTo`. `pending` entries have their own 5-minute TTL (`ADMIN_PENDING_ACTION_TTL_MS`). Confirmation steps with buttons (`addcar_purchasable`, `confirm_create_season`, `confirm_finish_season`) use dedicated reply keyboards.
- **Users export**: `📥 Export Users` button in the Users menu renders a minimal XLSX document (via `exceljs`) with a single `userId` column (one row per user) and sends it as a Telegram document via `sendDocument` (multipart/form-data). See `admin-users-export.ts`.
- **Today UTM report**: `📈 Today UTM` button in the Users menu aggregates users with `createdAt >= startOfUtcDay(now)` grouped by `utmSource` (missing source is bucketed as `direct`) and replies with an HTML-formatted breakdown via `formatTodayUtmReport`.
- All admin text is rendered with `parse_mode: "HTML"`; all user/catalog/season strings are HTML-escaped via `escapeHtml()`.
- All numeric admin input is parsed by strict validators (`parseIntegerStrict`, `parseNonNegativeIntegerStrict`, `parsePositiveIntegerStrict`, `parsePrizePoolShareStrict`); dates use `parseDateUtcStrict` (format `YYYY-MM-DD HH:MM` interpreted as UTC via `Date.UTC`).
- `addRaceCoins` and `setRaceCoinsBalance` reject negative values at the repository level. Admin "subtract" always goes through `spendRaceCoins` (with `$gte`-guard) so the balance never goes below 0.
- `createSeason` / `updateSeason` validate `endsAt > startsAt`, `entryFee >= 0` (integer), and `prizePoolShare` in `[0, 1]`.

## Tech Stack

- Node.js 22
- TypeScript ESM (`"type": "module"`, `moduleResolution: "NodeNext"`)
- Fastify 5
- `@fastify/jwt`
- MongoDB driver 6
- Zod
- `exceljs` (admin users XLSX export)
- Vitest
- Docker Compose with Mongo 7 (local)
- Railway with Nixpacks (deployed)
- MongoDB Atlas (deployed)

## Deployment

Production is deployed on Railway:
- Builder: Nixpacks (auto-detects Node.js)
- URL: `https://cars-racing-production.up.railway.app`
- Env vars set via Railway CLI (`railway variables set KEY=VALUE`)
- Auto-deploy on push to `main`
- Telegram webhook registered to Railway URL

Local development uses Docker Compose with `Dockerfile.local`.

## Commands

Install:

```bash
npm install
```

Typecheck:

```bash
npm run typecheck
```

Build:

```bash
npm run build
```

Run built app locally:

```bash
npm run build
npm start
```

Run full local environment:

```bash
docker compose up --build
```

Validate compose:

```bash
docker compose config
```

## Required Runtime Env

Loaded by `src/config/config.ts`.

Required:
- `BOT_TOKEN`
- `JWT_SECRET`
- `MONGO_URI`
- `TELEGRAM_WEBHOOK_SECRET`

Optional:
- `MINI_APP_URL`: URL of the Mini App shown as `web_app` button on `/start`; if absent, bot sends plain text welcome.
- `NODE_ENV`: `dev`, `stage`, `prod` (also accepts `development`, `staging`, `production`); default `dev`
- `PORT`: integer; default `3000`

Admin bot (all three must be set together to enable the admin webhook; absence of any one disables the admin route):
- `ADMIN_BOT_TOKEN`: Telegram bot token for the admin bot (separate bot from `BOT_TOKEN`).
- `ADMIN_WEBHOOK_SECRET`: secret for `x-telegram-bot-api-secret-token` on `POST /v1/admin/telegram/webhook`.
- `ADMIN_TELEGRAM_IDS`: comma-separated list of allowed Telegram user IDs (e.g. `123456,789012`); updates from anyone else are silently ignored.

Compose defaults:
- `BOT_TOKEN=123456:test-token`
- `JWT_SECRET=dev-jwt-secret-change-me`
- `MONGO_URI=mongodb://mongo:27017/mafinki`
- `NODE_ENV=dev`
- `PORT=3000`
- `TELEGRAM_WEBHOOK_SECRET=dev-webhook-secret`

Real invoice creation needs a real Telegram bot token. The compose default is only for booting the stack.

## HTTP Surface

OpenAPI source of truth for humans/tools:
- `swagger.yaml`

Implemented routes:
- `GET /health`
- `POST /v1/auth/telegram`
- `GET /v1/garage`
- `POST /v1/purchases/coins-intents`
- `POST /v1/purchases/buy-car`
- `GET /v1/seasons`
- `GET /v1/seasons/{seasonId}`
- `POST /v1/seasons/{seasonId}/enter`
- `POST /v1/seasons/{seasonId}/races/start`
- `POST /v1/seasons/{seasonId}/races/finish`
- `POST /v1/seasons/{seasonId}/training-races/start`
- `POST /v1/seasons/{seasonId}/training-races/finish`
- `GET /v1/seasons/{seasonId}/training-highscore`
- `GET /v1/seasons/{seasonId}/leaderboard`
- `POST /v1/telegram/webhook`
- `POST /v1/admin/telegram/webhook` (only when admin env vars are set)

Auth:
- `GET /v1/garage` requires `Authorization: Bearer <jwt>`.
- `POST /v1/purchases/coins-intents` requires `Authorization: Bearer <jwt>`.
- `POST /v1/purchases/buy-car` requires `Authorization: Bearer <jwt>`.
- All `/v1/seasons` routes require `Authorization: Bearer <jwt>`.
- Telegram webhook requires `x-telegram-bot-api-secret-token` matching `TELEGRAM_WEBHOOK_SECRET`.
- Admin webhook requires `x-telegram-bot-api-secret-token` matching `ADMIN_WEBHOOK_SECRET` **and** sender `from.id` present in `ADMIN_TELEGRAM_IDS`.

Common error codes are documented in `swagger.yaml`.

## Important Files

Core API:
- `src/app.ts`: declares Fastify routes and response behavior.
- `src/runtime.ts`: creates Mongo repositories (users, cars catalog, purchases, seasons, season entries, season training entries, race runs), Telegram invoice client, webhook handler, admin bot handler (when admin env vars are present), passes `MongoClient` for season transactions, then calls `buildApp()`.
- `src/server.ts`: loads env, connects Mongo, creates indexes, seeds `carsCatalog` if empty, listens on `0.0.0.0`.
- `src/config/config.ts`: env parsing and validation (accepts NODE_ENV aliases); parses optional `AdminConfig` from `ADMIN_*` env vars.

Mongo:
- `src/infra/mongo/users-repository.ts`: Mongo implementation of `UsersRepository`.
- `src/infra/mongo/cars-catalog-repository.ts`: Mongo implementation of `CarsCatalogRepository`; also exports `seedCarsCatalogIfEmpty`.
- `src/infra/mongo/purchases-repository.ts`: Mongo implementation of `PurchasesRepository`.
- `src/infra/mongo/seasons-repository.ts`: Mongo `SeasonsRepository`.
- `src/infra/mongo/season-entries-repository.ts`: Mongo `SeasonEntriesRepository`.
- `src/infra/mongo/season-training-entries-repository.ts`: Mongo `SeasonTrainingEntriesRepository`.
- `src/infra/mongo/race-runs-repository.ts`: Mongo `RaceRunsRepository`.
- `src/infra/mongo/season-mongo-transactions.ts`: transactional season enter, ranked race finish, and training race finish.
- `src/infra/mongo/indexes.ts`: index definitions and `ensureMongoIndexes()`.

Domain:
- `src/modules/auth/telegram-init-data.ts`: Telegram Mini App initData validation.
- `src/modules/users/starter-car.ts`: derived starter car state.
- `src/modules/users/users-repository.ts`: `AppUser` type, `UsersRepository` interface (including `getAllUsers()` used by admin export and `getUtmSourcesSince(date)` used by the admin Today-UTM report), `UtmSourceCount` type.
- `src/modules/cars-catalog/cars-catalog.ts`: `PHASE_0_CAR_CATALOG` seed data array (source of truth for initial Mongo seed only).
- `src/modules/cars-catalog/cars-catalog-repository.ts`: `CatalogCar` type, `CarsCatalogRepository` interface, `canPurchaseCarServerSide`.
- `src/modules/race-coins/race-coins-catalog.ts`: race coins bundles available for purchase with Telegram Stars.
- `src/modules/garage/garage-view.ts`: garage projection.
- `src/modules/payments/purchase-domain.ts`: purchase retry/grant decisions.
- `src/modules/payments/purchases-repository.ts`: purchase repository interface (includes `PurchaseStatsSummary` and `getStatsSummary`).
- `src/modules/telegram/invoice-link.ts`: invoice request body builder, Telegram HTTP client, `answerPreCheckoutQuery`, `sendTelegramMessage` (JSON, supports inline/reply keyboards via `TelegramReplyMarkup`), `answerCallbackQuery`, `editMessageText` (inline keyboards only — Telegram limitation), `sendTelegramDocument` (multipart/form-data via global `FormData`/`Blob`).
- `src/modules/telegram/webhook-domain.ts`: webhook update type guards, validators, `isTelegramBotCommandUpdate`, `extractStartCommandPayload`.
- `src/modules/telegram/webhook-handler.ts`: real webhook handler (`/start` registration + UTM, `pre_checkout_query`, `successful_payment`); accepts optional `miniAppUrl`.
- `src/modules/seasons/seasons-domain.ts`: season types, leaderboard view types, training entry types, race run mode types, `computeSeasonStatus`, `canEnterSeason`, `canStartRace`.
- `src/modules/seasons/seasons-repository.ts`, `season-entries-repository.ts`, `season-training-entries-repository.ts`, `race-runs-repository.ts`: repository interfaces; `seasons-repository.ts` also exports `validateSeasonDateRange`, `CreateSeasonInput`, `UpdateSeasonInput`.
- `src/modules/seasons/season-atomic.ts`: result types for transactional season flows (ranked and training finish).

Admin module (`src/modules/admin/`):
- `admin-config.ts`: `PendingAdminAction` + `AdminPendingActionType` union, `parseAdminTelegramIds`, TTL/prize-share constants.
- `admin-session.ts`: `AdminView` union and `AdminViewBase` subset, `AdminSession` record, session TTL and periodic sweep (`sweepSessions`, `touchSessionExpiry`).
- `admin-webhook-domain.ts`: type guards `isAdminTextMessageUpdate`, `isAdminCallbackQueryUpdate`, `extractAdminFromId`.
- `admin-input.ts`: `AdminInputError`, strict parsers (`parseIntegerStrict`, `parseNonNegativeIntegerStrict`, `parsePositiveIntegerStrict`, `parsePrizePoolShareStrict`, `parseDateUtcStrict`, `parseBooleanStrict`), `escapeHtml`.
- `admin-user-lookup.ts`: `findUserByQuery(usersRepository, raw)` — finds user by `@username`, bare `username` or numeric Telegram ID.
- `admin-format.ts`: HTML-safe formatters for user/car/season/stats cards.
- `admin-keyboards.ts`: `ADMIN_BTN` label constants, reply-keyboard builders for all menus/detail cards/wizards/confirmations, and inline-keyboard builders for the three dynamic lists (`buildCarsInlineList`, `buildSeasonsInlineList`, `buildGiveCarInlineList`).
- `admin-view-renderer.ts`: `renderAdminView(deps, chatId, view)` — centralized renderer. For list views (`cars`, `seasons`, `give_car`) sends two messages: reply-keyboard summary + inline list (omitted when empty).
- `admin-users-export.ts`: `buildUsersExportWorkbook(users)` builds an in-memory XLSX via `exceljs` with a single bold, frozen `userId` column (one row per user); `buildUsersExportFileName(now)` makes a timestamped file name; exports `ADMIN_USERS_EXPORT_MIME`.
- `admin-commands.ts`: `AdminDeps` (alias of `AdminRendererDeps`), slash-command handlers (`handleUserCommand`, `handleCarsCommand`, `handleSeasonsCommand`, `handleStatsCommand`, `handleStartCommand`) returning `AdminCommandResult { view }` so the bot handler can seed the session.
- `admin-callbacks.ts`: `handleAdminCallback` — handles **only** inline callbacks from dynamic lists (`editcar`, `editseason`, `givecar`); acks the callback and renders the resulting detail view with its reply keyboard.
- `admin-bot-handler.ts`: `createAdminBotHandler(deps)` — top-level webhook dispatcher. Owns the `sessions` map; routes text by current view → button label → action (or wizard step when `pending` is set); delegates inline callbacks. Houses wizard logic (add car, create season, edit fields) and the users-export action (`exportUsersToExcel`).

Frontend-ish static asset:
- `public/miniapp/index.html`
- `public/miniapp/telegram-bridge.js`

Deployment:
- `Dockerfile.local`: Docker image for local development.
- `docker-compose.yml`: local environment with Mongo.
- `railway.toml`: Railway deployment config (Nixpacks).

Test fixtures:
- `fixtures/curls/`: shell scripts for testing all endpoints.
- `fixtures/initData.txt`: saved Telegram initData for testing (gitignored).
- `fixtures/token.txt`: saved JWT token (gitignored).

Docs/spec artifacts:
- `swagger.yaml`
- `UPDATES-12-04.md`
- `docs/12-04/`: session docs and prompts.
- `docs/20-04/`: training mode docs for frontend/client work.

## Data Model Snapshot

Collections used now:
- `users`
- `carsCatalog`
- `purchases`
- `seasons`
- `seasonEntries`
- `seasonTrainingEntries`
- `raceRuns`

Index definitions also include future/related collections:
- `paymentEvents`

User document shape, see `MongoUserDocument`:
- `userId`
- `telegramUserId`
- profile fields from Telegram
- `ownedCarIds`
- `selectedCarId`
- `garageRevision`
- `raceCoinsBalance`
- optional UTM fields: `utmSource`, `utmMedium`, `utmCampaign`, `utmContent`, `utmTerm` (set once via `setUtmIfNotSet`, never overwritten)
- timestamps

Purchase document shape, see `MongoPurchaseDocument`:
- `purchaseId`
- `userId`
- `telegramUserId`
- `bundleId`
- `status`
- `isActiveIntent`
- `invoicePayload`
- optional `invoiceUrl`
- `priceSnapshot`
- `coinsAmount`
- optional `telegramPaymentChargeId`
- `expiresAt`
- timestamps

Current purchase IDs:
- Generated as `pur_${randomUUID()}` in Mongo runtime.
- `invoicePayload` is equal to `purchaseId`.

Season document shape, see `MongoSeasonDocument`:
- `seasonId`, `title`, `mapId`, `entryFee`, `prizePoolShare`, `startsAt`, `endsAt`, timestamps

Season entry document shape, see `MongoSeasonEntryDocument`:
- `entryId`, `seasonId`, `userId`, `bestScore`, `totalRaces`, `entryFeeSnapshot`, timestamps

Race run document shape, see `MongoRaceRunDocument`:
- `raceId`, `seasonId`, `userId`, `seed`, optional `mode` (`"ranked" | "training"`; missing legacy value is treated as ranked), `score`, `status`, `startedAt`, optional `finishedAt`

Season training entry document shape, see `MongoSeasonTrainingEntryDocument`:
- `entryId`, `seasonId`, `userId`, `bestScore`, `totalRaces`, timestamps

Car catalog document shape, see `MongoCarDocument`:
- `carId`, `title`, `sortOrder`, `active`, `isStarterDefault`, `isPurchasable`, `price` (`{ currency: "RC", amount: number }`), timestamps

## Route Behavior Notes

`POST /v1/auth/telegram`:
- Body: `{ "initData": string }`
- Validates Telegram signature and max age (15 min).
- Upserts user by Telegram ID.
- Signs JWT for 12 hours.
- Returns profile with derived starter car state and `raceCoinsBalance`.
- Dev mode logs `initData` and full response body.

`GET /v1/garage`:
- Verifies JWT.
- Loads user by `sub`.
- Fetches active cars from `carsCatalog` collection sorted by `sortOrder`.
- Returns catalog cars with `owned` and `canBuy`, plus `raceCoinsBalance`.
- Uses derived starter state.
- Dev mode logs full garage response.

`POST /v1/purchases/coins-intents`:
- Verifies JWT.
- Body: `{ "bundleId": string }`
- Validates bundleId against race coins catalog.
- Reuses an active unexpired intent for the same user/bundle.
- Expires stale active intent before creating a new one.
- Creates a Mongo purchase intent with `bundleId` and `coinsAmount`.
- Calls Telegram `createInvoiceLink` with bundle invoice data.
- Stores returned `invoiceUrl`.
- Returns `{ purchaseId, status, invoiceUrl, expiresAt, price, coinsAmount }`.
- Dev mode logs request body and bundleId on not-found.

`POST /v1/purchases/buy-car`:
- Verifies JWT.
- Body: `{ "carId": string }`
- Validates car exists and is purchasable.
- Checks user has sufficient race coins balance.
- Atomically spends race coins and adds car to owned list.
- Returns `{ success, carId, raceCoinsBalance, garageRevision }`.

`POST /v1/telegram/webhook`:
- Verifies secret header.
- Passes raw body to webhook handler.
- `/start` command: upserts user from `message.from`; if payload present, parses base64url UTM and calls `setUtmIfNotSet`; replies with welcome message + optional `web_app` button.
- `pre_checkout_query`: finds purchase by invoicePayload, validates amount/currency, calls `answerPreCheckoutQuery(ok=true)`, sets status to `pre_checkout_approved`.
- `successful_payment`: finds purchase by invoicePayload, grants race coins to user, marks purchase as `granted`.
- Unsupported update types are silently ignored.

`POST /v1/admin/telegram/webhook` (only when `ADMIN_*` env vars are set):
- Verifies `x-telegram-bot-api-secret-token` against `ADMIN_WEBHOOK_SECRET` (timing-safe).
- Validates update shape via `isAdminCallbackQueryUpdate` / `isAdminTextMessageUpdate`.
- Checks `from.id` against `ADMIN_TELEGRAM_IDS` whitelist; unauthorized senders are silently ignored (warn logged).
- Commands: `/start`, `/menu` (open main menu), `/user <id|username>` (user card with action keyboard), `/cars` (catalog list), `/seasons` (seasons list), `/stats` (users count + top-10 UTM + purchases summary). Each command sets the session view to the corresponding screen.
- **Reply-keyboard flows** (text input matched against current view's button labels):
  - Main: `👤 Users` / `🚗 Cars` / `🏁 Seasons` / `📊 Stats`.
  - Users menu: `🔍 Find User` (wizard prompt), `📥 Export Users` (sends a single-column `userId` XLSX via `sendDocument`), `📈 Today UTM` (aggregates new users since start of UTC day by `utmSource`), `« Back`.
  - User detail: `➕ 100/500/Custom RC`, `➖ 100/500/Custom RC`, `🚗 Give Car` (opens give-car picker with inline list), `💰 Set Balance`, `« Back`.
  - Cars: `➕ Add Car` (multi-step wizard: carId → title → price → isPurchasable Yes/No via reply keyboard; `sortOrder` auto-assigned to `max+1`), `« Back`.
  - Car detail: `🟢/🔴 Activate/Deactivate`, `✏️ Set Price`, `✏️ Set Title`, `« Back`.
  - Seasons: `➕ Create Season` (multi-step: title → mapId → fee → prize share → starts → ends → `✅ Create` / `❌ Cancel` confirm), `« Back`.
  - Season detail: `✏️ Title/Map/Starts/Ends/Entry Fee`, `🏁 Finish Now` → confirm view (`✅ Finish Now` / `❌ Cancel`), `« Back`.
  - Stats: `« Back`.
- **Inline callbacks** (only three, all for dynamic item selection): `editcar:<carId>`, `editseason:<seasonId>`, `givecar:<userId>:<carId>`. After a callback, the handler sends a new message with the detail view's reply keyboard.
- All outgoing messages use `parse_mode: "HTML"` with escaped user content.
- Wizard `pending` has a 5-minute TTL; the session itself has a 30-minute TTL. All state lives in-memory only, lost on process restart.

`GET /v1/seasons`:
- Lists seasons with `endsAt > requestNow`, sorted by `startsAt`.
- Each item includes computed `status`, `entered`, `bestScore`, `totalRaces` for the JWT user.
- Each item also includes `training: { bestScore, totalRaces }`, where `bestScore` is `null` and `totalRaces` is `0` until the user finishes at least one training race in that season.

`GET /v1/seasons/{seasonId}`:
- Returns one season by id (including finished) with the same ranked participation fields plus the same personal `training` block.

`POST /v1/seasons/{seasonId}/enter`:
- Requires season `active` at `requestNow`.
- Charges `entryFee` and inserts `seasonEntries` in one transaction; `409 ALREADY_ENTERED` if already joined; `422 INSUFFICIENT_BALANCE` if spend would fail.

`POST /v1/seasons/{seasonId}/races/start`:
- Requires `active` season and existing season entry; creates `raceRuns` with `started`, `mode: "ranked"` and returns `{ raceId, seed }`.

`POST /v1/seasons/{seasonId}/races/finish`:
- Body `{ raceId, seed, score }`; validates ownership, season match, seed, `started` status, and `mode: "ranked"`; completes run and updates entry in one transaction; `409 RACE_ALREADY_FINISHED` if already done.

`POST /v1/seasons/{seasonId}/training-races/start`:
- Requires `active` season only; does **not** require `enter` and does **not** spend race coins.
- Creates `raceRuns` with `started`, `mode: "training"` and returns `{ raceId, seed }`.

`POST /v1/seasons/{seasonId}/training-races/finish`:
- Body `{ raceId, seed, score }`; validates ownership, season match, seed, `started` status, and `mode: "training"`.
- Completes the run and upserts/updates `seasonTrainingEntries` in one transaction.
- Returns `{ raceId, score, isNewBest, bestScore }` for the training highscore only; never affects ranked leaderboard or ranked season progress.

`GET /v1/seasons/{seasonId}/training-highscore`:
- Returns the caller's personal training progress for that season as `{ seasonId, bestScore, totalRaces }`.
- If the player has no finished training runs in that season yet, returns `bestScore: null` and `totalRaces: 0`.

`GET /v1/seasons/{seasonId}/leaderboard`:
- Query `limit` (default 100, max 100); competition ranks on `bestScore` with stable tie-break (`createdAt`, `userId`); includes `currentPlayer` when entered (even outside top N).

## Catalog Snapshot

Car catalog is stored in MongoDB (`carsCatalog` collection) and managed at runtime.
On first server startup, if the collection is empty, it is seeded from `PHASE_0_CAR_CATALOG` in `src/modules/cars-catalog/cars-catalog.ts`.
Subsequent starts skip seeding — changes made via admin are preserved.

Initial seed (prices in race coins):
- `car0`: active, starter default, not purchasable, price `0 RC`.
- `car1`: active, purchasable, price `1 RC`.
- `car2`: active, purchasable, price `50 RC`.
- `car3`: active, purchasable, price `100 RC`.
- `car4`: active, purchasable, price `250 RC`.
- `car5`: active, purchasable, price `500 RC`.

Defined in `src/modules/race-coins/race-coins-catalog.ts`.

Race Coins Bundles (purchased with Telegram Stars):
- `rc_bundle_100`: 100 coins, price `1 XTR`.
- `rc_bundle_300`: 300 coins, price `1 XTR`.
- `rc_bundle_500`: 500 coins, price `1 XTR`.
- `rc_bundle_1000`: 1000 coins, price `1 XTR`.

## Testing with curl scripts

All test scripts are in `fixtures/curls/`. They work against Railway by default; pass `http://localhost:3000` as first argument for local.

### JWT token flow

`initData` from Telegram expires in 15 minutes. JWT token lives 12 hours. The workflow:

1. Open Mini App in Telegram (generates fresh `initData` visible in Railway logs as `auth initData received`).
2. Copy `initData` value into `fixtures/initData.txt`.
3. Run `bash fixtures/curls/02-auth.sh` — authenticates and saves JWT to `fixtures/token.txt`.
4. All other scripts read token from `fixtures/token.txt` automatically.

Alternatively, copy `accessToken` from Railway logs (`auth response` line) directly into `fixtures/token.txt`.

Both `initData.txt` and `token.txt` are gitignored.

### Available scripts

| Script | What it does | Arguments |
|--------|-------------|-----------|
| `01-health.sh` | `GET /health` | |
| `02-auth.sh` | Auth via initData, saves token | `[base_url]` |
| `03-garage.sh` | Get garage + balance | |
| `04-buy-coins-bundle.sh` | Buy race coins bundle | `[bundleId]` (default: `rc_bundle_50`) |
| `05-buy-car.sh` | Buy car with race coins | `[carId]` (default: `car1`) |
| `06-buy-coins-bundle-invalid.sh` | Test invalid bundleId errors | |
| `07-buy-car-errors.sh` | Test buy-car error cases | |
| `08-no-auth.sh` | Test all routes without JWT | |
| `09-add-coins-manual.sh` | Add coins via Mongo directly | `[amount] [userId]` |
| `10-full-flow.sh` | Full flow: auth → coins → buy car | |
| `11-check-balance.sh` | Quick balance check | `[base_url]` |
| `19-seed-season.sh` | Insert `season_test_1` into Mongo via `mongosh` | env `MONGO_URI` |
| `20-seasons-list.sh` | `GET /v1/seasons` | `[base_url]` |
| `21-season-enter.sh` | `POST /v1/seasons/:id/enter` | `[base_url] [seasonId]` |
| `22-race-start.sh` | `POST .../races/start` | `[base_url] [seasonId]` |
| `23-race-finish.sh` | `POST .../races/finish` | `[base_url] [seasonId] [raceId] [seed] [score]` |
| `24-leaderboard.sh` | `GET .../leaderboard` | `[base_url] [seasonId] [limit]` |
| `25-season-full-flow.sh` | Seed → auth → coins → enter → start → finish → leaderboard | `[base_url] [seasonId]` |

### Usage examples

```bash
# Against Railway (default)
bash fixtures/curls/02-auth.sh
bash fixtures/curls/11-check-balance.sh
bash fixtures/curls/05-buy-car.sh car1

# Against local Docker
bash fixtures/curls/02-auth.sh http://localhost:3000
bash fixtures/curls/03-garage.sh

# Add coins manually for testing (local Docker only)
bash fixtures/curls/09-add-coins-manual.sh 100

# Full end-to-end flow
bash fixtures/curls/10-full-flow.sh
```

## Agent Work Rules For This Repo

- Prefer small, focused changes.
- Keep route behavior in `src/app.ts` unless adding runtime integration.
- Keep persistence behind repository interfaces.
- Run at least `npm run typecheck` before claiming completion.
- Run `npm run build` when touching runtime, TypeScript config, Docker, or package scripts.
- Run `docker compose config` after changing Compose.
- Keep OpenAPI in `swagger.yaml` aligned with implemented routes.
- Do not assume Mongo contains starter ownership unless code persisted it.
- Tests are currently deleted. Do not create or run tests unless asked.
- **Project code style is strict:**
  - Do not place narrative/heading comments in the code. JSDoc on public methods is fine only when the surrounding module already uses JSDoc.
  - Do not cast to `any` or `unknown`. Use proper types, generic constraints (`<T extends Document>` for Mongo aggregate), and type guards.
  - Prefer repository-level invariant guards (e.g. `addRaceCoins`/`setRaceCoinsBalance` reject negatives) over UI-only validation.
  - All admin-facing text uses `parse_mode: "HTML"` and **must** be HTML-escaped via `escapeHtml()` from `src/modules/admin/admin-input.ts`.

## Known Environment Notes

- Directory name contains spaces and Cyrillic characters. Quote paths in shell commands.
- Local Docker uses `Dockerfile.local` (referenced in `docker-compose.yml`).
- Local Mongo in Compose runs as replica set `rs0` (see `mongo-init` service) so multi-document transactions used by seasons work.
- Railway uses Nixpacks (no Dockerfile). Env vars set via Railway CLI.
- `NODE_ENV=production` is auto-set by Railway; config maps it to `prod`.

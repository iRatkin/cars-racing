# Agent Context: Telegram Miniapp Cars Phase 0

This file is optimized for future coding agents. Prefer it over rediscovering the project from scratch.

## System Intent

Build a Phase 0 Telegram Mini App backend for a simple cars game/shop with an internal **race coins** currency and **battle seasons** (time-limited solo races, server-issued seeds, per-season leaderboards).

Target behavior:
- Telegram Mini App sends signed `initData`.
- API validates `initData` with `BOT_TOKEN`.
- API creates or updates an app user.
- User always sees a starter car.
- User can view garage/catalog state and their race coins balance.
- User can purchase race coins bundles for Telegram Stars via invoice flow.
- User can buy cars with race coins (no Telegram Stars involved).
- Users can enter battle seasons for a configurable race-coins entry fee, run solo races with a server `seed`, submit scores, and view per-season leaderboards (competition ranking).
- API asks Telegram Bot API for an invoice link when purchasing race coins bundles.
- Telegram POSTs payment webhook updates (`pre_checkout_query`, `successful_payment`) to the backend.
- Webhook handler approves pre-checkout, grants race coins on successful payment.
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

Battle seasons:
- Season documents live in Mongo (`seasons`); `status` is always derived from `startsAt` / `endsAt` and a single request clock (`requestNow`), not stored.
- Entering a season charges `entryFee` race coins and creates a `seasonEntries` row in one Mongo **multi-document transaction** (requires replica set; local Compose runs Mongo as single-node replica set `rs0`).
- Finishing a race moves `raceRuns` to `finished` and updates `seasonEntries` (`totalRaces`, `bestScore` via `$max`) in one transaction.
- `POST /v1/seasons/:seasonId/races/start` creates a `raceRuns` row with `started` and returns `{ raceId, seed }`; finish requires matching `raceId`, `seed`, and `started` status.

Starter car detail:
- Users are inserted into Mongo with `ownedCarIds: []`, `garageRevision: 0`, and `raceCoinsBalance: 0`.
- Routes call `ensureStarterCarState()` and return derived starter ownership.
- Current routes do not persist that derived starter state back to Mongo.

## Tech Stack

- Node.js 22
- TypeScript ESM (`"type": "module"`, `moduleResolution: "NodeNext"`)
- Fastify 5
- `@fastify/jwt`
- MongoDB driver 6
- Zod
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
- `NODE_ENV`: `dev`, `stage`, `prod` (also accepts `development`, `staging`, `production`); default `dev`
- `PORT`: integer; default `3000`

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
- `GET /v1/seasons/{seasonId}/leaderboard`
- `POST /v1/telegram/webhook`

Auth:
- `GET /v1/garage` requires `Authorization: Bearer <jwt>`.
- `POST /v1/purchases/coins-intents` requires `Authorization: Bearer <jwt>`.
- `POST /v1/purchases/buy-car` requires `Authorization: Bearer <jwt>`.
- All `/v1/seasons` routes require `Authorization: Bearer <jwt>`.
- Telegram webhook requires `x-telegram-bot-api-secret-token`.

Common error codes are documented in `swagger.yaml`.

## Important Files

Core API:
- `src/app.ts`: declares Fastify routes and response behavior.
- `src/runtime.ts`: creates Mongo repositories (users, purchases, seasons, season entries, race runs), Telegram invoice client, webhook handler, passes `MongoClient` for season transactions, then calls `buildApp()`.
- `src/server.ts`: loads env, connects Mongo, creates indexes, listens on `0.0.0.0`.
- `src/config/config.ts`: env parsing and validation (accepts NODE_ENV aliases).

Mongo:
- `src/infra/mongo/users-repository.ts`: Mongo implementation of `UsersRepository`.
- `src/infra/mongo/purchases-repository.ts`: Mongo implementation of `PurchasesRepository`.
- `src/infra/mongo/seasons-repository.ts`: Mongo `SeasonsRepository`.
- `src/infra/mongo/season-entries-repository.ts`: Mongo `SeasonEntriesRepository`.
- `src/infra/mongo/race-runs-repository.ts`: Mongo `RaceRunsRepository`.
- `src/infra/mongo/season-mongo-transactions.ts`: transactional season enter and race finish.
- `src/infra/mongo/indexes.ts`: index definitions and `ensureMongoIndexes()`.

Domain:
- `src/modules/auth/telegram-init-data.ts`: Telegram Mini App initData validation.
- `src/modules/users/starter-car.ts`: derived starter car state.
- `src/modules/cars-catalog/cars-catalog.ts`: hardcoded Phase 0 car catalog with prices in race coins (RC).
- `src/modules/race-coins/race-coins-catalog.ts`: race coins bundles available for purchase with Telegram Stars.
- `src/modules/garage/garage-view.ts`: garage projection.
- `src/modules/payments/purchase-domain.ts`: purchase retry/grant decisions.
- `src/modules/payments/purchases-repository.ts`: purchase repository interface.
- `src/modules/telegram/invoice-link.ts`: invoice request body builder, Telegram HTTP client, `answerPreCheckoutQuery`.
- `src/modules/telegram/webhook-domain.ts`: webhook update type guards and validators.
- `src/modules/telegram/webhook-handler.ts`: real webhook handler (pre_checkout_query + successful_payment).
- `src/modules/seasons/seasons-domain.ts`: season types, leaderboard view types, `computeSeasonStatus`, `canEnterSeason`, `canStartRace`.
- `src/modules/seasons/seasons-repository.ts`, `season-entries-repository.ts`, `race-runs-repository.ts`: repository interfaces.
- `src/modules/seasons/season-atomic.ts`: result types for transactional season flows.

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

## Data Model Snapshot

Collections used now:
- `users`
- `purchases`
- `seasons`
- `seasonEntries`
- `raceRuns`

Index definitions also include future/related collections:
- `carsCatalog`
- `paymentEvents`

User document shape, see `MongoUserDocument`:
- `userId`
- `telegramUserId`
- profile fields from Telegram
- `ownedCarIds`
- `selectedCarId`
- `garageRevision`
- `raceCoinsBalance`
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
- `raceId`, `seasonId`, `userId`, `seed`, `score`, `status`, `startedAt`, optional `finishedAt`

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
- Returns active catalog cars with `owned` and `canBuy`, plus `raceCoinsBalance`.
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
- `pre_checkout_query`: finds purchase by invoicePayload, validates amount/currency, calls `answerPreCheckoutQuery(ok=true)`, sets status to `pre_checkout_approved`.
- `successful_payment`: finds purchase by invoicePayload, grants race coins to user, marks purchase as `granted`.
- Unsupported update types are silently ignored.

`GET /v1/seasons`:
- Lists seasons with `endsAt > requestNow`, sorted by `startsAt`.
- Each item includes computed `status`, `entered`, `bestScore`, `totalRaces` for the JWT user.

`GET /v1/seasons/{seasonId}`:
- Returns one season by id (including finished) with the same participation fields.

`POST /v1/seasons/{seasonId}/enter`:
- Requires season `active` at `requestNow`.
- Charges `entryFee` and inserts `seasonEntries` in one transaction; `409 ALREADY_ENTERED` if already joined; `422 INSUFFICIENT_BALANCE` if spend would fail.

`POST /v1/seasons/{seasonId}/races/start`:
- Requires `active` season and existing season entry; creates `raceRuns` with `started` and returns `{ raceId, seed }`.

`POST /v1/seasons/{seasonId}/races/finish`:
- Body `{ raceId, seed, score }`; validates ownership, season match, seed, `started` status; completes run and updates entry in one transaction; `409 RACE_ALREADY_FINISHED` if already done.

`GET /v1/seasons/{seasonId}/leaderboard`:
- Query `limit` (default 100, max 100); competition ranks on `bestScore` with stable tie-break (`createdAt`, `userId`); includes `currentPlayer` when entered (even outside top N).

## Catalog Snapshot

Defined in `src/modules/cars-catalog/cars-catalog.ts`.

Cars (prices in race coins):
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

## Known Environment Notes

- Directory name contains spaces and Cyrillic characters. Quote paths in shell commands.
- Local Docker uses `Dockerfile.local` (referenced in `docker-compose.yml`).
- Local Mongo in Compose runs as replica set `rs0` (see `mongo-init` service) so multi-document transactions used by seasons work.
- Railway uses Nixpacks (no Dockerfile). Env vars set via Railway CLI.
- `NODE_ENV=production` is auto-set by Railway; config maps it to `prod`.

# Agent Context: Telegram Miniapp Cars Phase 0

This file is optimized for future coding agents. Prefer it over rediscovering the project from scratch.

## System Intent

Build a Phase 0 Telegram Mini App backend for a simple cars game/shop.

Target behavior:
- Telegram Mini App sends signed `initData`.
- API validates `initData` with `BOT_TOKEN`.
- API creates or updates an app user.
- User always sees a starter car.
- User can view garage/catalog state.
- User can create a Telegram Stars purchase intent for `second_car`.
- API asks Telegram Bot API for an invoice link.
- Telegram can POST payment webhook updates to the backend.
- MongoDB is the persistence layer.

## Current Reality

Runtime exists and starts:
- Entry point: `src/server.ts`
- App factory: `src/app.ts`
- Mongo wiring factory: `src/runtime.ts`
- Docker: `Dockerfile`
- Compose: `docker-compose.yml`
- OpenAPI: `swagger.yaml`

Important current limitation:
- `POST /v1/telegram/webhook` is wired at runtime with a default no-op handler in `src/runtime.ts`.
- Domain validation helpers for Telegram webhook updates exist in `src/modules/telegram/webhook-domain.ts`.
- There is not yet a real payment-processing handler that approves pre-checkout, marks purchases paid/granted, or adds the purchased car to the user.

Starter car detail:
- Users are inserted into Mongo with `ownedCarIds: []` and `garageRevision: 0`.
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
- Docker Compose with Mongo 7

## Commands

Install:

```bash
npm install
```

Run all tests:

```bash
npm test
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
- `NODE_ENV`: `dev`, `stage`, or `prod`; default `dev`
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
- `POST /v1/purchases/car-intents`
- `POST /v1/telegram/webhook`

Auth:
- `GET /v1/garage` requires `Authorization: Bearer <jwt>`.
- `POST /v1/purchases/car-intents` requires `Authorization: Bearer <jwt>`.
- Telegram webhook requires `x-telegram-bot-api-secret-token`.

Common error codes are documented in `swagger.yaml`.

## Important Files

Core API:
- `src/app.ts`: declares Fastify routes and response behavior.
- `src/runtime.ts`: creates Mongo repositories and Telegram invoice client, then calls `buildApp()`.
- `src/server.ts`: loads env, connects Mongo, creates indexes, listens on `0.0.0.0`.
- `src/config/config.ts`: env parsing and validation.

Mongo:
- `src/infra/mongo/users-repository.ts`: Mongo implementation of `UsersRepository`.
- `src/infra/mongo/purchases-repository.ts`: Mongo implementation of `PurchasesRepository`.
- `src/infra/mongo/indexes.ts`: index definitions and `ensureMongoIndexes()`.

Domain:
- `src/modules/auth/telegram-init-data.ts`: Telegram Mini App initData validation.
- `src/modules/users/starter-car.ts`: derived starter car state.
- `src/modules/cars-catalog/cars-catalog.ts`: hardcoded Phase 0 catalog.
- `src/modules/garage/garage-view.ts`: garage projection.
- `src/modules/payments/purchase-domain.ts`: purchase retry/grant decisions.
- `src/modules/payments/purchases-repository.ts`: purchase repository interface.
- `src/modules/telegram/invoice-link.ts`: invoice request body builder and Telegram HTTP client.
- `src/modules/telegram/webhook-domain.ts`: webhook update type guards and validators.

Frontend-ish static asset:
- `public/miniapp/index.html`
- `public/miniapp/telegram-bridge.js`

Tests:
- `tests/app/*`: route/runtime tests.
- `tests/infra/mongo/*`: Mongo repository/index tests.
- `tests/modules/*`: pure domain tests.
- `tests/miniapp/*`: Telegram bridge tests.

Docs/spec artifacts:
- `phase-0-telegram-miniapp-mvp-requirements.md`
- `phase-0-telegram-miniapp-plan.md`
- `swagger.yaml`

## Data Model Snapshot

Collections used now:
- `users`
- `purchases`

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
- timestamps

Purchase document shape, see `MongoPurchaseDocument`:
- `purchaseId`
- `userId`
- `telegramUserId`
- `carId`
- `status`
- `isActiveIntent`
- `invoicePayload`
- optional `invoiceUrl`
- `priceSnapshot`
- `expiresAt`
- timestamps

Current purchase IDs:
- Generated as `pur_${randomUUID()}` in Mongo runtime.
- `invoicePayload` is equal to `purchaseId`.

## Route Behavior Notes

`POST /v1/auth/telegram`:
- Body: `{ "initData": string }`
- Validates Telegram signature and max age.
- Upserts user by Telegram ID.
- Signs JWT for 12 hours.
- Returns profile with derived starter car state.

`GET /v1/garage`:
- Verifies JWT.
- Loads user by `sub`.
- Returns active catalog cars with `owned` and `canBuy`.
- Uses derived starter state.

`POST /v1/purchases/car-intents`:
- Verifies JWT.
- Body: `{ "carId": string }`
- Only `second_car` is purchasable in Phase 0.
- Reuses an active unexpired intent for the same user/car.
- Expires stale active intent before creating a new one.
- Creates a Mongo purchase intent.
- Calls Telegram `createInvoiceLink`.
- Stores returned `invoiceUrl`.

`POST /v1/telegram/webhook`:
- Verifies secret header.
- Passes raw body to injected handler.
- Runtime default handler does nothing and returns `{ ok: true }`.

## Catalog Snapshot

Defined in `src/modules/cars-catalog/cars-catalog.ts`.

Cars:
- `starter_car`: active, starter default, not purchasable, price `0 XTR`.
- `second_car`: active, purchasable, price `250 XTR`.

## Agent Work Rules For This Repo

- Prefer small, focused changes.
- Keep route behavior in `src/app.ts` unless adding runtime integration.
- Keep persistence behind repository interfaces.
- Add or update tests before behavior changes when practical.
- Run at least `npm run typecheck` and `npm test` before claiming completion.
- Run `npm run build` when touching runtime, TypeScript config, Docker, or package scripts.
- Run `docker compose config` after changing Compose.
- Keep OpenAPI in `swagger.yaml` aligned with implemented routes.
- Do not assume payment webhook processing is complete.
- Do not assume Mongo contains starter ownership unless code persisted it.

## Known Environment Notes

- This workspace may not be a git repository.
- `rg` may be unavailable in this environment; use `find`/`sed` if needed.
- Directory name contains spaces and Cyrillic characters. Quote paths in shell commands.

# Nicknames Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add public player nicknames with free first manual setup, paid rename, case-insensitive uniqueness, and Unity-facing API/docs.

**Architecture:** Store `nick` and `nickNormalized` on `users`, enforce uniqueness with a partial Mongo index, and keep all nickname invariants behind the users repository. Public API serializes `nick` everywhere Unity should display a player name, while admin flows keep using Telegram fields.

**Tech Stack:** Node.js 22, TypeScript ESM, Fastify 5, MongoDB driver 6, Zod, OpenAPI YAML.

---

### Task 1: Config And Nickname Domain

**Files:**
- Modify: `src/config/config.ts`
- Create: `src/modules/users/nickname.ts`
- Modify: `docker-compose.yml`

- [ ] Add `nickChangePriceRaceCoins: number` to `AppConfig`.
- [ ] Parse optional `NICK_CHANGE_PRICE_RC` as a non-negative integer with default `100`.
- [ ] Add the compose default `NICK_CHANGE_PRICE_RC=100`.
- [ ] Create nickname helpers:
  - `isValidNick(nick: string): boolean`
  - `normalizeNick(nick: string): string`
  - `buildPublicNick(user): string`
  - `getAutomaticNickCandidates(input): string[]`

### Task 2: Users Repository Nickname Operations

**Files:**
- Modify: `src/modules/users/users-repository.ts`
- Modify: `src/infra/mongo/users-repository.ts`
- Modify: `src/infra/mongo/indexes.ts`

- [ ] Extend `AppUser` and `MongoUserDocument` with `nick?: string` and `nickNormalized?: string`.
- [ ] Extend `UsersRepository` with:
  - `getUserByNickNormalized(nickNormalized: string): Promise<AppUser | null>`
  - `setInitialNick(userId: string, nick: string, nickNormalized: string): Promise<AppUser | null>`
  - `changeNickWithRaceCoins(userId: string, nick: string, nickNormalized: string, price: number): Promise<AppUser | null>`
- [ ] Map nickname fields in `mapUserDocument`.
- [ ] During `upsertTelegramUser`, preserve existing `nick`; for users without `nickNormalized`, try valid automatic Telegram candidates and set the first available unique candidate.
- [ ] Add unique partial index `users_nickNormalized_unique` on `nickNormalized`.

### Task 3: Player Profile Nick Endpoint

**Files:**
- Modify: `src/app.ts`

- [ ] Add body schema for `{ nick: string }` with the nickname rules.
- [ ] Add `PUT /v1/profile/nick` under authenticated player routes.
- [ ] Return `400 INVALID_NICK`, `401 UNAUTHORIZED`, `404 USER_NOT_FOUND`, `409 NICK_ALREADY_TAKEN`, and `422 INSUFFICIENT_BALANCE`.
- [ ] Make same-normalized-name updates idempotent and free.
- [ ] Charge `config.nickChangePriceRaceCoins` only when changing an existing persisted nickname.
- [ ] Return `{ nick, raceCoinsBalance, nickChangePrice }`.

### Task 4: Public Response Shape

**Files:**
- Modify: `src/app.ts`
- Modify: `src/modules/seasons/seasons-domain.ts`

- [ ] Add `profile.nick` to `POST /v1/auth/telegram`.
- [ ] Replace leaderboard `username` and `firstName` output with `nick`.
- [ ] Use `buildPublicNick` fallback so Unity always receives a displayable nickname.

### Task 5: OpenAPI And Agent Docs

**Files:**
- Modify: `swagger.yaml`
- Modify: `AGENTS.md`
- Modify: `docs/27-04/UPDATES-27-04-nicknames-unity.md`

- [ ] Document `PUT /v1/profile/nick`.
- [ ] Add `nick` to `UserProfile` and `LeaderboardEntry`.
- [ ] Add nickname error codes to the common error enum.
- [ ] Document `NICK_CHANGE_PRICE_RC`.
- [ ] Keep Unity note aligned with final response shape and error behavior.

### Task 6: Verification

**Files:**
- No file edits.

- [ ] Run `npm run typecheck`.
- [ ] Run `npm run build`.
- [ ] Do not add tests unless explicitly requested; the repo instructions say tests are currently deleted.

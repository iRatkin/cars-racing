# Nickname Support Design

## Goal

Add a public game nickname for each user so Unity can display one stable player-facing name in profile and statistics responses. A player can set an initial nickname for free if they do not already have one, then change an existing nickname for a configurable race-coins fee.

Admin bot screens keep using Telegram identity fields and are outside this change.

## Nickname Rules

Nicknames must be 3 to 20 characters long and contain only Latin letters, digits, or underscore. Spaces and other symbols are invalid.

Uniqueness is case-insensitive. The API stores the display value as `nick` and stores `nickNormalized` as the lowercase uniqueness key. For example, `Ivan_42` is displayed as entered, while `ivan_42` is used for duplicate checks.

## Data Model

The `users` collection gains:

- `nick?: string`
- `nickNormalized?: string`

New and updated users should get a persisted nickname when a valid automatic Telegram candidate exists and the document does not already have one:

1. Telegram `username`
2. Telegram `firstName`

Automatic candidates use the same nickname rules. If the preferred Telegram value contains unsupported characters or is already taken, registration tries the next Telegram candidate. If no Telegram candidate is valid and available, the user remains without a persisted nickname.

Public responses still return a single `nick` value for every user. If `nick` is missing, the serializer returns `p_<telegramUserId>` as a non-persisted display fallback. This fallback does not reserve the nickname and does not make the user's first manual nickname update paid.

An automatically persisted Telegram nickname counts as the user's existing nickname. Changing it later is a paid rename.

A unique partial index on `nickNormalized` enforces cross-user uniqueness for users that have a nickname.

## API Contract

Add `PUT /v1/profile/nick`.

Request:

```json
{ "nick": "Ivan_42" }
```

Response:

```json
{
  "nick": "Ivan_42",
  "raceCoinsBalance": 900,
  "nickChangePrice": 100
}
```

Behavior:

- Requires the same JWT bearer auth as other player routes.
- Returns `400 INVALID_NICK` when the body is missing or violates nickname rules.
- Returns `404 USER_NOT_FOUND` when the JWT user no longer exists.
- Returns `409 NICK_ALREADY_TAKEN` when another user owns the normalized nickname.
- If the user has no current `nick`, setting it is free.
- If the user already has a different `nick`, changing it costs `NICK_CHANGE_PRICE_RC`.
- If the user already has the same normalized nickname, the endpoint is idempotent and returns success without spending coins.
- Returns `422 INSUFFICIENT_BALANCE` when a paid rename cannot be charged.

`NICK_CHANGE_PRICE_RC` is an optional env var parsed as a non-negative integer. Default is `100`.

## Public Responses

`POST /v1/auth/telegram` includes `profile.nick`.

Public statistics responses use `nick` instead of exposing Telegram name fields. For Phase 0 this updates `GET /v1/seasons/{seasonId}/leaderboard` entries and `currentPlayer` to include:

```json
{
  "rank": 1,
  "userId": "usr_123456789",
  "nick": "Ivan_42",
  "bestScore": 1200,
  "totalRaces": 4
}
```

The existing Telegram `username` and `firstName` fields are no longer needed in leaderboard responses. Admin bot formatters and admin lookup continue to use Telegram fields.

## Implementation Shape

Create a small nickname domain module with validation, normalization, and fallback candidate helpers.

Extend `UsersRepository` with repository-level methods for nickname work:

- lookup by normalized nick
- set free initial nick
- paid nick change with race-coins guard

Mongo implements those operations atomically with `findOneAndUpdate` filters. Duplicate key errors from the unique index are translated by the route into `NICK_ALREADY_TAKEN`.

Registration uses repository behavior that preserves an existing nick and initializes one for users that do not have it. The main `/start` webhook path and Mini App auth path both go through `upsertTelegramUser`, so both receive the same behavior.

## OpenAPI And Docs

Update `swagger.yaml` with the new endpoint, new error codes, `nick` in `UserProfile`, and `nick` in `LeaderboardEntry`.

Update `AGENTS.md` and environment notes with `NICK_CHANGE_PRICE_RC`.

## Verification

Run `npm run typecheck` before completion. Run `npm run build` because this touches runtime config and TypeScript application wiring. Tests are not added unless requested, following the repo instruction that tests are currently deleted.

# Training Mode And Seasonal Practice Highscore Design

## Goal

Add a training mode for the current active season map that:

- is available to any authenticated player while the season is active;
- does not require season entry or race-coins payment;
- does not affect the ranked leaderboard or ranked season progress;
- stores a separate personal highscore and total training runs for each season.

## Current Constraints

- Ranked season access is modeled through `seasonEntries` and paid entry.
- Ranked race results are persisted through `raceRuns` plus `seasonEntries` updates in one Mongo transaction.
- Public season routes currently expose only ranked participation state and ranked leaderboard data.
- Existing `raceRuns` documents do not distinguish ranked and training runs.

## Chosen Approach

Use a separate training progression model while reusing the existing race-run journal:

- keep existing ranked endpoints and ranked persistence unchanged in behavior;
- add a `mode` discriminator to `raceRuns` with values `"ranked"` and `"training"`;
- add a new `seasonTrainingEntries` collection for per-user seasonal training progress;
- add dedicated training endpoints for race start, race finish, and personal highscore lookup;
- expose training summary inside season list/detail responses so the client can render ranked and training state together.

This keeps ranked and training concerns isolated without duplicating the race start/finish flow.

## API Changes

### Existing Ranked API

These endpoints remain ranked-only and keep their current contract:

- `POST /v1/seasons/:seasonId/races/start`
- `POST /v1/seasons/:seasonId/races/finish`
- `GET /v1/seasons/:seasonId/leaderboard`

### New Training API

Add the following authenticated endpoints:

- `POST /v1/seasons/:seasonId/training-races/start`
- `POST /v1/seasons/:seasonId/training-races/finish`
- `GET /v1/seasons/:seasonId/training-highscore`

#### `POST /v1/seasons/:seasonId/training-races/start`

Behavior:

- validates bearer token;
- validates `seasonId`;
- loads the season and requires `status === "active"`;
- does not require `enter`;
- creates a `raceRuns` document with `mode: "training"`;
- returns `{ raceId, seed }`.

Errors:

- `400 SEASON_ID_REQUIRED`
- `401 UNAUTHORIZED`
- `404 SEASON_NOT_FOUND`
- `422 SEASON_NOT_ACTIVE`

#### `POST /v1/seasons/:seasonId/training-races/finish`

Request body stays aligned with ranked finish:

```json
{
  "raceId": "race_...",
  "seed": "server-seed",
  "score": 123
}
```

Behavior:

- validates bearer token, `seasonId`, and request body;
- loads `raceRuns` by `raceId`;
- verifies ownership, season match, submitted `seed`, and `status === "started"`;
- verifies the run belongs to `mode: "training"`;
- does not require a second `active` check once the run has already been started;
- updates the run to `finished`;
- upserts the player's `seasonTrainingEntries` row for that season;
- increments `totalRaces`;
- updates `bestScore` via `$max`;
- returns `{ raceId, score, isNewBest, bestScore }`.

Errors:

- `400 SEASON_ID_REQUIRED`, body validation error, `RACE_SEASON_MISMATCH`, `INVALID_SEED`
- `401 UNAUTHORIZED`
- `403 RACE_FORBIDDEN`
- `404 SEASON_NOT_FOUND`, `RACE_NOT_FOUND`
- `409 RACE_ALREADY_FINISHED`

#### `GET /v1/seasons/:seasonId/training-highscore`

Behavior:

- validates bearer token and `seasonId`;
- verifies the season exists;
- returns the caller's personal training progress for that season.

Response:

```json
{
  "seasonId": "season_test_1",
  "bestScore": null,
  "totalRaces": 0
}
```

If the player already has training progress, `bestScore` becomes an integer.

## Season Response Changes

Extend season list items and season detail with a separate training block:

```json
{
  "training": {
    "bestScore": null,
    "totalRaces": 0
  }
}
```

Ranked fields stay unchanged:

- `entered`
- `bestScore`
- `totalRaces`

Training fields are additive and represent only the personal seasonal training highscore state.

## Data Model Changes

### `raceRuns`

Add:

- `mode: "ranked" | "training"`

Rules:

- all newly created ranked runs write `mode: "ranked"`;
- all newly created training runs write `mode: "training"`;
- old documents without `mode` are treated as ranked reads for backward compatibility.

### `seasonTrainingEntries`

New collection:

- `entryId`
- `seasonId`
- `userId`
- `bestScore`
- `totalRaces`
- `createdAt`
- `updatedAt`

Semantics:

- one row per `seasonId + userId`;
- created lazily on the player's first completed training race in that season;
- retained after season end for historical lookup.

## Persistence And Transactions

### Ranked Flow

No behavior change:

- ranked start still requires an existing `seasonEntries` row;
- ranked finish still updates `raceRuns` and `seasonEntries` together in one transaction.

### Training Flow

Training finish gets a new dedicated Mongo transaction:

- update `raceRuns` from `started` to `finished`;
- insert `seasonTrainingEntries` if absent;
- increment `totalRaces`;
- update `bestScore` with `$max`.

This preserves atomicity between the completed run and the user's stored training highscore.

## Repository Changes

### `RaceRunsRepository`

- extend `CreateRaceRunInput` with `mode`;
- extend `RaceRun` with `mode`;
- persist and read the new field in Mongo implementation;
- preserve backward compatibility by defaulting missing stored `mode` to `"ranked"` in the mapper.

### New `SeasonTrainingEntriesRepository`

Provide repository operations parallel to the minimum needed for training:

- `findEntry(seasonId, userId)`
- `createEntry(...)`
- `count` is not required for Phase 0
- no public leaderboard methods are required

Mongo implementation will support the atomic finish helper and normal lookups for season list/detail and personal highscore.

## Index Changes

Add indexes for `seasonTrainingEntries`:

- unique `entryId`
- unique `{ seasonId, userId }`
- non-unique `{ seasonId, bestScore: -1, createdAt: 1, userId: 1 }`

The leaderboard-style index is optional for current personal-highscore-only reads, but worth adding now because:

- it keeps the collection aligned with ranked storage shape;
- it leaves room for future training leaderboard/reporting without another index rollout.

Existing `raceRuns` indexes remain valid. No migration is required for old rows.

## OpenAPI Changes

Update `swagger.yaml` to:

- document the two new training race endpoints and the new personal highscore endpoint;
- extend `RaceStartResponse` and `RaceFinishResponse` reuse where possible;
- add a `TrainingProgress` schema;
- extend `SeasonListItem` and `SeasonDetailResponse` with `training`;
- clarify that existing leaderboard endpoint is ranked-only.

## Error Handling

Training mode follows the same validation discipline as ranked mode:

- missing or invalid JWT returns `401 UNAUTHORIZED`;
- unknown season or race returns `404`;
- inactive season returns `422 SEASON_NOT_ACTIVE`;
- mismatched season or seed returns `400`;
- race ownership mismatch returns `403 RACE_FORBIDDEN`;
- already finished races return `409`.

No training action may:

- spend race coins;
- create `seasonEntries`;
- modify ranked `bestScore` or ranked `totalRaces`;
- affect ranked leaderboard placement.

## Compatibility And Rollout

- No migration of existing ranked rows is required.
- Existing ranked clients continue to work without changes.
- New clients can progressively adopt the training endpoints and additional `training` field in season responses.
- Missing `mode` in legacy `raceRuns` is interpreted as `"ranked"` to preserve old run history.

## Out Of Scope

Not included in this change:

- public training leaderboard;
- admin tooling for training progress;
- migration/backfill of historical training data;
- UI implementation inside the Telegram Mini App.

## Implementation Outline

1. Extend season/race domain types and Mongo `raceRuns` persistence with run mode support.
2. Add `seasonTrainingEntries` repository, Mongo model, and indexes.
3. Add training finish transaction helper.
4. Wire new training routes in `src/app.ts`.
5. Extend season list/detail responses with personal training summary.
6. Update `swagger.yaml`.
7. Run typecheck and build verification.

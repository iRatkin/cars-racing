# Season Automation And Notifications Design

## Goal

Automate battle-season rollover and Telegram notifications without coupling the business logic to Railway. The scheduler should support the current Railway deployment and remain portable to GitHub Actions, a VPS cron, another PaaS cron, or a container orchestrator later.

Season boundaries are weekly: every Wednesday at 20:00 in `Europe/Moscow`.

## Chosen Approach

Add a portable job runner inside the repository, invoked by an external scheduler. Railway Cron can run it while the app is hosted on Railway, but Railway remains only the wake-up mechanism.

The job runner command will:

- connect to MongoDB using the existing runtime config;
- inspect seasons relative to the current time in `Europe/Moscow`;
- create the next weekly season if no manual season already covers the new week;
- send due user notification messages through the main game bot;
- send completed-season leaderboard summaries through the admin bot;
- record each processed notification/rollover event in MongoDB before or during execution so retries do not duplicate completed work.

This keeps the HTTP API process focused on requests/webhooks and keeps scheduling portable.

## External Scheduling

The job should be safe to run more often than strictly necessary. A practical schedule is every 5 to 15 minutes.

For Railway Cron, schedules are UTC. Since Wednesday 20:00 MSK is Wednesday 17:00 UTC, a one-time weekly trigger would be:

```cron
0 17 * * 3
```

However, a more frequent portable tick is preferred:

```cron
*/15 * * * *
```

The frequent tick makes reminder notifications resilient to platform jitter and short downtime. MongoDB idempotency prevents duplicate sends.

## Time Model

All persisted dates remain JavaScript `Date` values in UTC, matching current season storage.

Season boundary calculation is done in the `Europe/Moscow` business timezone:

- each boundary is Wednesday 20:00 MSK;
- the active weekly window is `[boundary, nextBoundary)`;
- notification offsets are calculated from the season's `endsAt`;
- final comparison logic uses UTC instants derived from the Moscow boundary.

Moscow does not currently observe daylight saving time, but the design should still treat `Europe/Moscow` as a named business timezone rather than a hard-coded UTC offset.

## Season Creation

The job creates a new season only when needed.

At each tick:

1. Compute the current weekly season window for `Europe/Moscow`.
2. Look for any season whose interval overlaps or covers that weekly window in a way that indicates an admin already prepared it:
   - `startsAt <= windowStart` and `endsAt > windowStart`, or
   - `startsAt >= windowStart` and `startsAt < windowEnd`.
3. If such a season exists, do not create an automatic season.
4. If no season exists for the window, find the most recent previous season by `endsAt` or `startsAt`.
5. Create a copy with:
   - copied `title`;
   - copied `mapId`;
   - copied `entryFee`;
   - copied `prizePoolShare`;
   - `startsAt = windowStart`;
   - `endsAt = windowEnd`;
   - a new generated `seasonId`.

If there is no previous season to copy, the job logs a warning and skips automatic creation. It does not invent a season from defaults in Phase 0.

Manual seasons have priority. Admins can create the next season ahead of time using the admin bot; the job will detect it and skip cloning.

## User Notifications

The main game bot sends player-facing messages to all registered users in the `users` collection.

Events:

- `season_started`: sent at or after `startsAt`;
- `season_ends_in_3d`: sent at or after `endsAt - 3 days`;
- `season_ends_in_1d`: sent at or after `endsAt - 1 day`;
- `season_ends_in_6h`: sent at or after `endsAt - 6 hours`.

Messages use the public game nickname:

- if `nick` exists, use it;
- otherwise use the existing fallback from `buildPublicNick(user)`.

Message copy for Phase 0:

- start: `Дружище {nick} - новый сезон начался, торопись дрифтить!`
- ending: `Дружище {nick} - поторопись, сезон заканчивается!`

The job sends messages best-effort:

- one failed Telegram delivery must not stop the whole broadcast;
- errors are logged with `userId` and `telegramUserId`;
- successful and failed attempts are counted in logs.

Telegram "bot blocked" and other permanent delivery failures are not persisted as user opt-out state in Phase 0.

## Admin Notifications

The admin bot sends season-end summaries to every ID in `ADMIN_TELEGRAM_IDS`.

Event:

- `season_finished_admin_top10`: sent at or after `endsAt`.

The message contains the finished season title, map id, end time, participant count, and ranked top 10 leaderboard by the existing competition ranking rules:

- sort by `bestScore` descending;
- stable tie-break by `createdAt`, then `userId`;
- equal scores share the same displayed rank, matching public leaderboard behavior.

Each row includes:

- rank;
- public nick;
- score;
- total ranked races.

If the admin bot config is absent, the job logs that the admin summary was skipped and records no successful admin-notification event.

Training highscores are not included in the admin season-end summary for Phase 0.

## Idempotency

Add a MongoDB collection for job events, tentatively `jobEvents`.

Each event stores:

- `eventKey`: unique deterministic key;
- `eventType`;
- `seasonId`;
- `scheduledAt`;
- `status`: `started`, `completed`, or `failed`;
- `attempts`;
- `lastError`;
- `createdAt`;
- `updatedAt`;

Event key format:

```text
season:{seasonId}:{eventType}:{scheduledAtIso}
```

Unique index:

```text
{ eventKey: 1 }, unique
```

The runner attempts to claim an event before work begins. If another process already claimed or completed it, the current run skips that event. This protects against:

- Railway retries;
- manual re-runs;
- scheduler overlap;
- future multi-instance deployments.

For broadcast events, Phase 0 uses event-level idempotency, not per-recipient idempotency. This means a crash halfway through a user broadcast can cause a later run to retry the whole event if the event was not marked completed. That may duplicate messages for users who received the first partial attempt. This is acceptable for Phase 0, but the implementation should structure broadcast code so per-recipient delivery tracking can be added later if needed.

Season creation uses a separate deterministic event key for the weekly window and still checks for existing overlapping seasons immediately before insertion.

## Repository And Runtime Boundaries

Add focused modules rather than embedding scheduling logic in `src/app.ts`.

Expected responsibilities:

- season schedule domain: compute Moscow weekly windows and notification due times;
- season automation service: inspect/create seasons and identify due events;
- notification formatter: build user and admin Telegram messages;
- job events repository: claim and complete idempotent work;
- runner entrypoint: load config, connect Mongo, run one tick, close resources, exit.

The existing repositories should be extended only where necessary:

- `SeasonsRepository` needs lookup helpers for season windows and latest previous season;
- `SeasonEntriesRepository` already has leaderboard and participant-count methods;
- `UsersRepository.getAllUsers()` already supports all-user broadcasts;
- `sendTelegramMessage()` already supports both main-bot and admin-bot delivery.

## Configuration

Required existing env vars remain unchanged:

- `BOT_TOKEN`
- `JWT_SECRET`
- `MONGO_URI`
- `TELEGRAM_WEBHOOK_SECRET`

Admin season-end summaries require the existing admin env group:

- `ADMIN_BOT_TOKEN`
- `ADMIN_WEBHOOK_SECRET`
- `ADMIN_TELEGRAM_IDS`

Add optional scheduler env vars only if implementation needs operational switches:

- `SEASON_AUTOMATION_ENABLED`: default `true` for runner commands;
- `SEASON_AUTOMATION_TZ`: default `Europe/Moscow`;
- `SEASON_AUTOMATION_DRY_RUN`: default `false`.

The HTTP API should not start a long-running in-process scheduler by default.

## Commands

Add a script similar to:

```json
{
  "jobs:season-tick": "node dist/src/jobs/season-tick.js"
}
```

The command expects the project to be built first. A hosting platform can run:

```bash
npm run build && npm run jobs:season-tick
```

If startup time becomes a concern, a direct TypeScript runner can be considered later, but compiled JavaScript is sufficient for Phase 0.

## Error Handling

The runner should:

- log and exit non-zero for configuration or Mongo connection failures;
- continue per-user broadcasts after individual Telegram send failures;
- mark event-level work failed when a whole event cannot complete;
- avoid creating a new automatic season when season lookup fails;
- close Mongo connections before process exit.

Admin notification failure should not roll back season creation or user notifications. Each due event is independent.

## Testing

Add Vitest coverage for the pure domain logic first:

- weekly Moscow boundary calculation;
- current window calculation;
- notification due-time calculation;
- event-key generation;
- clone-season decision when manual season exists;
- clone-season decision when no season exists and previous season is available.

Add focused service tests with fake repositories and fake Telegram sender:

- sends start notification once;
- sends 3-day, 1-day, and 6-hour reminders when due;
- skips duplicate events when the job event claim fails;
- creates a cloned season only when the current weekly window has no manual season;
- sends admin top-10 after season end.

Before completion run:

```bash
npm run test
npm run typecheck
npm run build
```

## Documentation

Update `AGENTS.md` after implementation with:

- the new runner command;
- the Wednesday 20:00 MSK season cadence;
- the season-copy fallback behavior;
- the `jobEvents` collection;
- the recommended portable cron setup;
- the Railway UTC expression example.

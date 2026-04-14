# Промпт для агента: Battle Seasons — боевые сезоны с одиночными заездами

## Контекст

Прочитай `AGENTS.md` в корне проекта — там описана вся архитектура, стек, команды, файлы. Это твоя основная точка входа.

Сейчас в проекте реализовано: авторизация через Telegram, гараж с машинами, покупка race coins за Telegram Stars, покупка машин за race coins. Нужно добавить систему **боевых сезонов** — следующую стадию развития проекта.

**Тесты не нужны. Не создавай, не правь, не запускай тесты. Папку `tests/` не трогай.**

## Общая концепция

Боевые сезоны — это ограниченные по времени периоды, в которые игроки участвуют в одиночных заездах и соревнуются за место в лидерборде.

Ключевые свойства:
- Сезоны создаются вручную администратором в базе (позже — через админские эндпоинты).
- Каждый сезон имеет настраиваемую длительность. Несколько сезонов разной длины могут быть активны одновременно (например, недельный и месячный).
- Каждый сезон привязан к одной карте (mapId). Бек хранит и отдаёт mapId, но не валидирует его — карты определены в Unity.
- Вход в сезон стоит race coins (параметризуемое значение, дефолт 10 RC).
- В течение сезона игрок может совершить неограниченное количество одиночных заездов.
- Результат заезда — число (score/очки). Unity-клиент отправляет свой результат на бек.
- Лидерборд сезона строится по лучшему результату (наивысший score) каждого игрока.
- Каждый сезон имеет свой отдельный лидерборд.
- Призовой фонд и выплаты пока не реализуются, но поля для них закладываются.

### Серверный seed (базовый античит)

Для защиты от подделки результатов используется серверный seed:
1. Перед каждым заездом клиент запрашивает у бека начало заезда.
2. Бек генерирует `seed` (randomUUID), создаёт запись заезда со статусом `started`, возвращает `{ raceId, seed }`.
3. После заезда клиент отправляет `{ raceId, seed, score }`.
4. Бек проверяет: raceId существует, seed совпадает, статус `started`, заезд принадлежит пользователю и сезону.
5. Если всё ок — сохраняет результат.

Без вызова `races/start` отправить результат невозможно.

### Критичные инварианты консистентности

- Вход в сезон должен быть атомарным: нельзя допустить списание race coins без успешного создания `SeasonEntry`.
- Финиш заезда должен быть атомарным: нельзя допустить `RaceRun` со статусом `finished` без синхронного обновления `SeasonEntry`.
- Для лидерборда используется competition ranking: одинаковый `bestScore` даёт одинаковый `rank`, следующий ранг считается с пропуском.
- Для одинакового `bestScore` порядок в топе должен быть стабильным: сначала более ранний `createdAt`, затем `userId`.
- В рамках одного HTTP-запроса статус сезона вычисляй из одного `requestNow`. Не полагайся на значение `season.status`, вычисленное в другое время.

## Что нужно сделать

### 1. Доменные типы сезонов

Создай файл `src/modules/seasons/seasons-domain.ts`.

Типы сезона:

```typescript
export type SeasonStatus = "upcoming" | "active" | "finished";

export interface Season {
  seasonId: string;
  title: string;
  mapId: string;
  entryFee: number;
  prizePoolShare: number;
  startsAt: Date;
  endsAt: Date;
  status: SeasonStatus;
}

export interface SeasonEntry {
  entryId: string;
  seasonId: string;
  userId: string;
  bestScore: number;
  totalRaces: number;
  entryFeeSnapshot: number;
  createdAt: Date;
}

export type RaceRunStatus = "started" | "finished" | "abandoned";

export interface RaceRun {
  raceId: string;
  seasonId: string;
  userId: string;
  seed: string;
  score: number;
  status: RaceRunStatus;
  startedAt: Date;
  finishedAt?: Date;
}

export interface LeaderboardEntry {
  rank: number;
  userId: string;
  username?: string;
  firstName?: string;
  bestScore: number;
  totalRaces: number;
}

export interface LeaderboardView {
  seasonId: string;
  entries: LeaderboardEntry[];
  currentPlayer?: LeaderboardEntry;
  totalParticipants: number;
}
```

Функция определения вычисляемого статуса сезона:

```typescript
export function computeSeasonStatus(season: { startsAt: Date; endsAt: Date }, now: Date): SeasonStatus {
  if (now.getTime() < season.startsAt.getTime()) {
    return "upcoming";
  }
  if (now.getTime() >= season.endsAt.getTime()) {
    return "finished";
  }
  return "active";
}
```

Функция проверки, можно ли войти в сезон:

```typescript
export function canEnterSeason(season: Season, now: Date): boolean {
  return computeSeasonStatus(season, now) === "active";
}
```

Функция проверки, можно ли начать заезд:

```typescript
export function canStartRace(season: Season, now: Date): boolean {
  return computeSeasonStatus(season, now) === "active";
}
```

### 2. Интерфейс SeasonsRepository

Создай файл `src/modules/seasons/seasons-repository.ts`.

```typescript
import type { Season } from "./seasons-domain.js";

export interface SeasonsRepository {
  getSeasonById(seasonId: string): Promise<Season | null>;
  getActiveAndUpcomingSeasons(): Promise<Season[]>;
}
```

Это read-only репозиторий — сезоны создаются вручную в базе. Позже добавится `createSeason` для админских эндпоинтов.

### 3. Интерфейс SeasonEntriesRepository

Создай файл `src/modules/seasons/season-entries-repository.ts`.

```typescript
import type { SeasonEntry } from "./seasons-domain.js";

export interface CreateSeasonEntryInput {
  seasonId: string;
  userId: string;
  entryFeeSnapshot: number;
}

export interface SeasonEntriesRepository {
  findEntry(seasonId: string, userId: string): Promise<SeasonEntry | null>;
  createEntry(input: CreateSeasonEntryInput): Promise<SeasonEntry>;
  updateBestScore(entryId: string, newBestScore: number): Promise<void>;
  incrementTotalRaces(entryId: string): Promise<void>;
  getLeaderboard(seasonId: string, limit: number): Promise<SeasonEntry[]>;
  getEntryRank(seasonId: string, userId: string): Promise<number | null>;
  countEntries(seasonId: string): Promise<number>;
}
```

### 4. Интерфейс RaceRunsRepository

Создай файл `src/modules/seasons/race-runs-repository.ts`.

```typescript
import type { RaceRun } from "./seasons-domain.js";

export interface CreateRaceRunInput {
  seasonId: string;
  userId: string;
  seed: string;
}

export interface RaceRunsRepository {
  createRaceRun(input: CreateRaceRunInput): Promise<RaceRun>;
  getRaceRunById(raceId: string): Promise<RaceRun | null>;
  finishRaceRun(raceId: string, score: number): Promise<RaceRun | null>;
}
```

### 5. Mongo реализация SeasonsRepository

Создай файл `src/infra/mongo/seasons-repository.ts`.

Документ в коллекции `seasons`:

```typescript
export interface MongoSeasonDocument {
  seasonId: string;
  title: string;
  mapId: string;
  entryFee: number;
  prizePoolShare: number;
  startsAt: Date;
  endsAt: Date;
  createdAt: Date;
  updatedAt: Date;
}
```

Заметки по реализации:
- `status` не хранится в базе — вычисляется из `startsAt` / `endsAt` через `computeSeasonStatus()`.
- `getActiveAndUpcomingSeasons()` — фильтр `{ endsAt: { $gt: now } }`, сортировка `{ startsAt: 1 }`.
- `mapSeasonDocument()` маппит `MongoSeasonDocument` → `Season`.
- Не используй `new Date()` внутри `MongoSeasonsRepository`. Источник времени должен приходить снаружи, либо `status` должен пересчитываться в `app.ts` на `requestNow` перед ответом и перед проверками.

Интерфейс коллекции:

```typescript
export interface SeasonsCollection {
  findOne(filter: { seasonId: string }): Promise<WithId<MongoSeasonDocument> | MongoSeasonDocument | null>;
  find(filter: Record<string, unknown>): {
    sort(sort: Record<string, 1 | -1>): {
      toArray(): Promise<Array<WithId<MongoSeasonDocument> | MongoSeasonDocument>>;
    };
  };
}
```

Класс `MongoSeasonsRepository` принимает `SeasonsCollection` и реализует `SeasonsRepository`. Если хочешь вычислять `status` внутри репозитория, передавай в конструктор `now: () => Date`. Не вызывай `new Date()` прямо в репозитории.

### 6. Mongo реализация SeasonEntriesRepository

Создай файл `src/infra/mongo/season-entries-repository.ts`.

Документ в коллекции `seasonEntries`:

```typescript
export interface MongoSeasonEntryDocument {
  entryId: string;
  seasonId: string;
  userId: string;
  bestScore: number;
  totalRaces: number;
  entryFeeSnapshot: number;
  createdAt: Date;
  updatedAt: Date;
}
```

Заметки по реализации:
- `entryId` генерируется как `entry_${randomUUID()}`.
- `createEntry` — `insertOne` с `bestScore: 0`, `totalRaces: 0`.
- `updateBestScore` — `updateOne` с `$set: { bestScore: newBestScore }`. Вызывается только если новый score выше текущего (проверка на стороне вызывающего кода).
- `incrementTotalRaces` — `updateOne` с `$inc: { totalRaces: 1 }`.
- Для лидерборда используется competition ranking: score `2500, 2500, 2400` должен давать rank `1, 1, 3`.
- `getLeaderboard` — `find({ seasonId }).sort({ bestScore: -1, createdAt: 1, userId: 1 }).limit(limit)`.
- `getEntryRank` — `countDocuments({ seasonId, bestScore: { $gt: playerBestScore } }) + 1`.
- `countEntries` — `countDocuments({ seasonId })`.

Интерфейс коллекции:

```typescript
export interface SeasonEntriesCollection {
  findOne(filter: Record<string, unknown>): Promise<WithId<MongoSeasonEntryDocument> | MongoSeasonEntryDocument | null>;
  insertOne(document: MongoSeasonEntryDocument): Promise<unknown>;
  updateOne(filter: Record<string, unknown>, update: Record<string, unknown>): Promise<unknown>;
  find(filter: Record<string, unknown>): {
    sort(sort: Record<string, 1 | -1>): {
      limit(limit: number): {
        toArray(): Promise<Array<WithId<MongoSeasonEntryDocument> | MongoSeasonEntryDocument>>;
      };
    };
  };
  countDocuments(filter: Record<string, unknown>): Promise<number>;
}
```

### 7. Mongo реализация RaceRunsRepository

Создай файл `src/infra/mongo/race-runs-repository.ts`.

Документ в коллекции `raceRuns`:

```typescript
export interface MongoRaceRunDocument {
  raceId: string;
  seasonId: string;
  userId: string;
  seed: string;
  score: number;
  status: "started" | "finished" | "abandoned";
  startedAt: Date;
  finishedAt?: Date;
}
```

Заметки по реализации:
- `raceId` генерируется как `race_${randomUUID()}`.
- `createRaceRun` — `insertOne` с `status: "started"`, `score: 0`, `startedAt: new Date()`.
- `getRaceRunById` — `findOne({ raceId })`.
- `finishRaceRun` — `findOneAndUpdate` с фильтром `{ raceId, status: "started" }`, update `$set: { status: "finished", score, finishedAt: new Date() }`, returnDocument `"after"`. Возвращает `null` если заезд уже не в статусе `started`.

Интерфейс коллекции:

```typescript
export interface RaceRunsCollection {
  findOne(filter: { raceId: string }): Promise<WithId<MongoRaceRunDocument> | MongoRaceRunDocument | null>;
  insertOne(document: MongoRaceRunDocument): Promise<unknown>;
  findOneAndUpdate(
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
    options: { includeResultMetadata: false; returnDocument: "after" }
  ): Promise<WithId<MongoRaceRunDocument> | MongoRaceRunDocument | null>;
}
```

### 8. Mongo индексы

**Файл:** `src/infra/mongo/indexes.ts`

Добавить новые определения индексов:

```typescript
export const seasonsIndexes = [
  {
    keys: { seasonId: 1 },
    options: {
      name: "seasons_seasonId_unique",
      unique: true
    }
  },
  {
    keys: { endsAt: 1, startsAt: 1 },
    options: {
      name: "seasons_endsAt_startsAt"
    }
  }
] as const satisfies readonly CollectionIndexDefinition[];

export const seasonEntriesIndexes = [
  {
    keys: { entryId: 1 },
    options: {
      name: "seasonEntries_entryId_unique",
      unique: true
    }
  },
  {
    keys: { seasonId: 1, userId: 1 },
    options: {
      name: "seasonEntries_seasonId_userId_unique",
      unique: true
    }
  },
  {
    keys: { seasonId: 1, bestScore: -1, createdAt: 1, userId: 1 },
    options: {
      name: "seasonEntries_seasonId_bestScore_createdAt_userId"
    }
  }
] as const satisfies readonly CollectionIndexDefinition[];

export const raceRunsIndexes = [
  {
    keys: { raceId: 1 },
    options: {
      name: "raceRuns_raceId_unique",
      unique: true
    }
  },
  {
    keys: { seasonId: 1, userId: 1, startedAt: -1 },
    options: {
      name: "raceRuns_seasonId_userId_startedAt"
    }
  }
] as const satisfies readonly CollectionIndexDefinition[];
```

Обновить `ensureMongoIndexes` — добавить вызовы:

```typescript
await createCollectionIndexes(db, "seasons", seasonsIndexes);
await createCollectionIndexes(db, "seasonEntries", seasonEntriesIndexes);
await createCollectionIndexes(db, "raceRuns", raceRunsIndexes);
```

### 9. Обновить AppDependencies и buildApp

**Файл:** `src/app.ts`

Добавить новые зависимости в `AppDependencies`:

```typescript
export interface AppDependencies {
  config?: AppConfig;
  usersRepository?: UsersRepository;
  purchasesRepository?: PurchasesRepository;
  seasonsRepository?: SeasonsRepository;
  seasonEntriesRepository?: SeasonEntriesRepository;
  raceRunsRepository?: RaceRunsRepository;
  createInvoiceLink?: (input: {
    purchaseId: string;
    title: string;
    invoiceTitle: string;
    invoiceDescription: string;
    priceSnapshot: { currency: "XTR"; amount: number };
  }) => Promise<string>;
  handleTelegramWebhook?: (update: unknown) => Promise<void>;
  now?: () => Date;
}
```

Добавить Zod-схемы для новых body:

```typescript
const seasonIdParamSchema = z.object({
  seasonId: z.string().min(1)
});

const raceStartBodySchema = z.object({});

const raceFinishBodySchema = z.object({
  raceId: z.string().min(1),
  seed: z.string().min(1),
  score: z.number().int().min(0)
});
```

### 10. Новые роуты

Все новые роуты добавляются в `src/app.ts` внутри блока `if (config && usersRepository)`. Они требуют дополнительную проверку наличия `seasonsRepository`, `seasonEntriesRepository`, `raceRunsRepository`.

#### GET /v1/seasons

Список активных и предстоящих сезонов. Требует JWT.

`status` в ответе вычисляй на общем `requestNow` этого запроса.

```typescript
app.get("/v1/seasons", async (request, reply) => {
  const tokenPayload = await verifyJwtOrReject(request, reply);
  if (!tokenPayload) return;

  const requestNow = now?.() ?? new Date();
  const seasons = await seasonsRepository.getActiveAndUpcomingSeasons();

  const entries = await Promise.all(
    seasons.map(async (season) => {
      const entry = await seasonEntriesRepository.findEntry(season.seasonId, tokenPayload.sub);
      return {
        seasonId: season.seasonId,
        title: season.title,
        mapId: season.mapId,
        entryFee: season.entryFee,
        startsAt: season.startsAt.toISOString(),
        endsAt: season.endsAt.toISOString(),
        status: computeSeasonStatus(season, requestNow),
        entered: entry !== null,
        bestScore: entry?.bestScore ?? null,
        totalRaces: entry?.totalRaces ?? null
      };
    })
  );

  return reply.send({ seasons: entries });
});
```

Response:
```json
{
  "seasons": [
    {
      "seasonId": "season_abc",
      "title": "Weekly Sprint #1",
      "mapId": "track_desert",
      "entryFee": 10,
      "startsAt": "2026-04-14T00:00:00.000Z",
      "endsAt": "2026-04-21T00:00:00.000Z",
      "status": "active",
      "entered": true,
      "bestScore": 1500,
      "totalRaces": 7
    }
  ]
}
```

#### GET /v1/seasons/:seasonId

Детали конкретного сезона + статус участия. Требует JWT.

`status` в ответе вычисляй на общем `requestNow` этого запроса.

```typescript
app.get("/v1/seasons/:seasonId", async (request, reply) => {
  const tokenPayload = await verifyJwtOrReject(request, reply);
  if (!tokenPayload) return;

  const params = seasonIdParamSchema.safeParse(request.params);
  if (!params.success) {
    return reply.code(400).send({ code: "SEASON_ID_REQUIRED" });
  }

  const season = await seasonsRepository.getSeasonById(params.data.seasonId);
  if (!season) {
    return reply.code(404).send({ code: "SEASON_NOT_FOUND" });
  }

  const requestNow = now?.() ?? new Date();
  const entry = await seasonEntriesRepository.findEntry(season.seasonId, tokenPayload.sub);

  return reply.send({
    seasonId: season.seasonId,
    title: season.title,
    mapId: season.mapId,
    entryFee: season.entryFee,
    startsAt: season.startsAt.toISOString(),
    endsAt: season.endsAt.toISOString(),
    status: computeSeasonStatus(season, requestNow),
    entered: entry !== null,
    bestScore: entry?.bestScore ?? null,
    totalRaces: entry?.totalRaces ?? null
  });
});
```

#### POST /v1/seasons/:seasonId/enter

Купить доступ к сезону за race coins. Требует JWT.

Логика:
1. Проверить JWT.
2. Проверить что сезон существует.
3. Вычислить `requestNow = now?.() ?? new Date()` и получить `seasonStatus = computeSeasonStatus(season, requestNow)`.
4. Проверить что сезон `active`.
5. Выполнить проверку существующего entry, списание `season.entryFee` RC и создание `SeasonEntry` атомарно.
6. Если внутри атомарной операции выяснилось, что игрок уже вступил, откатить списание и вернуть `409 ALREADY_ENTERED`.
7. Вернуть подтверждение.

Требование: фактическая реализация этого роута обязана быть атомарной. Если текущих интерфейсов репозиториев недостаточно, расширь их минимально под Mongo transaction, но не допускай сценарий double charge.

```typescript
app.post("/v1/seasons/:seasonId/enter", async (request, reply) => {
  const tokenPayload = await verifyJwtOrReject(request, reply);
  if (!tokenPayload) return;

  const params = seasonIdParamSchema.safeParse(request.params);
  if (!params.success) {
    return reply.code(400).send({ code: "SEASON_ID_REQUIRED" });
  }

  const season = await seasonsRepository.getSeasonById(params.data.seasonId);
  if (!season) {
    return reply.code(404).send({ code: "SEASON_NOT_FOUND" });
  }

  const requestNow = now?.() ?? new Date();
  const seasonStatus = computeSeasonStatus(season, requestNow);
  if (seasonStatus !== "active") {
    return reply.code(422).send({ code: "SEASON_NOT_ACTIVE" });
  }

  const enterResult = await enterSeasonAtomically({
    season,
    userId: tokenPayload.sub,
    usersRepository: userRepo,
    seasonEntriesRepository
  });
  if (enterResult.kind === "already-entered") {
    return reply.code(409).send({ code: "ALREADY_ENTERED" });
  }
  if (enterResult.kind === "insufficient-balance") {
    return reply.code(422).send({ code: "INSUFFICIENT_BALANCE" });
  }

  return reply.send({
    success: true,
    seasonId: season.seasonId,
    entryId: enterResult.entry.entryId,
    raceCoinsBalance: enterResult.user.raceCoinsBalance
  });
});
```

`enterSeasonAtomically` не обязан быть отдельным файлом. Это требование к реализации: списание RC и создание `SeasonEntry` должны жить в одной атомарной операции.

Response:
```json
{
  "success": true,
  "seasonId": "season_abc",
  "entryId": "entry_xyz",
  "raceCoinsBalance": 40
}
```

Ошибки:
- `404 SEASON_NOT_FOUND`
- `422 SEASON_NOT_ACTIVE` — сезон ещё не начался или уже закончился
- `409 ALREADY_ENTERED`
- `422 INSUFFICIENT_BALANCE`

#### POST /v1/seasons/:seasonId/races/start

Начать заезд, получить seed. Требует JWT.

Логика:
1. Проверить JWT.
2. Проверить что сезон существует и `active` (через `canStartRace`).
3. Проверить что игрок вступил в сезон (findEntry).
4. Сгенерировать seed (`randomUUID()`).
5. Создать RaceRun со статусом `started`.
6. Вернуть `{ raceId, seed }`.

```typescript
app.post("/v1/seasons/:seasonId/races/start", async (request, reply) => {
  const tokenPayload = await verifyJwtOrReject(request, reply);
  if (!tokenPayload) return;

  const params = seasonIdParamSchema.safeParse(request.params);
  if (!params.success) {
    return reply.code(400).send({ code: "SEASON_ID_REQUIRED" });
  }

  const season = await seasonsRepository.getSeasonById(params.data.seasonId);
  if (!season) {
    return reply.code(404).send({ code: "SEASON_NOT_FOUND" });
  }

  const requestNow = now?.() ?? new Date();
  if (!canStartRace(season, requestNow)) {
    return reply.code(422).send({ code: "SEASON_NOT_ACTIVE" });
  }

  const entry = await seasonEntriesRepository.findEntry(season.seasonId, tokenPayload.sub);
  if (!entry) {
    return reply.code(403).send({ code: "NOT_ENTERED" });
  }

  const seed = randomUUID();
  const raceRun = await raceRunsRepository.createRaceRun({
    seasonId: season.seasonId,
    userId: tokenPayload.sub,
    seed
  });

  return reply.send({
    raceId: raceRun.raceId,
    seed: raceRun.seed
  });
});
```

Response:
```json
{
  "raceId": "race_abc123",
  "seed": "550e8400-e29b-41d4-a716-446655440000"
}
```

Ошибки:
- `404 SEASON_NOT_FOUND`
- `422 SEASON_NOT_ACTIVE`
- `403 NOT_ENTERED` — игрок не купил вход в сезон

#### POST /v1/seasons/:seasonId/races/finish

Отправить результат заезда. Требует JWT.

Body: `{ "raceId": string, "seed": string, "score": number }`

Логика:
1. Проверить JWT.
2. Валидировать body через `raceFinishBodySchema`.
3. Найти RaceRun по `raceId`.
4. Проверить что заезд принадлежит текущему пользователю и текущему сезону.
5. Проверить что `seed` совпадает.
6. Проверить что статус `started`.
7. Найти `SeasonEntry` по `(seasonId, userId)` и если его нет, вернуть `403 NOT_ENTERED`.
8. Атомарно: перевести `RaceRun` в `finished`, увеличить `totalRaces`, при необходимости обновить `bestScore`.
9. Вернуть результат, собранный из уже согласованного состояния.

Требование: этот роут не должен оставлять систему в промежуточном состоянии, где `RaceRun` уже finished, а `SeasonEntry` ещё не обновлён.

```typescript
app.post("/v1/seasons/:seasonId/races/finish", async (request, reply) => {
  const tokenPayload = await verifyJwtOrReject(request, reply);
  if (!tokenPayload) return;

  const params = seasonIdParamSchema.safeParse(request.params);
  if (!params.success) {
    return reply.code(400).send({ code: "SEASON_ID_REQUIRED" });
  }

  const parsedBody = raceFinishBodySchema.safeParse(request.body);
  if (!parsedBody.success) {
    return reply.code(400).send({ code: "INVALID_RACE_RESULT" });
  }

  const raceRun = await raceRunsRepository.getRaceRunById(parsedBody.data.raceId);
  if (!raceRun) {
    return reply.code(404).send({ code: "RACE_NOT_FOUND" });
  }

  if (raceRun.userId !== tokenPayload.sub) {
    return reply.code(403).send({ code: "RACE_FORBIDDEN" });
  }

  if (raceRun.seasonId !== params.data.seasonId) {
    return reply.code(400).send({ code: "RACE_SEASON_MISMATCH" });
  }

  if (raceRun.seed !== parsedBody.data.seed) {
    return reply.code(400).send({ code: "INVALID_SEED" });
  }

  if (raceRun.status !== "started") {
    return reply.code(409).send({ code: "RACE_ALREADY_FINISHED" });
  }

  const entry = await seasonEntriesRepository.findEntry(params.data.seasonId, tokenPayload.sub);
  if (!entry) {
    return reply.code(403).send({ code: "NOT_ENTERED" });
  }

  const finishResult = await finishSeasonRaceAtomically({
    raceId: raceRun.raceId,
    score: parsedBody.data.score,
    entry
  });
  if (finishResult.kind === "already-finished") {
    return reply.code(409).send({ code: "RACE_ALREADY_FINISHED" });
  }

  return reply.send({
    raceId: finishResult.raceRun.raceId,
    score: finishResult.raceRun.score,
    isNewBest: finishResult.isNewBest,
    bestScore: finishResult.bestScore
  });
});
```

`finishSeasonRaceAtomically` не обязан быть отдельным файлом. Это требование к реализации: финализация `RaceRun` и обновление `SeasonEntry` должны выполняться одной атомарной операцией.

Response:
```json
{
  "raceId": "race_abc123",
  "score": 1500,
  "isNewBest": true,
  "bestScore": 1500
}
```

Ошибки:
- `400 INVALID_RACE_RESULT` — невалидный body
- `404 RACE_NOT_FOUND`
- `403 NOT_ENTERED` — игрок не имеет активного участия в сезоне
- `403 RACE_FORBIDDEN` — заезд принадлежит другому пользователю
- `400 RACE_SEASON_MISMATCH` — raceId не принадлежит сезону из URL
- `400 INVALID_SEED` — seed не совпадает
- `409 RACE_ALREADY_FINISHED` — результат уже отправлен

#### GET /v1/seasons/:seasonId/leaderboard

Лидерборд сезона. Требует JWT.

Query-параметры:
- `limit` — количество записей (дефолт 100, макс 100).

Логика:
1. Проверить JWT.
2. Проверить что сезон существует.
3. Получить топ-N записей из `seasonEntries` сортировкой по `bestScore desc`, затем `createdAt asc`, затем `userId asc`.
4. Для каждой записи подтянуть `username` и `firstName` из `usersRepository`.
5. Проставить ранги по правилам competition ranking.
6. Определить позицию текущего игрока (если он участвует и не в топе).
7. Вернуть лидерборд.

```typescript
app.get("/v1/seasons/:seasonId/leaderboard", async (request, reply) => {
  const tokenPayload = await verifyJwtOrReject(request, reply);
  if (!tokenPayload) return;

  const params = seasonIdParamSchema.safeParse(request.params);
  if (!params.success) {
    return reply.code(400).send({ code: "SEASON_ID_REQUIRED" });
  }

  const season = await seasonsRepository.getSeasonById(params.data.seasonId);
  if (!season) {
    return reply.code(404).send({ code: "SEASON_NOT_FOUND" });
  }

  const queryLimit = parseLeaderboardLimit(request.query);
  const topEntries = await seasonEntriesRepository.getLeaderboard(season.seasonId, queryLimit);

  const entries: LeaderboardEntry[] = [];
  let previousScore: number | null = null;
  let previousRank = 0;
  for (const [index, entry] of topEntries.entries()) {
    const user = await userRepo.getUserById(entry.userId);
    const rank =
      previousScore !== null && entry.bestScore === previousScore
        ? previousRank
        : index + 1;
    entries.push({
      rank,
      userId: entry.userId,
      username: user?.username,
      firstName: user?.firstName,
      bestScore: entry.bestScore,
      totalRaces: entry.totalRaces
    });
    previousScore = entry.bestScore;
    previousRank = rank;
  }

  const totalParticipants = await seasonEntriesRepository.countEntries(season.seasonId);

  let currentPlayer: LeaderboardEntry | undefined;
  const playerInTop = entries.find((e) => e.userId === tokenPayload.sub);
  if (playerInTop) {
    currentPlayer = playerInTop;
  } else {
    const playerEntry = await seasonEntriesRepository.findEntry(season.seasonId, tokenPayload.sub);
    if (playerEntry) {
      const playerRank = await seasonEntriesRepository.getEntryRank(season.seasonId, tokenPayload.sub);
      const playerUser = await userRepo.getUserById(tokenPayload.sub);
      currentPlayer = {
        rank: playerRank ?? totalParticipants,
        userId: playerEntry.userId,
        username: playerUser?.username,
        firstName: playerUser?.firstName,
        bestScore: playerEntry.bestScore,
        totalRaces: playerEntry.totalRaces
      };
    }
  }

  return reply.send({
    seasonId: season.seasonId,
    entries,
    currentPlayer: currentPlayer ?? null,
    totalParticipants
  });
});
```

Вспомогательная функция парсинга limit:

```typescript
function parseLeaderboardLimit(query: unknown): number {
  if (typeof query === "object" && query !== null && "limit" in query) {
    const raw = (query as Record<string, unknown>).limit;
    const parsed = typeof raw === "string" ? Number(raw) : typeof raw === "number" ? raw : NaN;
    if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 100) {
      return parsed;
    }
  }
  return 100;
}
```

Response:
```json
{
  "seasonId": "season_abc",
  "entries": [
    {
      "rank": 1,
      "userId": "usr_111",
      "username": "speedking",
      "firstName": "Alex",
      "bestScore": 2500,
      "totalRaces": 15
    },
    {
      "rank": 2,
      "userId": "usr_222",
      "username": "racer42",
      "firstName": "Max",
      "bestScore": 2100,
      "totalRaces": 8
    }
  ],
  "currentPlayer": {
    "rank": 47,
    "userId": "usr_333",
    "username": "ivan_dev",
    "firstName": "Ivan",
    "bestScore": 800,
    "totalRaces": 3
  },
  "totalParticipants": 120
}
```

### 11. Добавить `getUserById` в UsersRepository для batch-загрузки данных лидерборда

`getUserById` уже существует в `UsersRepository`. Никаких изменений не нужно.

### 12. Обновить runtime.ts

**Файл:** `src/runtime.ts`

Если для атомарного `enter` / `finish` понадобится Mongo transaction, разрешается минимально расширить wiring так, чтобы в `app.ts` можно было выполнить одну атомарную операцию поверх Mongo. Не оставляй эту логику на уровне двух независимых вызовов репозиториев.

Добавить импорты новых репозиториев и создать их экземпляры:

```typescript
import {
  MongoSeasonsRepository,
  type MongoSeasonDocument
} from "./infra/mongo/seasons-repository.js";
import {
  MongoSeasonEntriesRepository,
  type MongoSeasonEntryDocument
} from "./infra/mongo/season-entries-repository.js";
import {
  MongoRaceRunsRepository,
  type MongoRaceRunDocument
} from "./infra/mongo/race-runs-repository.js";
```

В `buildMongoBackedApp`:

```typescript
const seasonsRepository = new MongoSeasonsRepository(
  input.db.collection<MongoSeasonDocument>("seasons")
);
const seasonEntriesRepository = new MongoSeasonEntriesRepository(
  input.db.collection<MongoSeasonEntryDocument>("seasonEntries")
);
const raceRunsRepository = new MongoRaceRunsRepository(
  input.db.collection<MongoRaceRunDocument>("raceRuns")
);
```

Передать в `buildApp`:

```typescript
return buildApp({
  config: input.config,
  usersRepository,
  purchasesRepository,
  seasonsRepository,
  seasonEntriesRepository,
  raceRunsRepository,
  createInvoiceLink: (invoiceInput) =>
    createTelegramInvoiceLink(telegramOptions, invoiceInput),
  handleTelegramWebhook: input.handleTelegramWebhook ?? webhookHandler
});
```

### 13. Обновить swagger.yaml

Добавить новый тег:
```yaml
tags:
  - name: Seasons
```

Добавить пути:
- `GET /v1/seasons`
- `GET /v1/seasons/{seasonId}`
- `POST /v1/seasons/{seasonId}/enter`
- `POST /v1/seasons/{seasonId}/races/start`
- `POST /v1/seasons/{seasonId}/races/finish`
- `GET /v1/seasons/{seasonId}/leaderboard`

Все защищены `bearerAuth`.

Добавить новые схемы:
- `SeasonListResponse`
- `SeasonListItem`
- `SeasonDetailResponse`
- `SeasonEnterRequest` (пустой body — сезон определяется path-параметром)
- `SeasonEnterResponse`
- `RaceStartResponse`
- `RaceFinishRequest`
- `RaceFinishResponse`
- `LeaderboardResponse`
- `LeaderboardEntry`

Добавить новые error codes в enum `ErrorResponse`:
- `SEASON_ID_REQUIRED`
- `SEASON_NOT_FOUND`
- `SEASON_NOT_ACTIVE`
- `ALREADY_ENTERED`
- `NOT_ENTERED`
- `INVALID_RACE_RESULT`
- `RACE_NOT_FOUND`
- `RACE_FORBIDDEN`
- `RACE_SEASON_MISMATCH`
- `INVALID_SEED`
- `RACE_ALREADY_FINISHED`

### 14. Обновить AGENTS.md

Обновить секции:
- **System Intent** — упомянуть battle seasons, leaderboard, solo races
- **Current Reality** — описать новые модули и эндпоинты
- **HTTP Surface** — добавить новые роуты
- **Important Files** — добавить новые файлы модуля seasons
- **Data Model Snapshot** — добавить коллекции `seasons`, `seasonEntries`, `raceRuns`
- **Route Behavior Notes** — описать поведение каждого нового роута
- **Catalog Snapshot** — не меняется (race coins и cars остаются прежними)

### 15. Создать curl-скрипты для тестирования

Создать в `fixtures/curls/`:

| Скрипт | Что делает |
|--------|-----------|
| `20-seasons-list.sh` | `GET /v1/seasons` |
| `21-season-enter.sh` | `POST /v1/seasons/:seasonId/enter` |
| `22-race-start.sh` | `POST /v1/seasons/:seasonId/races/start` |
| `23-race-finish.sh` | `POST /v1/seasons/:seasonId/races/finish` |
| `24-leaderboard.sh` | `GET /v1/seasons/:seasonId/leaderboard` |
| `25-season-full-flow.sh` | Полный flow: вход → старт → финиш → лидерборд |

Все скрипты по аналогии с существующими: читают `token.txt`, поддерживают `$BASE_URL` как первый аргумент.

### 16. Создать seed-скрипт для тестового сезона

Создать `fixtures/curls/19-seed-season.sh`:

Вставляет тестовый сезон напрямую в MongoDB для локального тестирования:

```bash
#!/usr/bin/env bash
set -euo pipefail

MONGO_URI="${MONGO_URI:-mongodb://localhost:27017/mafinki}"

mongosh "$MONGO_URI" --eval '
db.seasons.insertOne({
  seasonId: "season_test_1",
  title: "Test Weekly Sprint",
  mapId: "track_desert",
  entryFee: 10,
  prizePoolShare: 0.5,
  startsAt: new Date(),
  endsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  createdAt: new Date(),
  updatedAt: new Date()
})
'

echo "Test season 'season_test_1' created"
```

## Порядок выполнения

1. `src/modules/seasons/seasons-domain.ts` — доменные типы и функции
2. `src/modules/seasons/seasons-repository.ts` — интерфейс SeasonsRepository
3. `src/modules/seasons/season-entries-repository.ts` — интерфейс SeasonEntriesRepository
4. `src/modules/seasons/race-runs-repository.ts` — интерфейс RaceRunsRepository
5. `src/infra/mongo/seasons-repository.ts` — Mongo реализация SeasonsRepository
6. `src/infra/mongo/season-entries-repository.ts` — Mongo реализация SeasonEntriesRepository
7. `src/infra/mongo/race-runs-repository.ts` — Mongo реализация RaceRunsRepository
8. `src/infra/mongo/indexes.ts` — новые индексы
9. `src/app.ts` — новые зависимости, Zod-схемы и роуты
10. `src/runtime.ts` — wiring новых репозиториев
11. `swagger.yaml` — привести в соответствие
12. `AGENTS.md` — обновить документацию
13. `fixtures/curls/` — curl-скрипты для тестирования

## Валидация

После всех изменений запусти:
```bash
npm run typecheck
npm run build
```

Оба должны пройти без ошибок. **Тесты не запускай.**

## Правила

- Не пиши комментарии в коде
- Не используй `as any` и `as unknown`
- Следуй code style проекта (ESM imports с `.js`, Zod для валидации body, типы через `interface`/`type`)
- Не трогай папку `tests/`
- Импорт `randomUUID` из `"node:crypto"`
- Все даты в ответах API — в ISO 8601 формате (`.toISOString()`)
- Nullable поля в JSON-ответах: `null`, не `undefined`

## Задел на будущее (не реализовывать сейчас)

Следующие вещи **не входят** в текущий scope, но код проектируется так, чтобы их можно было добавить отдельными модулями:

- **Админские эндпоинты** (`POST /v1/admin/seasons`, `PATCH /v1/admin/seasons/:seasonId`) — модуль `src/modules/admin/` с middleware проверки прав. Структура репозиториев уже позволяет добавить `createSeason` / `updateSeason` в `SeasonsRepository`.
- **Призовые выплаты** — поле `prizePoolShare` уже хранится в сезоне. При завершении сезона можно будет рассчитать призовой фонд (`entryFee × participants × prizePoolShare`) и распределить его по лидерборду.
- **Античит level 2** — валидация правдоподобности score (минимально возможное время, максимально возможные очки на карте). Требует знания о картах на стороне бека.
- **История заездов игрока** — `GET /v1/seasons/:seasonId/races/my` — список заездов текущего пользователя в сезоне.
- **Автоматическое создание сезонов** — cron / scheduler, который создаёт новые сезоны по расписанию.

# Промпт для агента: Race Coins — внутренняя валюта

## Контекст

Прочитай `AGENTS.md` в корне проекта — там описана вся архитектура, стек, команды, файлы. Это твоя основная точка входа.

Сейчас в проекте машинки покупаются напрямую за Telegram Stars через invoice flow. Нужно переделать систему: за Telegram Stars покупается внутренняя валюта **race coins**, а машинки покупаются за race coins (без участия Telegram Stars).

**Тесты не нужны. Не создавай, не правь, не запускай тесты. Папку `tests/` не трогай.**

## Что нужно сделать

### 1. Race Coins Bundles — каталог бандлов

Создай файл `src/modules/race-coins/race-coins-catalog.ts`.

Определи каталог бандлов race coins, доступных для покупки за Stars:

| bundleId        | coins | price (XTR) | invoiceTitle       | invoiceDescription        |
|-----------------|-------|-------------|--------------------|---------------------------|
| `rc_bundle_10`  | 10    | 1           | "10 Race Coins"    | "Get 10 Race Coins"       |
| `rc_bundle_20`  | 20    | 1           | "20 Race Coins"    | "Get 20 Race Coins"       |
| `rc_bundle_50`  | 50    | 1           | "50 Race Coins"    | "Get 50 Race Coins"       |
| `rc_bundle_100` | 100   | 1           | "100 Race Coins"   | "Get 100 Race Coins"      |

Тип бандла:

```typescript
export type RaceCoinsBundleId = "rc_bundle_10" | "rc_bundle_20" | "rc_bundle_50" | "rc_bundle_100";

export type RaceCoinsBundle = {
  bundleId: RaceCoinsBundleId;
  coins: number;
  price: { currency: "XTR"; amount: number };
  invoiceTitle: string;
  invoiceDescription: string;
};
```

Экспортируй массив `RACE_COINS_BUNDLES` и функции `getBundleById(bundleId: string): RaceCoinsBundle | null` и `getAllBundles(): RaceCoinsBundle[]`.

### 2. Изменить каталог машин — цены в race coins

Файл: `src/modules/cars-catalog/cars-catalog.ts`

Изменить валюту цен машин с `"XTR"` на `"RC"` (race coins). Тип `Phase0CarPrice` обновить:

```typescript
export type Phase0CarPrice = {
  currency: "RC";
  amount: number;
};
```

Назначить цены машинам (starter_car остаётся бесплатным):
- `car0` (starter): `{ currency: "RC", amount: 0 }` — не покупается
- `car1`: `{ currency: "RC", amount: 25 }`
- `car2`: `{ currency: "RC", amount: 50 }`

Убрать `invoiceTitle` и `invoiceDescription` из `Phase0Car` — машины больше не покупаются через Telegram invoice.

### 3. Баланс race coins в модели пользователя

**Файл интерфейса:** `src/modules/users/users-repository.ts`

Добавить в `AppUser`:
```typescript
raceCoinsBalance: number;
```

Добавить метод в `UsersRepository`:
```typescript
addRaceCoins(userId: string, amount: number): Promise<AppUser>;
spendRaceCoins(userId: string, amount: number): Promise<AppUser | null>;
addOwnedCar(userId: string, carId: string): Promise<AppUser | null>;
```

`spendRaceCoins` должен использовать атомарный `$inc` с негативным значением и `find` с условием `raceCoinsBalance >= amount` чтобы не уйти в минус. Возвращает `null` если баланс недостаточен.

`addOwnedCar` — `$addToSet: { ownedCarIds: carId }`, инкремент `garageRevision`.

**Mongo реализация:** `src/infra/mongo/users-repository.ts`

Добавить поле `raceCoinsBalance: number` в `MongoUserDocument`.

При upsert нового пользователя: `$setOnInsert: { raceCoinsBalance: 0 }`.

Реализовать `addRaceCoins`:
```typescript
async addRaceCoins(userId: string, amount: number): Promise<AppUser> {
  const document = await this.collection.findOneAndUpdate(
    { userId },
    { $inc: { raceCoinsBalance: amount }, $set: { updatedAt: new Date() } },
    { includeResultMetadata: false, returnDocument: "after" }
  );
  if (!document) throw new Error("User not found for addRaceCoins");
  return mapUserDocument(document);
}
```

Реализовать `spendRaceCoins`:
```typescript
async spendRaceCoins(userId: string, amount: number): Promise<AppUser | null> {
  const document = await this.collection.findOneAndUpdate(
    { userId, raceCoinsBalance: { $gte: amount } },
    { $inc: { raceCoinsBalance: -amount }, $set: { updatedAt: new Date() } },
    { includeResultMetadata: false, returnDocument: "after" }
  );
  return document ? mapUserDocument(document) : null;
}
```

Реализовать `addOwnedCar`:
```typescript
async addOwnedCar(userId: string, carId: string): Promise<AppUser | null> {
  const document = await this.collection.findOneAndUpdate(
    { userId },
    {
      $addToSet: { ownedCarIds: carId },
      $inc: { garageRevision: 1 },
      $set: { updatedAt: new Date() }
    },
    { includeResultMetadata: false, returnDocument: "after" }
  );
  return document ? mapUserDocument(document) : null;
}
```

Обновить `mapUserDocument` — добавить `raceCoinsBalance: document.raceCoinsBalance ?? 0`.

Обновить `UsersCollection` интерфейс: расширить `findOneAndUpdate` чтобы он принимал новые фильтры (или сделать типы менее строгими для filter).

### 4. Переделать purchases на покупку бандлов

**Файл:** `src/modules/payments/purchases-repository.ts`

Заменить `carId` на `bundleId` в `PurchaseIntentRecord` и `CreatePurchaseIntentInput`:

```typescript
export interface PurchaseIntentRecord {
  purchaseId: string;
  userId: string;
  telegramUserId: string;
  bundleId: string;
  status: PurchaseStatus;
  isActiveIntent: boolean;
  invoicePayload: string;
  invoiceUrl?: string;
  priceSnapshot: { currency: "XTR"; amount: number };
  coinsAmount: number;
  expiresAt: Date;
}
```

Обновить `CreatePurchaseIntentInput` — `Omit<PurchaseIntentRecord, "purchaseId" | "invoicePayload" | "status" | "isActiveIntent" | "invoiceUrl">`.

Обновить `findActiveIntent` — фильтр по `{ userId, bundleId }` вместо `{ userId, carId }`.

**Файл:** `src/infra/mongo/purchases-repository.ts`

Обновить `MongoPurchaseDocument` — `carId` → `bundleId`, добавить `coinsAmount: number`.

Обновить `PurchasesCollection` — фильтр `findOne` по `bundleId`.

Обновить `mapPurchaseDocument` — маппить `bundleId` и `coinsAmount`.

Обновить `createIntent` — записывать `bundleId` и `coinsAmount`.

**Файл:** `src/modules/payments/purchase-domain.ts`

Обновить `PurchaseIntentSnapshot` — `carId` → `bundleId`.

### 5. Обновить Mongo индексы

**Файл:** `src/infra/mongo/indexes.ts`

Обновить индекс `purchases_activeIntent_unique`:
```typescript
{
  keys: { userId: 1, bundleId: 1, isActiveIntent: 1 },
  options: {
    name: "purchases_activeIntent_unique",
    partialFilterExpression: { isActiveIntent: true },
    unique: true
  }
}
```

### 6. Обновить invoice-link.ts

**Файл:** `src/modules/telegram/invoice-link.ts`

Переименовать `TelegramStarsCatalogCar` → `TelegramStarsProduct` (или аналог). Убрать `carId`, заменить на `productId`. Или проще — изменить `CreateTelegramInvoiceLinkInput`:

```typescript
export interface CreateTelegramInvoiceLinkInput {
  purchaseId: string;
  title: string;
  invoiceTitle: string;
  invoiceDescription: string;
  priceSnapshot: TelegramStarsPriceSnapshot;
}
```

Обновить `buildTelegramCreateInvoiceLinkRequestBody` — принимает `purchaseId` и продуктовые данные без привязки к `car`.

Обновить `createTelegramInvoiceLink` — передавать данные бандла вместо машины.

### 7. Новый роут: POST /v1/purchases/coins-intents

**Файл:** `src/app.ts`

Этот роут заменяет текущий `POST /v1/purchases/car-intents` по смыслу. Текущий `car-intents` роут нужно **удалить**.

Новый роут `POST /v1/purchases/coins-intents`:
- Требует JWT
- Body: `{ "bundleId": string }`
- Валидирует bundleId через `getBundleById()`
- Ищет активный intent по `{ userId, bundleId }`
- Reuse / expire / create — та же логика что сейчас для car-intents
- Создаёт purchase intent с `bundleId` и `coinsAmount`
- Вызывает `createInvoiceLink` с данными бандла (invoiceTitle, invoiceDescription, price)
- Возвращает `{ purchaseId, status, invoiceUrl, expiresAt, price, coinsAmount }`

### 8. Новый роут: POST /v1/purchases/buy-car

**Файл:** `src/app.ts`

Роут для покупки машины за race coins (без Telegram Stars):
- Требует JWT
- Body: `{ "carId": string }`
- Загрузить пользователя, проверить `ensureStarterCarState`
- Проверить что машина существует, `canPurchaseCarServerSide`, не owned
- Проверить `car.price.currency === "RC"`
- Вызвать `usersRepository.spendRaceCoins(userId, car.price.amount)`
  - Если `null` — `{ code: "INSUFFICIENT_BALANCE" }` с кодом 422
- Вызвать `usersRepository.addOwnedCar(userId, carId)`
- Вернуть обновлённый garage view

Формат ответа:
```typescript
{
  success: true,
  carId: string,
  raceCoinsBalance: number,
  garageRevision: number
}
```

### 9. Обновить зависимости в AppDependencies и buildApp

**Файл:** `src/app.ts`

Обновить `createInvoiceLink` в `AppDependencies` — убрать `carId`, передавать generic product-данные:

```typescript
createInvoiceLink?: (input: {
  purchaseId: string;
  title: string;
  invoiceTitle: string;
  invoiceDescription: string;
  priceSnapshot: { currency: "XTR"; amount: number };
}) => Promise<string>;
```

Обновить `carIntentBodySchema` → `coinsIntentBodySchema`:
```typescript
const coinsIntentBodySchema = z.object({
  bundleId: z.string().min(1)
});
```

Добавить `buyCarBodySchema`:
```typescript
const buyCarBodySchema = z.object({
  carId: z.string().min(1)
});
```

### 10. Обновить garage view

**Файл:** `src/modules/garage/garage-view.ts`

Обновить `GaragePrice`:
```typescript
export interface GaragePrice {
  currency: string;
  amount: number;
}
```

Это уже generic, оставить как есть.

**Файл:** `src/app.ts` — роут `GET /v1/garage`

Добавить в ответ `raceCoinsBalance` из данных пользователя:
```typescript
return reply.send({
  ...garage,
  raceCoinsBalance: user.raceCoinsBalance ?? 0
});
```

### 11. Обновить auth response

**Файл:** `src/app.ts` — роут `POST /v1/auth/telegram`

Добавить `raceCoinsBalance` в profile ответа:
```typescript
profile: {
  userId: user.userId,
  telegramUserId: user.telegramUserId,
  firstName: user.firstName,
  username: user.username,
  ownedCarIds: starterState.ownedCarIds,
  garageRevision: starterState.garageRevision,
  raceCoinsBalance: user.raceCoinsBalance ?? 0
}
```

### 12. Обновить runtime.ts

**Файл:** `src/runtime.ts`

Обновить `createInvoiceLink` лямбду — передавать новые поля (без `carId`):

```typescript
createInvoiceLink: (invoiceInput) =>
  createTelegramInvoiceLink(
    { botToken: input.config.botToken, fetchImpl: input.fetchImpl },
    invoiceInput
  ),
```

### 13. Обновить swagger.yaml

Добавить:
- Новый роут `POST /v1/purchases/coins-intents` (body: `{ bundleId }`, response: intent + coinsAmount)
- Новый роут `POST /v1/purchases/buy-car` (body: `{ carId }`, response: success + balance)
- Schema `RaceCoinsBundle` и `RaceCoinsBundlePrice`
- Новый error code `INSUFFICIENT_BALANCE`, `BUNDLE_NOT_FOUND`, `BUNDLE_ID_REQUIRED`
- Обновить `GarageResponse` — добавить `raceCoinsBalance`
- Обновить `UserProfile` — добавить `raceCoinsBalance`
- Обновить `GarageCar.price` — `currency` enum добавить `RC`
- Удалить старый роут `POST /v1/purchases/car-intents`

### 14. Обновить AGENTS.md

Обновить секции:
- **System Intent** — упомянуть race coins
- **Catalog Snapshot** — новые цены в RC, описать бандлы
- **Route Behavior Notes** — описать новые роуты, удалить car-intents
- **Data Model Snapshot** — raceCoinsBalance в user, bundleId в purchases
- **HTTP Surface** — обновить список роутов

## Порядок выполнения

1. `src/modules/race-coins/race-coins-catalog.ts` — создать каталог бандлов
2. `src/modules/cars-catalog/cars-catalog.ts` — цены в RC, убрать invoice поля
3. `src/modules/users/users-repository.ts` — raceCoinsBalance + новые методы
4. `src/infra/mongo/users-repository.ts` — реализовать новые методы, обновить маппинг
5. `src/modules/payments/purchases-repository.ts` — bundleId вместо carId
6. `src/modules/payments/purchase-domain.ts` — bundleId вместо carId
7. `src/infra/mongo/purchases-repository.ts` — обновить под bundleId + coinsAmount
8. `src/infra/mongo/indexes.ts` — обновить индекс
9. `src/modules/telegram/invoice-link.ts` — generic product вместо car
10. `src/app.ts` — удалить car-intents, добавить coins-intents и buy-car, обновить garage и auth
11. `src/runtime.ts` — обновить wiring
12. `swagger.yaml` — привести в соответствие
13. `AGENTS.md` — обновить документацию

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

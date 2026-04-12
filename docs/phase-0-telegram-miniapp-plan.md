# План реализации фазы 0 для Telegram Mini App игры

Документ описывает практический план минимального вертикального среза:
Telegram Mini App -> Unity WebGL client -> Node.js backend -> MongoDB -> Telegram Stars payments.

Предположение: Unity-клиент собирается как WebGL и запускается внутри Telegram Mini App через HTML/JS shell.

## 1. Границы фазы 0

### Входит в фазу 0

- Telegram Mini App shell: HTML/JS-обертка, которая получает `initData` и открывает invoice.
- Unity WebGL клиент: экран загрузки, профиль, гараж, кнопка покупки.
- Один Node.js backend: REST API + Telegram webhook.
- MongoDB как source of truth по пользователю, гаражу и покупкам.
- Авторизация через `Telegram.WebApp.initData`.
- Создание и загрузка профиля игрока.
- Каталог из двух машин: стартовая и покупаемая за Telegram Stars.
- Стартовая машина, доступная каждому пользователю по умолчанию.
- Серверное создание purchase intent.
- Серверная фиксация успешной оплаты.
- Сохранение владения купленной машиной между сессиями.

### Не входит в фазу 0

- Гонки, результаты заездов, награды, турниры.
- Лидерборды, matchmaking, античит.
- Сложная экономика, валюты, инвентарь, тюнинг.
- Админка, CMS, BI-аналитика.
- WebSocket, push, realtime sync.
- Refund UI и dispute-flow.
- Микросервисы, Kubernetes, очереди, Redis, Kafka, CQRS.

### Специально откладываем

- Выбор активной машины в gameplay-flow.
- Историю всех транзакций в UI.
- Многотоварную корзину и наборы.
- Кросс-девайс восстановление кроме Telegram identity.
- Любые игровые механики, которые не нужны для вертикального среза auth -> garage -> pay -> persist.

## 2. Архитектурное описание решения

| Компонент | Роль | Чему нельзя доверять |
|---|---|---|
| Telegram Mini App shell | Доступ к `window.Telegram.WebApp`, передача `initData` в Unity, вызов `openInvoice` | `initDataUnsafe`, статусу оплаты из UI, ownership |
| Unity client | UI/UX, рендер гаража, вызовы backend, показ статусов | `carId` как истине, цене, факту покупки, составу гаража |
| Node.js backend | Валидация `initData`, выдача session token, профиль, каталог, purchase intent, webhook, выдача машины | Ничему, что пришло от клиента без проверки |
| MongoDB | Каноническое хранение пользователей, каталога, покупок, payment events | MongoDB не принимает бизнес-решения, только хранит состояние |
| Telegram Bot API / payments | Invoice UI, `pre_checkout_query`, `successful_payment` | Telegram не знает игровую логику, только подтверждает платеж |

### Source of truth

- Пользователь и его гараж: MongoDB, изменяется только backend.
- Факт успешной оплаты: Telegram `successful_payment`, затем зафиксирован backend в MongoDB.
- Цена машины: `carsCatalog` в БД, не клиент.
- Доступность машины для покупки: `carsCatalog.active` и `carsCatalog.isPurchasable`.

### Граница доверия

Клиенту нельзя доверять:

- `ownedCarIds`;
- цене;
- статусу оплаты;
- факту успешной покупки;
- пользовательским данным из `initDataUnsafe`;
- `carId` без серверной проверки.

Серверно подтверждаются:

- auth через Telegram init data;
- существование машины;
- доступность машины для покупки;
- актуальная цена;
- отсутствие владения;
- создание purchase intent;
- обработка webhook;
- выдача машины.

### Инварианты фазы 0

- Один `user` на один `telegramUserId`.
- У каждого пользователя всегда есть стартовая машина.
- На одну пару `user + car` одновременно не больше одного активного purchase intent.
- Машина выдается только после `successful_payment`.
- Повторная обработка одного payment event не меняет состояние повторно.

## 3. Последовательность пользовательского сценария

### Сценарий A. Первый вход пользователя

1. Пользователь открывает Mini App в Telegram.
2. JS shell получает `Telegram.WebApp.initData`.
3. JS shell передает raw `initData` в Unity через JS bridge.
4. Unity вызывает `POST /v1/auth/telegram`.
5. Backend валидирует `hash`, проверяет `auth_date`, извлекает `telegramUserId`.
6. Backend делает `findOneAndUpdate/upsert` пользователя по `telegramUserId`.
7. Если это новый пользователь, backend создает профиль и сразу добавляет стартовую машину.
8. Даже если пользователь старый, backend вызывает `ensureStarterCar`.
9. Backend выдает `accessToken` и bootstrap-данные профиля.
10. Unity вызывает `GET /v1/garage` или использует garage snapshot из auth response, если он возвращается.
11. Unity показывает гараж.

### Сценарий B. Повторный вход

1. Пользователь снова открывает Mini App.
2. Unity снова отправляет свежий `initData` на `POST /v1/auth/telegram`.
3. Backend находит пользователя по `telegramUserId`.
4. Backend обновляет `lastLoginAt` и косметические Telegram-поля.
5. Backend гарантирует наличие стартовой машины через `ensureStarterCar`.
6. Backend возвращает профиль.
7. Unity получает актуальный гараж через `GET /v1/garage`.
8. Купленная ранее машина уже есть в `ownedCarIds`, поэтому состояние восстанавливается без локальной магии.

### Сценарий C. Покупка машины за Telegram Stars

1. Unity показывает кнопку `Buy` только для неприобретенной машины.
2. По клику Unity вызывает `POST /v1/purchases/car-intents` с `carId`.
3. Backend проверяет:
   - машина существует;
   - машина активна;
   - машина покупаема;
   - машина не стартовая;
   - пользователь еще не владеет машиной.
4. Backend создает новый purchase intent или возвращает уже существующий активный non-expired intent для той же пары `user + car`.
5. Backend фиксирует price snapshot в `purchases.priceSnapshot`.
6. Backend вызывает Telegram Bot API `createInvoiceLink`:
   - `currency = XTR`;
   - `provider_token = ""`;
   - `title = carsCatalog.invoiceTitle`;
   - `description = carsCatalog.invoiceDescription`;
   - `payload = purchaseId`;
   - `prices = [{ label: carsCatalog.title, amount: priceSnapshot.amount }]`.
7. Backend возвращает Unity `purchaseId`, `invoiceUrl`, `expiresAt`, `price`.
8. Unity через JS shell вызывает `Telegram.WebApp.openInvoice(invoiceUrl)`.
9. Telegram присылает backend `pre_checkout_query`.
10. Backend за отведенное Telegram время проверяет intent, пользователя, price snapshot, отсутствие владения и срок действия.
11. Backend отвечает `answerPreCheckoutQuery(ok=true)` или `ok=false`.
12. При успешной оплате Telegram присылает `message.successful_payment`.
13. Backend дедуплицирует event.
14. Backend связывает `invoice_payload` с `purchase`.
15. Backend проверяет `from.id == purchase.telegramUserId`.
16. Backend фиксирует платеж и выдает машину пользователю.
17. Unity получает `invoiceClosed(status)` только как UX-подсказку.
18. Unity вызывает `GET /v1/purchases/:purchaseId`.
19. Если статус `granted`, Unity делает refetch `GET /v1/garage`.

### Сценарий D. Перезаход после покупки

1. Пользователь заново открывает Mini App.
2. Auth идет как обычно через `initData`.
3. Backend возвращает профиль.
4. Unity запрашивает `GET /v1/garage`.
5. Купленная машина уже находится в `users.ownedCarIds`.
6. UI показывает машину как принадлежащую пользователю.

## 4. Структура backend-модулей

Рекомендуемая структура:

```text
src/
  app.ts
  modules/
    auth/
      auth.routes.ts
      auth.service.ts
      telegram-init-data.ts
    users/
      users.model.ts
      users.repository.ts
      users.service.ts
      profile.routes.ts
    cars-catalog/
      cars.model.ts
      cars.repository.ts
      cars.service.ts
      seed-cars.ts
    garage/
      garage.routes.ts
      garage.service.ts
    payments/
      purchases.model.ts
      payments.routes.ts
      payments.service.ts
      grant-car.ts
    telegram/
      telegram.routes.ts
      telegram-bot.client.ts
      telegram-webhook.service.ts
    config/
      config.ts
    logging/
      logger.ts
  shared/
    errors.ts
    time.ts
    ids.ts
    validation.ts
  infra/
    mongo/
      client.ts
      indexes.ts
    http/
      auth-middleware.ts
      error-handler.ts
```

### Модули

| Модуль | Ответственность | Основные use cases | Связи |
|---|---|---|---|
| `auth` | Валидация `initData`, выдача backend token | `validateInitData`, `loginWithTelegram` | `users`, `config` |
| `users/profile` | Профиль игрока | `upsertByTelegramUser`, `getProfile`, `ensureStarterCar` | `garage` |
| `carsCatalog` | Каталог машин | `getActiveCars`, `getCarById`, `seedCatalog` | `garage`, `payments` |
| `garage` | Сборка garage view | `getGarageForUser`, `hasCar`, `grantCar` | `users`, `carsCatalog` |
| `payments` | Purchase intents и state machine | `createCarPurchaseIntent`, `getPurchaseStatus`, `markPaidAndGrant` | `carsCatalog`, `garage`, `telegram` |
| `telegram` | Bot API client + webhook parsing | `createInvoiceLink`, `answerPreCheckout`, `handleWebhookUpdate` | `payments`, `auth` |
| `config` | ENV, feature flags, secrets | `loadConfig`, `validateEnv` | все |
| `logging` | Структурные логи и correlation IDs | `logRequest`, `logPaymentEvent` | все |

## 5. Модель данных MongoDB

### `users`

Назначение: профиль игрока и владение машинами.

Пример документа:

```json
{
  "_id": "usr_01...",
  "telegramUserId": "123456789012",
  "firstName": "Ivan",
  "lastName": null,
  "username": "ivan_dev",
  "languageCode": "ru",
  "photoUrl": null,
  "isPremium": false,
  "ownedCarIds": ["starter_car"],
  "selectedCarId": "starter_car",
  "garageRevision": 1,
  "createdAt": "2026-04-09T10:00:00Z",
  "updatedAt": "2026-04-09T10:00:00Z",
  "lastLoginAt": "2026-04-09T10:00:00Z"
}
```

Обязательные поля:

- `_id`;
- `telegramUserId`;
- `ownedCarIds`;
- `garageRevision`;
- `createdAt`;
- `updatedAt`.

Индексы и уникальность:

- unique `{ telegramUserId: 1 }`.

Идемпотентность:

- выдачу машины делать через `$addToSet`;
- `garageRevision` увеличивать только при фактическом изменении гаража.

Поля, которые лучше хранить сразу:

- `selectedCarId`;
- `lastLoginAt`;
- `languageCode`;
- `isPremium`;
- `photoUrl`.

### `carsCatalog`

Назначение: каталог машин, seed-данные.

Пример стартовой машины:

```json
{
  "_id": "starter_car",
  "title": "Starter Car",
  "description": "Default starter car",
  "invoiceTitle": null,
  "invoiceDescription": null,
  "price": { "currency": "XTR", "amount": 0 },
  "isStarterDefault": true,
  "isPurchasable": false,
  "active": true,
  "sortOrder": 10,
  "updatedAt": "2026-04-09T10:00:00Z"
}
```

Пример покупаемой машины:

```json
{
  "_id": "second_car",
  "title": "Second Car",
  "description": "A faster-looking prototype car",
  "invoiceTitle": "Second Car",
  "invoiceDescription": "Unlock the second car",
  "price": { "currency": "XTR", "amount": 250 },
  "isStarterDefault": false,
  "isPurchasable": true,
  "active": true,
  "sortOrder": 20,
  "updatedAt": "2026-04-09T10:00:00Z"
}
```

Обязательные поля:

- `_id`;
- `title`;
- `price`;
- `isStarterDefault`;
- `isPurchasable`;
- `active`;
- `sortOrder`.

Индексы:

- unique `{ _id: 1 }`;
- `{ active: 1, sortOrder: 1 }`.

### `purchases`

Назначение: purchase intents и итог покупки.

Пример документа:

```json
{
  "_id": "pur_01...",
  "userId": "usr_01...",
  "telegramUserId": "123456789012",
  "carId": "second_car",
  "status": "invoice_ready",
  "isActiveIntent": true,
  "invoicePayload": "pur_01...",
  "invoiceUrl": "https://t.me/$...",
  "priceSnapshot": { "currency": "XTR", "amount": 250 },
  "expiresAt": "2026-04-09T10:15:00Z",
  "grantedAt": null,
  "createdAt": "2026-04-09T10:00:00Z",
  "updatedAt": "2026-04-09T10:00:00Z",
  "lastError": null
}
```

Статусы:

- `created`;
- `invoice_ready`;
- `pre_checkout_approved`;
- `paid`;
- `granted`;
- `cancelled`;
- `expired`;
- `failed`.

Обязательные поля:

- `_id`;
- `userId`;
- `telegramUserId`;
- `carId`;
- `status`;
- `invoicePayload`;
- `priceSnapshot`;
- `createdAt`;
- `updatedAt`.

Индексы:

- unique `{ invoicePayload: 1 }`;
- unique partial `{ telegramPaymentChargeId: 1 }` с `partialFilterExpression: { telegramPaymentChargeId: { $type: "string" } }`;
- `{ userId: 1, createdAt: -1 }`;
- partial unique `{ userId: 1, carId: 1, isActiveIntent: 1 }` для документов `{ isActiveIntent: true }`.

Идемпотентность:

- `invoicePayload` связывает Telegram invoice с внутренней покупкой;
- `telegramPaymentChargeId` дедуплицирует успешные оплаты;
- `isActiveIntent` не дает создать несколько активных intent на одну машину.

Правило для optional indexed fields:

- `preCheckoutQueryId`, `telegramPaymentChargeId`, `providerPaymentChargeId` не хранить как `null`;
- поле отсутствует до момента, когда Telegram реально прислал значение;
- все unique-индексы по optional полям должны быть partial, а не sparse, чтобы несколько документов без значения не конфликтовали.

Expiry active intent:

- если active intent истек и еще не оплачен, следующий `POST /v1/purchases/car-intents`, `GET /v1/purchases/:purchaseId` или `pre_checkout_query` должен лениво перевести его в `expired` и выставить `isActiveIntent = false`;
- после этого пользователь может создать новый intent на ту же машину;
- `successful_payment` после истечения intent все равно обрабатывается как оплаченный факт: если сумма, валюта, пользователь и payload валидны, backend выдает машину.

### `paymentEvents`

Назначение: журнал Telegram payment updates и дедупликация.

Пример документа:

```json
{
  "_id": "evt_01...",
  "telegramUpdateId": 123456789,
  "eventType": "successful_payment",
  "purchaseId": "pur_01...",
  "telegramPaymentChargeId": "54321",
  "rawUpdate": { "...": "..." },
  "processingResult": "applied",
  "processedAt": "2026-04-09T10:00:05Z"
}
```

Обязательные поля:

- `_id`;
- `telegramUpdateId`;
- `eventType`;
- `rawUpdate`;
- `processedAt`.

Индексы:

- unique `{ telegramUpdateId: 1 }`;
- unique partial `{ preCheckoutQueryId: 1 }` с `partialFilterExpression: { preCheckoutQueryId: { $type: "string" } }`;
- unique partial `{ telegramPaymentChargeId: 1 }` с `partialFilterExpression: { telegramPaymentChargeId: { $type: "string" } }`;
- `{ purchaseId: 1 }`.

Идемпотентность:

- `telegramUpdateId` защищает от повторной доставки одного update;
- `telegramPaymentChargeId` защищает от повторной обработки одной успешной оплаты.

### `sessions` или `authTokens`

Для фазы 0 отдельная коллекция не нужна.

Recommended default:

- stateless JWT access token;
- TTL 12 часов;
- новый token при каждом успешном `POST /v1/auth/telegram`.

Если позже понадобится logout/revoke, добавить отдельную коллекцию.

## 6. API-контракты backend

### `POST /v1/auth/telegram`

Назначение: логин по Telegram `initData`.

Auth: не нужен.

Request:

```json
{
  "initData": "query_id=...&user=...&auth_date=...&hash=..."
}
```

Response:

```json
{
  "accessToken": "jwt",
  "expiresInSec": 43200,
  "profile": {
    "userId": "usr_01...",
    "telegramUserId": "123456789012",
    "firstName": "Ivan",
    "ownedCarIds": ["starter_car"],
    "garageRevision": 1
  }
}
```

Ошибки:

- `400 INIT_DATA_REQUIRED`;
- `401 INIT_DATA_INVALID`;
- `401 INIT_DATA_EXPIRED`.

Обязательные проверки:

- raw string не пустой;
- `hash` валиден;
- `auth_date` свежий;
- есть `user.id`;
- `telegramUserId` извлечен из валидированного payload.

### `GET /v1/profile/me`

Назначение: получить профиль игрока.

Auth: `Bearer accessToken`.

Response:

```json
{
  "userId": "usr_01...",
  "telegramUserId": "123456789012",
  "firstName": "Ivan",
  "username": "ivan_dev",
  "ownedCarIds": ["starter_car", "second_car"],
  "garageRevision": 2
}
```

Ошибки:

- `401 UNAUTHORIZED`;
- `404 USER_NOT_FOUND`.

Проверки:

- валидный JWT;
- пользователь существует;
- `ensureStarterCar`.

### `GET /v1/garage`

Назначение: вернуть гараж в ready-to-render виде.

Auth: `Bearer accessToken`.

Response:

```json
{
  "garageRevision": 2,
  "cars": [
    {
      "carId": "starter_car",
      "title": "Starter Car",
      "owned": true,
      "price": { "currency": "XTR", "amount": 0 },
      "canBuy": false
    },
    {
      "carId": "second_car",
      "title": "Second Car",
      "owned": true,
      "price": { "currency": "XTR", "amount": 250 },
      "canBuy": false
    }
  ]
}
```

Ошибки:

- `401 UNAUTHORIZED`.

Проверки:

- валидный JWT;
- перед сборкой ответа вызвать `ensureStarterCar`;
- только активные машины;
- ownership считается на сервере.

### `POST /v1/purchases/car-intents`

Назначение: создать intent на покупку машины.

Auth: `Bearer accessToken`.

Request:

```json
{
  "carId": "second_car"
}
```

Response:

```json
{
  "purchaseId": "pur_01...",
  "status": "invoice_ready",
  "invoiceUrl": "https://t.me/$...",
  "expiresAt": "2026-04-09T10:15:00Z",
  "price": { "currency": "XTR", "amount": 250 }
}
```

Ошибки:

- `401 UNAUTHORIZED`;
- `404 CAR_NOT_FOUND`;
- `409 CAR_ALREADY_OWNED`;
- `422 CAR_NOT_PURCHASABLE`.

Проверки:

- машина существует;
- машина активна;
- машина покупаемая;
- машина не стартовая;
- пользователь еще не владеет машиной;
- если есть active non-expired intent на тот же `userId + carId`, вернуть его с `200 OK`, а не создавать новый;
- если есть active expired intent, лениво перевести его в `expired`, выставить `isActiveIntent = false` и создать новый intent.

### `GET /v1/purchases/:purchaseId`

Назначение: узнать итог состояния покупки после `invoiceClosed`.

Auth: `Bearer accessToken`.

Response:

```json
{
  "purchaseId": "pur_01...",
  "status": "granted",
  "carId": "second_car",
  "ownershipGranted": true,
  "garageRevision": 2
}
```

Ошибки:

- `401 UNAUTHORIZED`;
- `403 PURCHASE_FORBIDDEN`;
- `404 PURCHASE_NOT_FOUND`.

Проверки:

- purchase принадлежит текущему пользователю;
- если purchase истек, еще не оплачен и все еще `isActiveIntent = true`, лениво перевести его в `expired` и снять active flag перед ответом.

### `POST /v1/telegram/webhook`

Назначение: принять Telegram bot updates.

Auth: не bearer; обязательная защита через `X-Telegram-Bot-Api-Secret-Token`.

Secret path можно добавить как defense-in-depth, но он не заменяет проверку Telegram webhook secret token.

Request example: `pre_checkout_query`

```json
{
  "update_id": 123456788,
  "pre_checkout_query": {
    "id": "pcq_01...",
    "from": { "id": 123456789012 },
    "currency": "XTR",
    "total_amount": 250,
    "invoice_payload": "pur_01..."
  }
}
```

Request example: `message.successful_payment`

```json
{
  "update_id": 123456789,
  "message": {
    "from": { "id": 123456789012 },
    "successful_payment": {
      "currency": "XTR",
      "total_amount": 250,
      "invoice_payload": "pur_01...",
      "telegram_payment_charge_id": "54321",
      "provider_payment_charge_id": ""
    }
  }
}
```

Response:

```json
{
  "ok": true
}
```

Ошибки:

- `401 INVALID_WEBHOOK_SECRET`;
- `400 BAD_UPDATE`.

Проверки:

- валиден `X-Telegram-Bot-Api-Secret-Token`, сравнение constant-time;
- дедуп по `update_id`;
- обработка только `pre_checkout_query` и `message.successful_payment`;
- `invoice_payload` существует и указывает на purchase;
- `from.id == purchase.telegramUserId`;
- `currency == XTR`;
- `total_amount == purchase.priceSnapshot.amount`.

### Механизм обновления состояния после оплаты

Recommended default:

- Unity вызывает `GET /v1/purchases/:purchaseId`;
- если статус `granted`, Unity вызывает `GET /v1/garage`;
- WebSocket для фазы 0 не нужен.

## 7. Контракт между Unity и backend

### Как Unity работает с backend

1. Получает raw `initData` через JS bridge.
2. На каждом cold start вызывает `POST /v1/auth/telegram`.
3. Сохраняет `accessToken` только на время текущей сессии.
4. Для всех API использует `Authorization: Bearer <token>`.
5. Для отображения гаража вызывает `GET /v1/garage`.
6. Для покупки вызывает `POST /v1/purchases/car-intents`.
7. Передает `invoiceUrl` в JS shell.
8. JS shell вызывает `Telegram.WebApp.openInvoice(invoiceUrl)`.
9. После `invoiceClosed` Unity не верит статусу как source of truth, а вызывает backend.

### Когда делать refetch профиля или гаража

- После успешного auth.
- После `invoiceClosed` со статусом `paid` или `pending`.
- После ответа `GET /v1/purchases/:id` со статусом `granted`.
- При повторном входе.
- После `401`, если удалось переавторизоваться через свежий `initData`.

### Как минимизировать рассинхрон

- UI оптимистично может показывать `Processing payment`, но не `Owned`.
- `Owned` показывать только после backend response.
- На каждом входе серверный garage snapshot перетирает локальный кэш.
- Использовать `garageRevision` для понимания, что локальный garage устарел.

### Что можно кэшировать локально

- Последний snapshot гаража для быстрого skeleton UI.
- `purchaseId` последней незавершенной покупки.
- Косметические данные профиля.

### Что нельзя считать локально достоверным

- Ownership машин.
- Цену.
- Статус оплаты.
- Доступность машины для покупки.
- Факт успешной покупки.

### Поведение при сбоях сети

- Если intent создан, но ответ не дошел: повторный `POST /purchases/car-intents` должен вернуть уже существующий активный intent.
- Если invoice закрыт, но статус неясен: Unity хранит `purchaseId`, показывает `Processing payment`, опрашивает `GET /purchases/:id`.
- Если клиент закрылся: на следующем входе `auth + GET /garage` восстановят состояние.
- Если backend временно недоступен после оплаты: Unity показывает `Payment processing, please reopen app later` и при следующем входе делает refetch.

## 8. Telegram auth и Telegram Stars

### Telegram auth

Backend принимает именно raw `Telegram.WebApp.initData`.

Backend должен:

- распарсить query string;
- извлечь `hash`;
- построить `data_check_string`;
- проверить HMAC-SHA256 с bot token;
- проверить `auth_date`;
- извлечь `user.id`;
- привязать профиль к `telegramUserId`.

Recommended default:

- хранить `telegramUserId` как string;
- все Telegram user ids из `initData`, `pre_checkout_query.from.id` и `message.from.id` нормализовать в decimal string сразу после parsing;
- считать `initData` истекшим, если `auth_date` старше 15 минут;
- не использовать `initDataUnsafe` как доверенный источник.

### Telegram Stars payment

Recommended default:

- использовать `createInvoiceLink`;
- открывать invoice через `Telegram.WebApp.openInvoice`;
- для Stars использовать `currency = XTR`;
- `provider_token` для Stars передавать пустым;
- `payload` делать opaque: `purchaseId`;
- перед реализацией сверить актуальные детали с официальными docs: `https://core.telegram.org/bots/webapps`, `https://core.telegram.org/bots/payments-stars`, `https://core.telegram.org/bots/api`.

Минимальный request к Telegram Bot API `createInvoiceLink`:

```json
{
  "title": "Second Car",
  "description": "Unlock the second car",
  "payload": "pur_01...",
  "provider_token": "",
  "currency": "XTR",
  "prices": [
    { "label": "Second Car", "amount": 250 }
  ]
}
```

Правила:

- `title`, `description` и `prices` берутся с backend из `carsCatalog`, не от клиента;
- для Stars в фазе 0 использовать один `prices` item на покупку одной машины;
- `amount` должен совпадать с `purchase.priceSnapshot.amount`;
- `invoiceClosed` в Mini App не является подтверждением оплаты, это только UX-событие для polling backend.

### Связь invoice/payment payload с внутренними сущностями

`payload = purchaseId`.

Это дает простую и надежную связку:

- webhook получает `invoice_payload`;
- backend ищет purchase по `invoicePayload`;
- backend проверяет пользователя, сумму, статус;
- backend выдает конкретную машину из `purchase.carId`.

### Обработка `pre_checkout_query`

Backend должен:

1. Сохранить или дедуплицировать event по `update_id` / `pre_checkout_query.id`.
2. Найти purchase по `invoice_payload`.
3. Нормализовать `from.id` в string и проверить `from.id == purchase.telegramUserId`.
4. Проверить `purchase.status` допустим для оплаты.
5. Проверить `expiresAt`; если intent истек, лениво перевести его в `expired`, снять `isActiveIntent` и ответить `ok=false`.
6. Проверить, что пользователь еще не владеет машиной.
7. Проверить `currency == XTR`.
8. Проверить `total_amount == purchase.priceSnapshot.amount`.
9. Ответить `answerPreCheckoutQuery(ok=true)` или `ok=false` в пределах 10 секунд.

В обработчике `pre_checkout_query` не должно быть долгих внешних операций, кроме ответа Telegram. Все проверки должны укладываться в быстрые локальные чтения/записи MongoDB.

### Обработка `successful_payment`

Backend должен:

1. Дедуплицировать update по `telegramUpdateId`.
2. Найти purchase по `successful_payment.invoice_payload`.
3. Проверить `telegramPaymentChargeId`.
4. Нормализовать `from.id` в string и проверить `from.id == purchase.telegramUserId`.
5. Проверить сумму и валюту.
6. В одной MongoDB transaction:
   - сохранить `paymentEvents`;
   - обновить purchase до `paid/granted`;
   - добавить `carId` пользователю через `$addToSet`;
   - увеличить `garageRevision`, если машина была добавлена впервые;
   - снять `isActiveIntent`.
7. Вернуть Telegram `200 OK` только после успешного commit.

Повторный `successful_payment` после уже успешного commit:

- если `telegramUpdateId` или `telegramPaymentChargeId` уже обработан для того же `purchaseId`, вернуть `200 OK` без повторной выдачи;
- если тот же `telegramPaymentChargeId` пришел с другим `invoice_payload`, не выдавать машину, записать событие как подозрительный duplicate и вернуть безопасный `200 OK`, чтобы Telegram не ретраил бесконечно.

## 9. Идемпотентность, консистентность, edge cases

| Ситуация | Обработка |
|---|---|
| Пользователь нажал купить два раза | partial unique index на активный intent; второй запрос возвращает тот же intent |
| Telegram прислал один и тот же payment event повторно | dedupe по `telegramUpdateId` и `telegramPaymentChargeId`, ответ `200` без повторной выдачи |
| Backend упал после успешной оплаты, но до выдачи | не отдавать `200` Telegram до commit; использовать Mongo transaction на `paymentEvents + purchases + users` |
| Клиент не получил подтверждение, хотя покупка реально прошла | polling `GET /purchases/:id`, а при следующем входе `GET /garage` восстановит ownership |
| Клиент показывает устаревший гараж | refetch на входе и после покупки; локальный snapshot не authoritative |
| Машина уже куплена | `POST /purchases/car-intents` возвращает `409 CAR_ALREADY_OWNED`; `pre_checkout_query` тоже отвергается |
| Цена машины изменилась между открытием экрана и покупкой | клиент цену не присылает; intent создается по текущему серверному каталогу и фиксирует `priceSnapshot` |
| Пользователь пытается подменить `carId` на клиенте | backend валидирует `carId` по `carsCatalog`, ownership и purchasable-флаг |
| Intent создан, но invoice link не дошел до клиента | повторный запрос возвращает уже существующий активный intent |
| Active intent истек без оплаты | следующий intent/status/pre-checkout лениво переводит его в `expired`, снимает `isActiveIntent`, затем можно создать новый intent |
| Стартовая машина отсутствует у старого пользователя | `ensureStarterCar` на auth, profile read и garage read делает `$addToSet`; если машина добавлена впервые, увеличивает `garageRevision` |
| Webhook пришел после истечения intent | если Telegram уже прислал `successful_payment`, факт оплаты важнее expiry; выдавать машину после проверок суммы и пользователя |
| `pre_checkout_query` пришел после того, как машина уже куплена | ответить `ok=false` с понятной ошибкой |
| Клиент вызывает `GET /purchases/:id` чужой покупки | вернуть `403 PURCHASE_FORBIDDEN` |
| Тот же `telegramPaymentChargeId` пришел с другим payload | не выдавать машину, записать suspicious duplicate, вернуть безопасный `200 OK` |

### Отдельно про выдачу стартовой машины

Стартовая машина должна выдаваться и восстанавливаться на сервере:

1. При создании пользователя:

```js
ownedCarIds: ["starter_car"]
selectedCarId: "starter_car"
garageRevision: 1
```

2. При каждом auth/profile/garage read:

```js
const user = await db.users.findOne({ _id: userId })

const addResult = await db.users.updateOne(
  { _id: userId, ownedCarIds: { $ne: "starter_car" } },
  {
    $addToSet: { ownedCarIds: "starter_car" },
    $inc: { garageRevision: 1 },
    $set: { updatedAt: now }
  }
)

const ownedAfterEnsure = addResult.modifiedCount === 1
  ? [...user.ownedCarIds, "starter_car"]
  : user.ownedCarIds

if (!user.selectedCarId || !ownedAfterEnsure.includes(user.selectedCarId)) {
  await db.users.updateOne(
    { _id: userId },
    { $set: { selectedCarId: "starter_car", updatedAt: now } }
  )
}
```

Правила:

- `garageRevision` увеличивать только если `starter_car` реально была добавлена впервые;
- `selectedCarId` чинить на `starter_car`, если поле отсутствует или указывает на машину, которой пользователь не владеет;
- клиент не может запросить или отменить выдачу стартовой машины.

Это дешевле и надежнее, чем надеяться только на миграцию.

### Отдельно про двойную выдачу машины

Выдачу купленной машины делать атомарно:

1. Найти purchase по `invoicePayload`.
2. Проверить, что `telegramPaymentChargeId` еще не обработан.
3. Сделать `$addToSet: { ownedCarIds: carId }`.
4. Если `modifiedCount` говорит, что машина реально добавлена, увеличить `garageRevision`.
5. Purchase перевести в `granted`.
6. Повторный webhook должен увидеть уже `granted` и завершиться без изменений.

## 10. Пошаговый roadmap реализации

| Шаг | Результат | Зависимости | Что тестировать |
|---|---|---|---|
| 1. Поднять backend skeleton | Fastify app, healthcheck, общий error handler | нет | сервер стартует, `/health` отвечает |
| 2. Настроить config и env | `BOT_TOKEN`, `MONGO_URI`, `JWT_SECRET`, webhook secret | шаг 1 | fail-fast на битом env |
| 3. Подключить MongoDB | Mongo client, indexes bootstrap | шаг 2 | подключение, создание индексов |
| 4. Поднять Mongo как single-node replica set | доступны транзакции | шаг 3 | transaction smoke test |
| 5. Засидить `carsCatalog` | `starter_car` и `second_car` в БД | шаг 3 | каталог читается |
| 6. Реализовать auth flow | валидация `initData`, JWT | шаг 2 | happy-path, invalid hash, expired auth_date |
| 7. Реализовать users/profile | upsert пользователя, `ensureStarterCar` | шаг 6 | первый вход, повторный вход |
| 8. Реализовать garage | `GET /v1/garage` с `ensureStarterCar` | шаг 5,7 | стартовая машина видна, second car не owned |
| 9. Ранний Mini App + Unity auth smoke | JS shell передает raw `initData` в Unity, Unity делает auth и `GET /garage` | шаг 6,8 | реальный Telegram client открывает Mini App и видит garage |
| 10. Реализовать Telegram bot client | `createInvoiceLink`, `answerPreCheckoutQuery` | шаг 2 | mock Bot API или stage bot |
| 11. Реализовать purchase intent | `POST /v1/purchases/car-intents` с idempotent retry и lazy expiry | шаг 5,7,10 | intent создается, дубли не плодятся, expired intent освобождает active slot |
| 12. Проверить invoice opening smoke | Unity/JS shell вызывает `openInvoice(invoiceUrl)` | шаг 9,11 | invoice открывается в Telegram, клиент не верит `invoiceClosed` как оплате |
| 13. Реализовать `paymentEvents` и webhook skeleton | `POST /v1/telegram/webhook`, secret token, dedupe indexes | шаг 10 | secret проверяется, duplicate update не ломает обработку |
| 14. Реализовать `pre_checkout_query` | approve/reject checkout за 10 секунд | шаг 11,13 | already owned, expired, wrong amount, wrong user |
| 15. Реализовать `successful_payment` | idempotent grant car в Mongo transaction | шаг 14 | duplicate event, duplicate charge id, ownership persistence |
| 16. Реализовать `GET /purchases/:id` | Unity может polling-ить статус | шаг 11,15 | status меняется до `granted`, чужая покупка дает `403` |
| 17. Реализовать Unity garage UI | отображение owned/canBuy | шаг 8,9 | гараж показывает server state |
| 18. Добавить базовые логи | request id, purchase id, webhook id | шаг 13-15 | payment flow дебажится по логам |
| 19. Провести e2e тест фазы 0 | полный vertical slice | все выше | first login -> buy -> reopen |

## 11. Приоритеты разработки

### Критично для запуска фазы 0

- `initData` auth.
- `users` + starter car invariant.
- `carsCatalog`.
- `GET /garage`.
- `purchase intent`.
- `createInvoiceLink`.
- `pre_checkout_query`.
- `successful_payment` + idempotent grant.
- `paymentEvents` для webhook dedupe.
- `GET /purchases/:id`.
- Базовые integration tests для auth, starter car, purchase и duplicate webhook.
- Persistence ownership между сессиями.
- Unity bridge для `initData` и `openInvoice`.

### Желательно

- Structured JSON logs с `purchaseId`, `telegramUpdateId`.
- Raw audit в `paymentEvents` с ограничением размера payload, если понадобится для отладки.

### Можно отложить

- Простая repair-команда для `paid but not granted`; нормальный flow фазы 0 не должен коммитить `paid` отдельно от `grant`.
- Refund UI.
- История платежей в профиле.
- Выбор активной машины.
- Админка каталога.
- Push/notifications.
- WebSocket.
- Сложная аналитика.

## 12. Набор технических решений по умолчанию

Recommended default stack:

| Область | Выбор |
|---|---|
| API стиль | REST JSON |
| Язык | TypeScript |
| HTTP framework | Fastify |
| Mongo access | Official MongoDB driver |
| Валидация входа | Zod |
| Логи | Pino JSON |
| Auth token | JWT HS256 |
| Config | `.env` локально + env vars в stage/prod |
| Error handling | Единый error mapper `{ code, message, details? }` |
| Env | `dev`, `stage`, `prod` |
| Mongo режим | Single-node replica set даже в dev |

Почему так:

- `Fastify + TypeScript + Zod + mongodb driver` дает минимальный вес и понятную типизацию.
- REST проще для Unity и ручного дебага.
- MongoDB transaction достаточно для payment/grant без Redis и очередей.
- NestJS можно взять позже, но для фазы 0 он добавит больше структуры, чем пользы.

## 13. Минимальный набор тестов

### Unit tests

- Валидация Telegram `initData`.
- `ensureStarterCar`.
- `createCarPurchaseIntent`: first intent, повторный retry, expired intent освобождает active slot.
- `pre_checkout` validation.
- `grantCar` idempotency.
- Нормализация Telegram user id в string.
- Маппинг ошибок в API response.

### Integration tests

- `POST /auth/telegram` создает пользователя.
- Повторный auth не дублирует пользователя.
- `GET /garage` возвращает starter car.
- `GET /garage` восстанавливает отсутствующий `starter_car` у существующего пользователя и корректно двигает `garageRevision`.
- `POST /purchases/car-intents` создает один активный intent.
- Повторный `POST /purchases/car-intents` возвращает тот же active intent и не плодит дубли.
- Несколько пользователей с pending intents без `telegramPaymentChargeId` не конфликтуют по unique indexes.
- Истекший active intent переводится в `expired`, снимает `isActiveIntent` и позволяет создать новый intent.
- `pre_checkout_query` отклоняет wrong user, wrong amount, wrong currency, expired intent и already owned.
- `successful_payment` добавляет машину.
- Повторный `successful_payment` не выдает машину дважды.
- Повторный `successful_payment` после успешного commit возвращает безопасный `200 OK`.
- Тот же `telegramPaymentChargeId` с другим `invoice_payload` не выдает машину.
- `GET /purchases/:id` возвращает `403` для чужой покупки.
- Перезаход после покупки возвращает купленную машину.

### E2E / manual flows

- Первый вход.
- Повторный вход.
- Покупка второй машины за Stars.
- `openInvoice` открывается из реального Telegram Mini App shell.
- Повторное открытие Mini App после покупки.
- `invoiceClosed = paid`, но клиент не успел получить `GET /purchases/:id`.
- Клиент закрылся сразу после оплаты до любого polling.
- Повторная доставка одного webhook update.
- Неверный webhook secret.
- Попытка купить уже купленную машину.

## 14. Что подготовить для следующей фазы

Чтобы потом без боли перейти к бесплатным гонкам, результатам заездов, наградам и турнирам, в фазе 0 полезно сразу:

- хранить `selectedCarId`, даже если UI выбора пока не нужен;
- держать стабильные `carId`, чтобы потом ссылаться на них в гонках и наградах;
- хранить `garageRevision`, чтобы позже синхронизировать состояние после гонок;
- не смешивать payments и gameplay;
- держать выдачу ownership как отдельный use case `grantCar`;
- хранить `telegramPaymentChargeId` сразу после `successful_payment` и не хранить это поле как `null` до оплаты;
- использовать серверные timestamps;
- не добавлять пока `raceRuns`, `rewards`, `tournaments`, но проектировать код так, чтобы их можно было добавить отдельными модулями.

## Краткий рекомендуемый порядок старта

1. Поднять backend skeleton на Fastify + TypeScript.
2. Подключить MongoDB как single-node replica set и засидить две машины.
3. Реализовать Telegram auth, профиль и `GET /garage` с инвариантом стартовой машины.
4. Сделать Mini App shell + Unity WebGL bridge для raw `initData` и пройти auth -> garage smoke в реальном Telegram client.
5. Реализовать purchase intent через `createInvoiceLink`.
6. Проверить `openInvoice(invoiceUrl)` из Unity/JS shell.
7. Реализовать webhook skeleton с secret token, `paymentEvents` и dedupe.
8. Реализовать webhook `pre_checkout_query`.
9. Реализовать webhook `successful_payment` и idempotent grant.
10. Добавить Unity polling `GET /purchases/:id`.
11. Пройти e2e сценарий: first login -> garage -> buy second car -> reopen -> car still owned.

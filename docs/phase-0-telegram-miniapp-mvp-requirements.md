# Phase 0 Telegram Mini App MVP Requirements

## Цель MVP

Собрать минимальный вертикальный срез мобильной игры в Telegram Mini App:

`Telegram Mini App -> Unity WebGL -> Backend -> MongoDB -> Telegram Stars -> Backend grant -> Persistent garage`

После фазы 0 пользователь должен войти через Telegram, увидеть гараж со стартовой машиной, купить вторую машину за Telegram Stars и увидеть ее в гараже после повторного входа.

## Основной функционал

### Пользователь

- Открывает Telegram Mini App.
- Unity WebGL клиент получает raw `Telegram.WebApp.initData` через JS shell.
- Клиент логинится через backend.
- Пользователь получает профиль и гараж.
- В гараже всегда есть стартовая машина `starter_car`.
- Пользователь может купить одну дополнительную машину `second_car` за Telegram Stars.
- После успешной оплаты купленная машина появляется в гараже.
- После закрытия и повторного открытия Mini App купленная машина сохраняется.

### Backend

- Валидирует raw Telegram `initData`.
- Создает или находит пользователя по `telegramUserId`.
- Гарантирует наличие стартовой машины на auth/profile/garage read.
- Отдает серверный garage snapshot.
- Создает или переиспользует purchase intent.
- Создает Telegram invoice link.
- Обрабатывает `pre_checkout_query`.
- Обрабатывает `successful_payment`.
- Выдает машину только после подтвержденной оплаты от Telegram.
- Дедуплицирует повторные webhook events.

## Вне scope фазы 0

- Гонки и gameplay.
- Лидерборды, matchmaking, античит.
- Тюнинг, награды, внутриигровые валюты, сложная экономика.
- Админка, CMS, BI-аналитика.
- Refund UI и dispute-flow.
- WebSocket/realtime sync.
- Микросервисы, Kubernetes, Kafka, Redis, CQRS.
- Архитектура под миллионы пользователей.

## Data Flows

### 1. Первый вход

1. Telegram открывает Mini App.
2. JS shell получает raw `Telegram.WebApp.initData`.
3. Unity отправляет `initData` в `POST /v1/auth/telegram`.
4. Backend валидирует `hash`, `auth_date`, извлекает `user.id`.
5. Backend создает пользователя, если его нет.
6. Backend добавляет `starter_car`.
7. Unity вызывает `GET /v1/garage`.
8. Backend возвращает гараж из MongoDB.

### 2. Повторный вход

1. Unity снова проходит `POST /v1/auth/telegram`.
2. Backend находит пользователя.
3. Backend вызывает `ensureStarterCar`.
4. Unity вызывает `GET /v1/garage`.
5. Все купленные машины восстанавливаются из MongoDB.

### 3. Создание покупки

1. Unity вызывает `POST /v1/purchases/car-intents` с `carId`.
2. Backend проверяет машину, цену, purchasable-флаг и ownership.
3. Backend возвращает существующий active non-expired intent или создает новый.
4. Backend фиксирует `priceSnapshot`.
5. Backend вызывает Telegram `createInvoiceLink`.
6. Unity получает `purchaseId` и `invoiceUrl`.

### 4. Telegram checkout

1. Unity/JS shell открывает invoice через `Telegram.WebApp.openInvoice(invoiceUrl)`.
2. Telegram присылает backend `pre_checkout_query`.
3. Backend проверяет webhook secret, payload, user, amount, currency, expiry, ownership.
4. Backend отвечает `answerPreCheckoutQuery(ok=true/false)`.
5. Машина на этом этапе еще не выдается.

### 5. Успешная оплата и grant

1. Telegram присылает `message.successful_payment`.
2. Backend дедуплицирует update/payment.
3. Backend проверяет `invoice_payload`, `telegramPaymentChargeId`, user, amount, currency.
4. Backend в MongoDB transaction:
   - сохраняет `paymentEvents`;
   - переводит purchase в `granted`;
   - добавляет машину через `$addToSet`;
   - увеличивает `garageRevision`, если машина добавлена впервые;
   - снимает `isActiveIntent`.
5. Backend возвращает Telegram `200 OK` только после commit.

### 6. Клиент узнает результат

1. Unity не доверяет `invoiceClosed(status)`.
2. Unity вызывает `GET /v1/purchases/:purchaseId`.
3. Если статус `granted`, Unity вызывает `GET /v1/garage`.
4. Если клиент закрылся после оплаты, следующий вход все равно восстановит ownership через `GET /v1/garage`.

## Минимальная модель данных

### `users`

- `telegramUserId`
- профильные Telegram-поля
- `ownedCarIds`
- `selectedCarId`
- `garageRevision`
- timestamps

Ключевой индекс: unique `{ telegramUserId: 1 }`.

### `carsCatalog`

- `starter_car`
- `second_car`
- цена в `XTR`
- `isStarterDefault`
- `isPurchasable`
- `active`
- invoice title/description

### `purchases`

- `userId`
- `telegramUserId`
- `carId`
- `status`
- `isActiveIntent`
- `invoicePayload`
- `priceSnapshot`
- `telegramPaymentChargeId`
- `expiresAt`
- `grantedAt`

Критично:

- `invoicePayload` unique.
- `telegramPaymentChargeId` unique partial.
- active intent unique partial по `userId + carId + isActiveIntent`.
- Optional indexed fields не хранить как `null`; поле отсутствует, пока значения нет.

### `paymentEvents`

- `telegramUpdateId`
- `eventType`
- `purchaseId`
- `preCheckoutQueryId`
- `telegramPaymentChargeId`
- raw/sanitized update
- processing result

Критично:

- dedupe по `telegramUpdateId`;
- dedupe по `preCheckoutQueryId`;
- dedupe по `telegramPaymentChargeId`;
- unique indexes по optional fields должны быть partial, не sparse.

## API MVP

- `POST /v1/auth/telegram`
- `GET /v1/profile/me`
- `GET /v1/garage`
- `POST /v1/purchases/car-intents`
- `GET /v1/purchases/:purchaseId`
- `POST /v1/telegram/webhook`

## Trust Boundaries

Клиенту нельзя доверять:

- ownership;
- price;
- payment status;
- `initDataUnsafe`;
- `carId` без серверной проверки;
- `invoiceClosed(status)`.

Backend доверяет оплате только после Telegram `successful_payment`, доставленного через защищенный webhook.

## Ключевые решения и rationale

### MongoDB - source of truth

Решение: все состояние профиля, гаража и покупки хранится в MongoDB.

Почему: Unity WebGL и Telegram Mini App могут закрыться в любой момент. Локальный клиентский state годится только для UI cache, но не для ownership.

### Raw `initData`, не `initDataUnsafe`

Решение: backend принимает и валидирует только raw `Telegram.WebApp.initData`.

Почему: `initDataUnsafe` удобен для UI, но не является доверенным источником identity. Без backend HMAC validation любой клиент мог бы подменить пользователя.

### Один backend, без микросервисов

Решение: один Node.js backend с REST API и Telegram webhook.

Почему: фаза 0 проверяет один vertical slice, а не масштабирование. Микросервисы, Kafka, Redis и CQRS добавили бы больше failure modes, чем пользы.

### Telegram payment grant только на `successful_payment`

Решение: машина не выдается на `pre_checkout_query` и не выдается по `invoiceClosed`.

Почему: `pre_checkout_query` только разрешает оплату, а `invoiceClosed` приходит клиенту и не является authoritative. Единственный надежный payment signal - Telegram `successful_payment` на backend webhook.

### Idempotent purchase intent

Решение: повторный `POST /v1/purchases/car-intents` возвращает существующий active non-expired intent.

Почему: если клиент не получил ответ после первого запроса, retry не должен создавать новый invoice или блокировать пользователя ошибкой `409`.

### Lazy expiry для intent

Решение: истекший unpaid active intent снимается при следующем intent/status/pre-checkout.

Почему: отдельный scheduler для MVP не нужен. Lazy cleanup проще и достаточен, но не дает пользователю навсегда застрять на unique active intent index.

### Partial unique indexes вместо sparse + null

Решение: optional payment fields не хранятся как `null`; unique indexes по ним partial.

Почему: MongoDB sparse index включает документы, где поле существует со значением `null`. Это может вызвать duplicate key на нескольких pending purchases. Partial indexes по string-полям избегают этого.

### MongoDB transaction для payment + grant

Решение: `paymentEvents`, `purchases` и `users` обновляются в одной transaction.

Почему: нельзя коммитить состояние, где оплата зафиксирована, но машина не выдана. Для этого dev/prod Mongo должен поддерживать transactions, минимум single-node replica set.

### `GET /purchases/:purchaseId` обязателен

Решение: endpoint входит в критичный MVP scope.

Почему: это recovery path для сценариев, где клиент не получил подтверждение после invoice или закрылся сразу после оплаты.

### Webhook secret token обязателен

Решение: `POST /v1/telegram/webhook` обязан проверять `X-Telegram-Bot-Api-Secret-Token`.

Почему: secret path может быть дополнительной защитой, но не должен заменять проверку Telegram webhook secret token.

### Ранний vertical slice

Решение: Mini App shell + Unity bridge для `initData` проверяется рано, до полной payment-логики.

Почему: Telegram client, WebGL bridge и `openInvoice` - самые рискованные интеграционные места. Их нужно проверить до того, как backend будет полностью готов.

## Acceptance Criteria

MVP считается готовым, если:

- новый пользователь входит через Telegram и получает `starter_car`;
- повторный вход не создает дубль пользователя;
- `GET /v1/garage` восстанавливает гараж из MongoDB;
- покупка `second_car` открывает Telegram Stars invoice;
- `pre_checkout_query` не выдает машину;
- `successful_payment` выдает машину ровно один раз;
- duplicate webhook не меняет состояние повторно;
- после закрытия и повторного открытия Mini App купленная машина остается в гараже;
- клиент нигде не является source of truth для ownership, price или payment status.

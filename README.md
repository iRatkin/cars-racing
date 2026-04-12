# Telegram Miniapp Cars API

Backend для Telegram Mini App: авторизация по `initData`, гараж пользователя, покупка race coins за Telegram Stars, покупка машин за race coins, прием Telegram webhook.

## Быстрый запуск

Из корня проекта:

```bash
docker compose up --build
```

API будет доступен на `http://localhost:3000`.

Проверка:

```bash
curl http://localhost:3000/health
```

Остановка:

```bash
docker compose down
```

С удалением Mongo-данных:

```bash
docker compose down -v
```

## Переменные окружения

Основные:

- `BOT_TOKEN`
- `JWT_SECRET`
- `TELEGRAM_WEBHOOK_SECRET`
- `MONGO_URI`

В `docker-compose.yml` уже есть dev-значения по умолчанию, так что проект запускается и без `.env`.

## Эндпоинты

### `GET /health`

Проверка здоровья сервиса.

Ответ:

```json
{ "ok": true }
```

### `POST /v1/auth/telegram`

Авторизация пользователя Telegram Mini App.

Тело запроса:

```json
{
  "initData": "auth_date=...&user=...&hash=..."
}
```

Успешный ответ:

```json
{
  "accessToken": "jwt-token",
  "expiresInSec": 43200,
  "profile": {
    "userId": "usr_123456789",
    "telegramUserId": "123456789",
    "firstName": "Ivan",
    "username": "ivan_dev",
    "ownedCarIds": ["car0"],
    "garageRevision": 1,
    "raceCoinsBalance": 0
  }
}
```

Ошибки: `INIT_DATA_REQUIRED` (400), `INIT_DATA_INVALID` (401)

### `GET /v1/garage`

Возвращает гараж пользователя. Нужен bearer token из `/v1/auth/telegram`.

Заголовок:

```text
Authorization: Bearer <accessToken>
```

Успешный ответ:

```json
{
  "garageRevision": 1,
  "raceCoinsBalance": 50,
  "cars": [
    {
      "carId": "car0",
      "title": "car0",
      "owned": true,
      "price": { "currency": "RC", "amount": 0 },
      "canBuy": false
    },
    {
      "carId": "car1",
      "title": "car1",
      "owned": false,
      "price": { "currency": "RC", "amount": 25 },
      "canBuy": true
    },
    {
      "carId": "car2",
      "title": "car2",
      "owned": false,
      "price": { "currency": "RC", "amount": 50 },
      "canBuy": true
    }
  ]
}
```

Ошибки: `UNAUTHORIZED` (401), `USER_NOT_FOUND` (404)

### `POST /v1/purchases/coins-intents`

Создает или переиспользует purchase intent для покупки бандла race coins за Telegram Stars. Нужен bearer token.

Заголовок:

```text
Authorization: Bearer <accessToken>
```

Тело запроса:

```json
{
  "bundleId": "rc_bundle_50"
}
```

Доступные bundleId: `rc_bundle_10` (10 coins), `rc_bundle_20` (20 coins), `rc_bundle_50` (50 coins), `rc_bundle_100` (100 coins). Все стоят 1 XTR.

Успешный ответ:

```json
{
  "purchaseId": "pur_abc123",
  "status": "invoice_ready",
  "invoiceUrl": "https://t.me/invoice/pur_abc123",
  "expiresAt": "2026-04-12T12:15:00.000Z",
  "price": { "currency": "XTR", "amount": 1 },
  "coinsAmount": 50
}
```

Ошибки: `BUNDLE_ID_REQUIRED` (400), `UNAUTHORIZED` (401), `BUNDLE_NOT_FOUND` (404), `USER_NOT_FOUND` (404)

### `POST /v1/purchases/buy-car`

Покупка машины за race coins. Нужен bearer token.

Заголовок:

```text
Authorization: Bearer <accessToken>
```

Тело запроса:

```json
{
  "carId": "car1"
}
```

Успешный ответ:

```json
{
  "success": true,
  "carId": "car1",
  "raceCoinsBalance": 25,
  "garageRevision": 2
}
```

Ошибки: `CAR_ID_REQUIRED` (400), `UNAUTHORIZED` (401), `CAR_NOT_FOUND` (404), `USER_NOT_FOUND` (404), `CAR_ALREADY_OWNED` (409), `CAR_NOT_PURCHASABLE` (422), `INSUFFICIENT_BALANCE` (422)

### `POST /v1/telegram/webhook`

Webhook для Telegram Bot API.

Заголовок:

```text
x-telegram-bot-api-secret-token: <secret>
```

Тело запроса:

```json
{
  "update_id": 1,
  "...": "telegram update payload"
}
```

Успешный ответ:

```json
{ "ok": true }
```

Ошибка: `INVALID_WEBHOOK_SECRET` (401)

## Полезно

- OpenAPI-описание лежит в `swagger.yaml`
- Docker-образ собирается из `Dockerfile`
- Основной runtime стартует из `src/server.ts`

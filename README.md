# Telegram Miniapp Cars API

Небольшой backend для Telegram Mini App: авторизация по `initData`, гараж пользователя, создание purchase intent для покупки машины и прием Telegram webhook.

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
    "ownedCarIds": ["starter_car"],
    "garageRevision": 1
  }
}
```

Ошибки:

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
      "owned": false,
      "price": { "currency": "XTR", "amount": 250 },
      "canBuy": true
    }
  ]
}
```

Ошибки:

```json
{ "code": "UNAUTHORIZED" }
```

```json
{ "code": "USER_NOT_FOUND" }
```

### `POST /v1/purchases/car-intents`

Создает или переиспользует purchase intent для покупки машины. Нужен bearer token.

Заголовок:

```text
Authorization: Bearer <accessToken>
```

Тело запроса:

```json
{
  "carId": "second_car"
}
```

Успешный ответ:

```json
{
  "purchaseId": "pur_1",
  "status": "invoice_ready",
  "invoiceUrl": "https://t.me/invoice/pur_1",
  "expiresAt": "2026-04-10T10:15:00.000Z",
  "price": {
    "currency": "XTR",
    "amount": 250
  }
}
```

Ошибки:

```json
{ "code": "CAR_ID_REQUIRED" }
```

```json
{ "code": "UNAUTHORIZED" }
```

```json
{ "code": "USER_NOT_FOUND" }
```

```json
{ "code": "CAR_NOT_FOUND" }
```

```json
{ "code": "CAR_NOT_PURCHASABLE" }
```

```json
{ "code": "CAR_ALREADY_OWNED" }
```

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

Ошибка:

```json
{ "code": "INVALID_WEBHOOK_SECRET" }
```

## Полезно

- OpenAPI-описание лежит в `swagger.yaml`
- Docker-образ собирается из `Dockerfile`
- Основной runtime стартует из `src/server.ts`

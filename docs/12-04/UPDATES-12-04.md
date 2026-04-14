# Backend Updates — 12 April 2026

## Что изменилось

Машины больше не покупаются напрямую за Telegram Stars. Введена внутренняя валюта **race coins (RC)**. За Stars покупаются бандлы race coins, а машины покупаются за race coins.

## Новые роуты

### POST /v1/purchases/coins-intents

Покупка бандла race coins за Telegram Stars. Возвращает invoice link.

**Request:** `{ "bundleId": string }` + Bearer JWT

**Response:**
```json
{
  "purchaseId": "pur_...",
  "status": "invoice_ready",
  "invoiceUrl": "https://t.me/invoice/...",
  "expiresAt": "2026-04-12T12:00:00.000Z",
  "price": { "currency": "XTR", "amount": 1 },
  "coinsAmount": 50
}
```

### POST /v1/purchases/buy-car

Покупка машины за race coins. Без Telegram Stars, без invoice.

**Request:** `{ "carId": string }` + Bearer JWT

**Response:**
```json
{
  "success": true,
  "carId": "car1",
  "raceCoinsBalance": 25,
  "garageRevision": 2
}
```

**Ошибки:** `INSUFFICIENT_BALANCE` (422), `CAR_NOT_PURCHASABLE` (422), `CAR_ALREADY_OWNED` (409), `CAR_NOT_FOUND` (404)

## Удалённые роуты

- `POST /v1/purchases/car-intents` — удалён, заменён на `coins-intents`

## Изменения в существующих роутах

### GET /v1/garage

В ответ добавлено поле `raceCoinsBalance: number`.

### POST /v1/auth/telegram

В `profile` добавлено поле `raceCoinsBalance: number`.

## Цены машин — теперь в RC

| carId | price | purchasable |
|-------|-------|-------------|
| car0  | 0 RC  | нет (starter) |
| car1  | 25 RC | да |
| car2  | 50 RC | да |

Поле `price.currency` в garage cars теперь `"RC"` вместо `"XTR"`.

## Бандлы race coins

| bundleId | coins | price |
|----------|-------|-------|
| rc_bundle_10 | 10 | 1 XTR |
| rc_bundle_20 | 20 | 1 XTR |
| rc_bundle_50 | 50 | 1 XTR |
| rc_bundle_100 | 100 | 1 XTR |

## Баланс пользователя

- Новое поле `raceCoinsBalance` у пользователя (начальное значение 0)
- Приходит в ответах `/v1/auth/telegram` и `/v1/garage`
- Обновляется при покупке бандла (webhook processing ещё не реализован) и при покупке машины

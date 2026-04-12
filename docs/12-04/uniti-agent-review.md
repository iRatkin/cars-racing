# Backend handoff: Unity Mini App integration status and required backend work

## Current context

Unity WebGL client is already successfully integrated with Telegram Mini App auth and garage loading.

### What is already working on live backend

- `POST /v1/auth/telegram` works
- Telegram `initData` is passed correctly from Mini App
- backend returns:
  - `accessToken`
  - `profile.userId`
  - `profile.ownedCarIds`
  - `profile.garageRevision`
- `GET /v1/garage` works
- current live garage response looks like:
  - `garageRevision`
  - `cars[]`
  - each car has:
    - `carId`
    - `title`
    - `owned`
    - `price.currency`
    - `price.amount`
    - `canBuy`

### What was confirmed in live logs

- auth returns `200`
- garage returns `200`
- current live garage example:

```json
{
  "garageRevision": 1,
  "cars": [
    {
      "carId": "car0",
      "title": "car0",
      "owned": true,
      "price": { "currency": "XTR", "amount": 0 },
      "canBuy": false
    },
    {
      "carId": "car1",
      "title": "car1",
      "owned": false,
      "price": { "currency": "XTR", "amount": 250 },
      "canBuy": true
    },
    {
      "carId": "car2",
      "title": "car2",
      "owned": false,
      "price": { "currency": "XTR", "amount": 350 },
      "canBuy": true
    }
  ]
}
```

## Product requirement

Cars must **not** be bought directly for Telegram Stars.

Correct economy should be:

```text
Stars -> coin bundles -> race coins balance -> buy cars / tournament access
```

## Important mismatch

Repository swagger already describes a newer currency-based API, but live backend still appears to expose old direct-car-purchase behavior.

### Swagger indicates new backend model

Expected newer backend behavior from repo:

- `GET /v1/garage` includes `raceCoinsBalance`
- `POST /v1/purchases/coins-intents`
- `POST /v1/purchases/buy-car`
- auth/profile also includes `raceCoinsBalance`

### But live backend currently behaves like old model

Observed live behavior:

- `GET /v1/garage` currently has **no** `raceCoinsBalance`
- car prices are still returned as `currency: "XTR"`
- Unity currently can open purchase flow for cars directly

## Required backend work

### 1. Deploy backend version that matches current repo swagger

Need live backend to actually expose the newer currency-based contract.

### 2. `GET /v1/garage`

Should return:

- `garageRevision`
- `raceCoinsBalance`
- `cars[]`

Each car should include:

- `carId`
- `title`
- `owned`
- `price`
  - `currency`
  - `amount`
- `canBuy`

### 3. `POST /v1/purchases/coins-intents`

Need endpoint for buying race coin bundles with Telegram Stars.

Expected request shape:

```json
{
  "bundleId": "coins_500"
}
```

Expected response shape:

```json
{
  "purchaseId": "p_123",
  "status": "pending",
  "invoiceUrl": "https://...",
  "expiresAt": "2026-04-13T12:00:00.000Z",
  "coinsAmount": 500,
  "price": {
    "currency": "XTR",
    "amount": 250
  }
}
```

### 4. `POST /v1/purchases/buy-car`

Need endpoint for buying a car using race coins, not Stars.

Expected request shape:

```json
{
  "carId": "car1"
}
```

Expected response shape:

```json
{
  "success": true
}
```

Or another small response shape is fine, as long as it is stable and documented.

### 5. Auth/profile payload

Auth response profile should include:

- `userId`
- `telegramUserId`
- `firstName`
- `username`
- `ownedCarIds`
- `garageRevision`
- `raceCoinsBalance`

## Client-side expectations after backend update

Unity client will be updated to this flow:

### Buy coin bundle

- client calls `POST /v1/purchases/coins-intents`
- receives `invoiceUrl`
- opens Telegram invoice
- after invoice closes, client refreshes profile/garage
- updated `raceCoinsBalance` is shown

### Buy car

- client checks current `raceCoinsBalance`
- if not enough: opens buy currency panel
- if enough: calls `POST /v1/purchases/buy-car`
- refreshes garage
- car becomes owned
- `raceCoinsBalance` decreases

## Current client status

### Already working in Unity

- Telegram auth
- access token handling
- garage loading
- car ownership rendering
- invoice opening from backend `invoiceUrl`

### Temporarily local / not yet server-backed

- race coins packs UI
- tournament access
- tournament/training points
- race result submit

## Main request for backend agent

Please ensure the live backend matches the repo swagger for the currency flow, specifically:

1. garage returns `raceCoinsBalance`
2. `POST /v1/purchases/coins-intents` exists and works
3. `POST /v1/purchases/buy-car` exists and works
4. direct Stars purchase of cars is no longer the primary purchase path

## Notes

- Unity side currently logs and validates auth + garage successfully
- if needed, frontend can provide raw request/response logs from Mini App runtime

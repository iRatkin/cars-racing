# Обновления для Unity-клиента: Battle Seasons (апрель 2026)

Документ для агента/разработчика Unity, который выступает фронтендом к HTTP API. Описаны только **новые** возможности вокруг боевых сезонов. Базовая авторизация (`POST /v1/auth/telegram`), гараж и покупки race coins / машин остаются как в `AGENTS.md` и `swagger.yaml`.

## Общие правила

- **Базовый URL**: тот же, что и для остального API (например прод или локальный `http://localhost:3000`).
- **Авторизация**: все эндпоинты сезонов требуют заголовок  
  `Authorization: Bearer <JWT>`  
  JWT выдаётся после `POST /v1/auth/telegram` (срок жизни 12 часов).
- **Контент-тип**: для `POST` с телом — `Content-Type: application/json`.
- **Даты в JSON**: строки **ISO 8601** (UTC), например `2026-04-14T00:00:00.000Z`.
- **`mapId`**: бекенд только **хранит и отдаёт** строковый идентификатор карты. Валидации соответствия ассетам в Unity **нет** — маппинг `mapId` → сцена/трек — на стороне клиента.
- **Статус сезона** (`upcoming` | `active` | `finished`) на бекенде **не хранится** в БД; он **вычисляется** на каждый ответ из `startsAt` и `endsAt` относительно времени обработки запроса. Клиенту достаточно опираться на пришедшее поле `status`.

## Поток игрока (рекомендуемый)

1. Получить список сезонов или детали сезона → понять `status`, `entered`, `entryFee`, `mapId`.
2. Если сезон `active` и игрок ещё не в сезоне (`entered: false`) — при необходимости проверить баланс RC (например через `GET /v1/garage`) → вызвать `POST .../enter`.
3. Перед **каждым** заездом вызвать `POST .../races/start` → сохранить **`raceId`** и **`seed`**.
4. Прогнать гонку в Unity, используя **`seed`** так, как заложено в игровой логике (детерминизм, воспроизводимость — на стороне клиента).
5. По завершении отправить `POST .../races/finish` с тем же `raceId`, `seed` и итоговым **`score`** (целое ≥ 0).
6. При необходимости показать таблицу лидов — `GET .../leaderboard`.

Без шага **start** нельзя корректно завершить заезд: у записи заезда не будет валидной пары `raceId` + `seed` в статусе `started`.

## Античит (уровень 1)

Сервер выдаёт **`seed`** только в ответ на `races/start` и связывает его с **`raceId`**. В `races/finish` должны совпасть:

- `raceId`,
- `seed`,
- пользователь из JWT,
- `seasonId` из URL,

и заезд должен быть в статусе **started**. Иначе бекенд отклонит запрос. Подделать результат «с нуля» без предварительного start нельзя.

---

## Эндпоинты

### 1. Список сезонов

`GET /v1/seasons`

**Назначение:** сезоны, у которых **`endsAt` ещё не наступил** (по времени сервера), отсортированы по `startsAt` по возрастанию. Завершённые по календарю сезоны в этом списке **не появляются** (но их можно запросить по id, см. п. 2).

**Response200**

```json
{
  "seasons": [
    {
      "seasonId": "string",
      "title": "string",
      "mapId": "string",
      "entryFee": 10,
      "startsAt": "2026-04-14T00:00:00.000Z",
      "endsAt": "2026-04-21T00:00:00.000Z",
      "status": "upcoming | active | finished",
      "entered": true,
      "bestScore": 1500,
      "totalRaces": 7
    }
  ]
}
```

- **`entered`**: есть ли у текущего пользователя запись участника в этом сезоне.
- **`bestScore`**, **`totalRaces`**: если не участвует — оба поля **`null`**; если участвует — числа (лучший счёт за сезон и число завершённых заездов с учётом обновлений на бекенде).

**Ошибки:** `401 UNAUTHORIZED`.

---

### 2. Детали сезона

`GET /v1/seasons/:seasonId`

**Path:** `seasonId` — непустая строка.

**Назначение:** одна запись сезона **по id**, в том числе уже **закончившийся** (`finished`), если документ есть в БД.

**Response 200** — те же поля, что один элемент из `seasons[]` в п. 1 (без обёртки массива):

`seasonId`, `title`, `mapId`, `entryFee`, `startsAt`, `endsAt`, `status`, `entered`, `bestScore`, `totalRaces`.

**Ошибки:**

| HTTP | code |
|------|------|
| 400 | `SEASON_ID_REQUIRED` |
| 401 | `UNAUTHORIZED` |
| 404 | `SEASON_NOT_FOUND` |

---

### 3. Вход в сезон (оплата entry fee)

`POST /v1/seasons/:seasonId/enter`

**Path:** `seasonId`

**Body:** можно отправить пустой объект `{}` или опустить тело — сезон задаётся только path.

**Бизнес-логика:**

- Сезон должен существовать и иметь **`status === "active"`** (между `startsAt` и `endsAt` по серверу).
- Списывается **`entryFee`** race coins (значение из документа сезона на момент запроса).
- Создаётся участие в сезоне **атомарно** со списанием (двойное списание при гонках запросов не допускается).
- Повторный вход того же пользователя в тот же сезон — ошибка **409**.

**Response 200**

```json
{
  "success": true,
  "seasonId": "string",
  "entryId": "string",
  "raceCoinsBalance": 40
}
```

**Ошибки:**

| HTTP | code |
|------|------|
| 400 | `SEASON_ID_REQUIRED` |
| 401 | `UNAUTHORIZED` |
| 404 | `SEASON_NOT_FOUND` |
| 409 | `ALREADY_ENTERED` |
| 422 | `SEASON_NOT_ACTIVE` |
| 422 | `INSUFFICIENT_BALANCE` |

---

### 4. Старт заезда

`POST /v1/seasons/:seasonId/races/start`

**Path:** `seasonId`

**Body:** `{}` или без тела.

**Бизнес-логика:**

- Сезон **`active`**.
- Пользователь **уже вошёл** в сезон (`enter` выполнен).
- Создаётся новый заезд в статусе **started**; генерируется уникальный **`seed`** (строка, UUID).

**Response 200**

```json
{
  "raceId": "race_…",
  "seed": "uuid-string"
}
```

Клиент обязан **сохранить оба значения** до вызова finish.

**Ошибки:**

| HTTP | code |
|------|------|
| 400 | `SEASON_ID_REQUIRED` |
| 401 | `UNAUTHORIZED` |
| 403 | `NOT_ENTERED` |
| 404 | `SEASON_NOT_FOUND` |
| 422 | `SEASON_NOT_ACTIVE` |

---

### 5. Финиш заезда

`POST /v1/seasons/:seasonId/races/finish`

**Path:** `seasonId`

**Body (JSON):**

| Поле | Тип | Описание |
|------|-----|----------|
| `raceId` | string | Из ответа `races/start` |
| `seed` | string | Тот же, что вернул `races/start` |
| `score` | integer | Итог очков, **≥ 0** |

**Бизнес-логика:**

- Запись заезда существует, принадлежит текущему пользователю и сезону из URL.
- **`seed`** совпадает с сохранённым.
- Статус заезда **started** → переводится в **finished**, выставляется `score`.
- Участие в сезоне: **`totalRaces`** увеличивается на 1; **`bestScore`** обновляется, если новый `score` **строго больше** текущего лучшего (иначе лучший счёт не меняется).
- Завершение заезда и обновление участия выполняются **атомарно** (одна транзакция).

**Response 200**

```json
{
  "raceId": "race_…",
  "score": 1500,
  "isNewBest": true,
  "bestScore": 1500
}
```

- **`isNewBest`**: был ли этот `score` новым личным максимумом в сезоне.
- **`bestScore`**: актуальный лучший счёт игрока в сезоне **после** применения этого финиша.

**Ошибки:**

| HTTP | code |
|------|------|
| 400 | `SEASON_ID_REQUIRED` |
| 400 | `INVALID_RACE_RESULT` (невалидное тело / типы) |
| 400 | `RACE_SEASON_MISMATCH` |
| 400 | `INVALID_SEED` |
| 401 | `UNAUTHORIZED` |
| 403 | `NOT_ENTERED` |
| 403 | `RACE_FORBIDDEN` |
| 404 | `RACE_NOT_FOUND` |
| 409 | `RACE_ALREADY_FINISHED` |

---

### 6. Лидерборд

`GET /v1/seasons/:seasonId/leaderboard?limit=100`

**Path:** `seasonId`

**Query:**

| Параметр | По умолчанию | Описание |
|----------|--------------|----------|
| `limit` | `100` | Целое от **1** до **100** |

**Бизнес-логика:**

- Участники сортируются по **`bestScore` убыванию**, при равенстве — по **`createdAt` участия** (раньше выше), затем по **`userId`** (стабильный порядок).
- **Competition ranking:** одинаковый `bestScore` → одинаковый `rank`; следующий ранг с пропуском (например 1, 1, 3).
- В **`entries`** только топ **`limit`** строк; подтянуты **`username`** и **`firstName`** из профиля пользователя (могут отсутствовать в JSON, если пустые).
- **`currentPlayer`**: если пользователь участвует в сезоне — всегда его позиция в лидерборде (если он в топе — дублирует строку из `entries` с тем же `rank`); если не участвует — **`null`**.
- **`totalParticipants`**: число записей участников в сезоне.

**Response 200**

```json
{
  "seasonId": "string",
  "entries": [
    {
      "rank": 1,
      "userId": "string",
      "username": "string or null",
      "firstName": "string or null",
      "bestScore": 2500,
      "totalRaces": 15
    }
  ],
  "currentPlayer": {
    "rank": 47,
    "userId": "string",
    "username": "string or null",
    "firstName": "string or null",
    "bestScore": 800,
    "totalRaces": 3
  },
  "totalParticipants": 120
}
```

`currentPlayer` может быть **`null`** (нет участия).

**Ошибки:**

| HTTP | code |
|------|------|
| 400 | `SEASON_ID_REQUIRED` |
| 401 | `UNAUTHORIZED` |
| 404 | `SEASON_NOT_FOUND` |

---

## Что Unity не обязан делать через этот API

- Создание сезонов — только данные в Mongo / будущие админ-эндпоинты.
- Выплата призов — не реализована; поле **`prizePoolShare`** в сезоне зарезервировано.

## См. также

- OpenAPI: репозиторий `swagger.yaml` (тег **Seasons**).
- Бекенд-контекст: `AGENTS.md` (секции HTTP Surface, Data Model, Route Behavior Notes, replica set для транзакций в Docker).

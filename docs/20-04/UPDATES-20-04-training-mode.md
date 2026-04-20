# Обновления для фронтенда: Training Mode и personal highscore (20 апреля 2026)

Документ для клиента, который ходит в HTTP API миниаппа. Ниже только изменения вокруг сезонов после добавления **training mode**. Базовая авторизация, гараж, покупка race coins и машин остались прежними.

## Что поменялось концептуально

Теперь в активном сезоне есть **два независимых режима**:

- **Ranked**: как и раньше, нужно сначала войти в сезон через `POST /v1/seasons/:seasonId/enter`, потом можно стартовать ranked-заезды, отправлять score и попадать в лидерборд.
- **Training**: бесплатный режим на карте текущего сезона. Не требует `enter`, не списывает race coins и не влияет на ranked leaderboard.

У training-режима есть только **личный seasonal highscore** и `totalRaces`. Общего тренировочного лидерборда пока нет.

## Общие правила

- Все эндпоинты сезонов по-прежнему требуют заголовок:

```http
Authorization: Bearer <JWT>
```

- Для `POST` с телом используйте:

```http
Content-Type: application/json
```

- Все даты в ответах сезонов приходят как ISO-строки UTC.
- `mapId` по-прежнему только хранится и возвращается сервером; соответствие `mapId -> сцена/трек/ассет` полностью на стороне фронта.

## Что изменилось в существующих ответах сезонов

### `GET /v1/seasons`
### `GET /v1/seasons/:seasonId`

Оба ответа теперь дополнены новым блоком:

```json
{
  "training": {
    "bestScore": null,
    "totalRaces": 0
  }
}
```

Полный пример одного сезона:

```json
{
  "seasonId": "sea_123",
  "title": "Desert Cup",
  "mapId": "desert_map_01",
  "entryFee": 50,
  "startsAt": "2026-04-20T12:00:00.000Z",
  "endsAt": "2026-04-27T12:00:00.000Z",
  "status": "active",
  "entered": false,
  "bestScore": null,
  "totalRaces": null,
  "training": {
    "bestScore": 1840,
    "totalRaces": 6
  }
}
```

### Как это читать на фронте

- `entered`, `bestScore`, `totalRaces` на верхнем уровне относятся **только к ranked**.
- `training.bestScore` и `training.totalRaces` относятся **только к training**.
- Если пользователь ни разу не финишировал training в этом сезоне:
  - `training.bestScore = null`
  - `training.totalRaces = 0`
- Если пользователь не вошёл в ranked-сезон:
  - `entered = false`
  - `bestScore = null`
  - `totalRaces = null`

Это нормальное и ожидаемое состояние: можно иметь training-прогресс без участия в ranked.

## Новый flow для training

Рекомендуемый flow для фронта:

1. Загрузить сезон через `GET /v1/seasons` или `GET /v1/seasons/:seasonId`.
2. Если `status === "active"`, показывать кнопку training независимо от `entered`.
3. Перед **каждым** тренировочным заездом вызывать `POST /v1/seasons/:seasonId/training-races/start`.
4. Сохранить `raceId` и `seed` локально до завершения заезда.
5. После окончания гонки отправить `POST /v1/seasons/:seasonId/training-races/finish`.
6. После успешного finish обновить UI:
   - либо взять `bestScore` из ответа finish,
   - либо заново запросить `GET /v1/seasons/:seasonId`,
   - либо вызвать `GET /v1/seasons/:seasonId/training-highscore`.

Без шага `training-races/start` корректно закончить тренировочный заезд нельзя.

## Новый endpoint: старт training-заезда

### `POST /v1/seasons/:seasonId/training-races/start`

**Назначение:** создать новый тренировочный заезд на карте сезона и получить серверный `seed`.

**Body:** можно отправлять `{}` или не отправлять тело.

**Условия:**

- сезон должен существовать;
- сезон должен быть `active`;
- `enter` не требуется;
- race coins не списываются.

**Response 200**

```json
{
  "raceId": "race_123",
  "seed": "c1c955f4-51e3-43c8-8f7d-4e8d0ae87752"
}
```

**Что сохранить на фронте до finish:**

- `raceId`
- `seed`

**Ошибки:**

| HTTP | code |
|------|------|
| 400 | `SEASON_ID_REQUIRED` |
| 401 | `UNAUTHORIZED` |
| 404 | `SEASON_NOT_FOUND` |
| 422 | `SEASON_NOT_ACTIVE` |

## Новый endpoint: финиш training-заезда

### `POST /v1/seasons/:seasonId/training-races/finish`

**Body:**

```json
{
  "raceId": "race_123",
  "seed": "c1c955f4-51e3-43c8-8f7d-4e8d0ae87752",
  "score": 1840
}
```

### Бизнес-логика

Сервер проверяет, что:

- `raceId` существует;
- заезд принадлежит текущему пользователю;
- `seasonId` в URL совпадает с `seasonId` заезда;
- `seed` совпадает с выданным на `start`;
- статус заезда ещё `started`;
- этот заезд действительно был создан как **training**, а не ranked.

После этого сервер:

- переводит заезд в `finished`;
- увеличивает training `totalRaces` на 1;
- обновляет training `bestScore`, если новый `score` лучше прежнего;
- не трогает ranked progress и лидерборд.

**Response 200**

```json
{
  "raceId": "race_123",
  "score": 1840,
  "isNewBest": true,
  "bestScore": 1840
}
```

### Как использовать ответ на фронте

- `isNewBest = true` означает, что это новый personal best в training для этого сезона.
- `bestScore` всегда содержит **актуальный** training highscore после обработки finish.
- Можно сразу обновить локальный training state без дополнительного запроса.

**Ошибки:**

| HTTP | code |
|------|------|
| 400 | `SEASON_ID_REQUIRED` |
| 400 | `INVALID_RACE_RESULT` |
| 400 | `RACE_SEASON_MISMATCH` |
| 400 | `INVALID_SEED` |
| 401 | `UNAUTHORIZED` |
| 403 | `RACE_FORBIDDEN` |
| 404 | `SEASON_NOT_FOUND` |
| 404 | `RACE_NOT_FOUND` |
| 409 | `RACE_ALREADY_FINISHED` |

## Новый endpoint: personal training highscore

### `GET /v1/seasons/:seasonId/training-highscore`

**Назначение:** получить только personal training progress для одного сезона, без полного season detail.

**Response 200**

```json
{
  "seasonId": "sea_123",
  "bestScore": 1840,
  "totalRaces": 6
}
```

Если пользователь ещё не финишировал ни одного training-заезда:

```json
{
  "seasonId": "sea_123",
  "bestScore": null,
  "totalRaces": 0
}
```

**Ошибки:**

| HTTP | code |
|------|------|
| 400 | `SEASON_ID_REQUIRED` |
| 401 | `UNAUTHORIZED` |
| 404 | `SEASON_NOT_FOUND` |

## Что осталось без изменений

### Ranked flow

Следующие эндпоинты всё ещё работают как раньше и относятся только к ranked:

- `POST /v1/seasons/:seasonId/enter`
- `POST /v1/seasons/:seasonId/races/start`
- `POST /v1/seasons/:seasonId/races/finish`
- `GET /v1/seasons/:seasonId/leaderboard`

### Важно для фронта

- Ranked `leaderboard` не включает training results.
- Training не требует оплаты и не создаёт `entered = true`.
- Пользователь может:
  - не участвовать в ranked,
  - но иметь training highscore в том же сезоне.

## Рекомендации по UI

### В карточке сезона

Имеет смысл отдельно показывать:

- ranked status:
  - `entered`
  - ranked `bestScore`
  - ranked `totalRaces`
- training status:
  - `training.bestScore`
  - `training.totalRaces`
  - кнопку `Train`, если `status === "active"`

### После training finish

Минимально обновляйте:

- `training.bestScore`
- `training.totalRaces`

Не нужно обновлять ranked UI по успешному training finish.

## Короткий client checklist

- Для training-кнопки проверять только `status === "active"`.
- Не требовать `entered` для training.
- Перед каждым training-run обязательно вызывать `training-races/start`.
- На finish всегда отправлять тот же `raceId` и тот же `seed`.
- Ranked и training состояние хранить в UI раздельно.

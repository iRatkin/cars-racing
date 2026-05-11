# Короткая заметка для Unity-агента: nicknames (27 апреля 2026)

Backend добавляет отдельный игровой `nick`, чтобы Unity не зависела от Telegram `username` / `firstName` в публичных игровых экранах.

## Что использовать в UI

- После `POST /v1/auth/telegram` в `profile` будет поле `nick`.
- В публичной статистике, прежде всего в `GET /v1/seasons/:seasonId/leaderboard`, у записей будет `nick`.
- Для leaderboard и других игровых списков показывать именно `nick`, а не Telegram `username` или `firstName`.
- Если у пользователя ещё нет сохранённого ника, backend всё равно отдаст display fallback формата `p_<telegramUserId>`.

## Смена ника

Новый endpoint:

```http
PUT /v1/profile/nick
Authorization: Bearer <JWT>
Content-Type: application/json
```

Body:

```json
{ "nick": "Ivan_42" }
```

Response:

```json
{
  "nick": "Ivan_42",
  "raceCoinsBalance": 900,
  "nickChangePrice": 0
}
```

Правила ника:

- 3-20 символов;
- только латиница, цифры и `_`;
- уникальность без учёта регистра (`Ivan` и `ivan` считаются одним ником).

Смена ника бесплатная и без лимита по количеству изменений. `nickChangePrice` оставлен в ответе для совместимости клиента и всегда равен `0`.

## Ошибки для UI

| HTTP | code | Что показать |
|------|------|--------------|
| 400 | `INVALID_NICK` | Ник должен быть 3-20 символов: латиница, цифры или `_`. |
| 409 | `NICK_ALREADY_TAKEN` | Ник уже занят. |
| 401 | `UNAUTHORIZED` | Нужно заново авторизоваться. |

Полный backend design: `docs/superpowers/specs/2026-04-27-nicknames-design.md`.

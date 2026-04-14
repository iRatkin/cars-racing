# Задача: polling баланса после покупки race coins

## Контекст

Backend API задеплоен на Railway. Покупка race coins за Telegram Stars работает:
1. Unity вызывает `POST /v1/purchases/coins-intents` → получает `invoiceUrl`
2. Unity открывает `Telegram.WebApp.openInvoice(invoiceUrl)`
3. Telegram показывает окно оплаты, пользователь платит
4. Telegram отправляет webhook `successful_payment` на бэкенд → бэкенд начисляет race coins
5. Unity вызывает `GET /v1/garage` чтобы обновить баланс

## Проблема

После закрытия invoice окна Unity сразу вызывает `GET /v1/garage`, но race coins ещё не начислены. Webhook от Telegram приходит с задержкой 1-3 секунды. Поэтому баланс обновляется только при перезаходе в приложение.

Локально (через ngrok) задержка была минимальной и проблема не проявлялась.

## Что нужно сделать

Найди в коде Unity место, где после закрытия `openInvoice` вызывается обновление garage/баланса. Реализуй retry с задержкой:

1. `openInvoice` callback возвращает статус `paid`
2. Подождать 1 секунду
3. Вызвать `GET /v1/garage`
4. Сравнить `raceCoinsBalance` с предыдущим значением
5. Если не изменился — подождать ещё 2 секунды и повторить
6. Максимум 3-4 попытки (суммарно ~10 секунд)
7. Если после всех попыток не обновился — показать сообщение "Обработка платежа..."

## Формат ответа

Опиши:
1. Какой файл/класс/метод отвечает за flow после закрытия invoice
2. Как сейчас реализовано обновление баланса после оплаты
3. Что именно ты изменил для реализации retry
4. Какие таймауты/количество попыток ты использовал

## API справка

`GET /v1/garage` — возвращает:
```json
{
  "garageRevision": 1,
  "raceCoinsBalance": 10,
  "cars": [
    { "carId": "car0", "owned": true, "price": { "currency": "RC", "amount": 0 }, "canBuy": false },
    { "carId": "car1", "owned": false, "price": { "currency": "RC", "amount": 1 }, "canBuy": true }
  ]
}
```

Требует `Authorization: Bearer <jwt>`.

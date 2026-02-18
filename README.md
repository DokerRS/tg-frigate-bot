# tg-frigate-bot

## Запуск через Docker Compose

1. **Создайте свой `config.json`** в корне проекта на основе `config.example.json`  
   (обязательно укажите `telegram.botToken`, `telegram.chatId`, параметры MQTT и Frigate).

2. **Соберите и запустите контейнер:**

   ```bash
   docker compose up -d
   ```

   или (в зависимости от версии Docker):

   ```bash
   docker-compose up -d
   ```

Бот будет запускаться внутри контейнера командой `npm start` (файл `index.js`),  
а `config.json` будет примонтирован внутрь контейнера в `/usr/src/app/config.json`.

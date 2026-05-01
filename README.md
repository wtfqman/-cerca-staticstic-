# Cerca Trova Bot

Telegram-бот на `Node.js + Telegraf + Prisma + PostgreSQL` для работы с креаторами, недельной статистикой, ежемесячными выплатами, PDF-документами и синхронизацией в Google Sheets.

## Конфигурация проекта

В проекте используется единый env/config слой:

- `src/config/env.ts` загружает `.env` через `dotenv`, валидирует значения через `zod`, нормализует типы и завершает запуск при неверной конфигурации.
- `src/config/index.ts` экспортирует готовый объект `config`.
- Runtime-код не читает `process.env` напрямую. Все модули используют `config`.

Пример использования:

```ts
import { config } from '../config';

config.bot.token;
config.db.url;
config.app.env;
config.app.tz;
config.admin.telegramIds;
config.cron.dailyReminder;
config.documents.chatId;
config.storage.root;
config.googleSheets.enabled;
config.googleSheets.sheetNames.stats;
config.googleSheets.authMode;
```

## Быстрый старт

1. Установите зависимости:

```bash
npm install
npx playwright install chromium
npx prisma generate
```

2. Скопируйте `.env.example` в `.env` и заполните значения.

3. Примените миграции:

```bash
npx prisma migrate deploy
```

Для локальной разработки вместо этого можно использовать:

```bash
npx prisma migrate dev
```

4. Инициализируйте тимлидов:

```bash
npm run seed
```

Команда запускает Prisma seed `src/scripts/seed-teamleads.ts`. Скрипт можно запускать повторно: для каждого Telegram ID используется upsert, роль выставляется в `TEAMLEAD`, пользователь активируется, Telegram-поля и `TeamLeadProfile.displayName` обновляются без дублей.

Альтернативно можно запустить только этот bootstrap-скрипт:

```bash
npm run seed:teamleads
```

5. Запустите проект:

```bash
npm run dev
```

Проверка типов:

```bash
npm run typecheck
```

Прод-сборка:

```bash
npm run build
npm start
```

## Какие env обязательны

### Обязательны всегда

- `BOT_TOKEN` — Telegram bot token.
- `DATABASE_URL` — строка подключения Prisma/PostgreSQL.
- `DOCUMENTS_CHAT_ID` — чат или канал для пересылки подписанных документов.

### Условно обязательны

Если `GOOGLE_SHEETS_SYNC_ENABLED=true`, дополнительно обязательны:

- `GOOGLE_SHEETS_SPREADSHEET_ID`
- либо `GOOGLE_APPLICATION_CREDENTIALS`
- либо пара `GOOGLE_SERVICE_ACCOUNT_EMAIL + GOOGLE_PRIVATE_KEY`

### Опциональны с дефолтами

- `APP_ENV=development`
- `LOG_LEVEL=info`
- `TZ=Europe/Moscow`
- `DAILY_REMINDER_CRON`
- `DAILY_MISSED_CHECK_CRON`
- `WEEKLY_STATS_CRON`
- `WEEKLY_STATS_REMINDER_CRON`
- `WEEKLY_STATS_TEAMLEAD_REPORT_CRON`
- `GOOGLE_SHEETS_NIGHTLY_SYNC_CRON`
- `STORAGE_ROOT=./storage`
- `PDF_*`
- `MAX_MONTHLY_VIDEO_EDIT_DAY`
- `COMPANY_*`

## Как заполнить .env

Базовый минимальный пример:

```env
BOT_TOKEN=1234567890:your_real_token
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/cerca_trova_bot?schema=public
DOCUMENTS_CHAT_ID=-1001234567890
ADMIN_TELEGRAM_IDS=123456789,987654321
APP_ENV=development
LOG_LEVEL=info
TZ=Europe/Moscow
```

Все значения из `.env.example` уже соответствуют реальной конфигурации проекта. Пустые optional-поля можно оставить пустыми. Обязательные пустыми оставлять нельзя: приложение завершится на старте с понятной ошибкой.

## ADMIN_TELEGRAM_IDS

- Значение задаётся через запятую: `123456789,987654321`
- Пробелы допустимы, они будут обрезаны.
- На выходе это превращается в `config.admin.telegramIds: string[]`
- При неверном ID приложение не стартует.

## DOCUMENTS_CHAT_ID

- Обычно это ID супергруппы или канала в формате `-100...`
- Значение хранится как строка, чтобы не упереться в ограничения JavaScript по большим числам
- Используется в `config.documents.chatId`

## STORAGE_ROOT

- Определяет корневую папку хранения файлов.
- Можно использовать относительный путь, например `./storage`.
- В конфиге путь нормализуется в абсолютный `config.storage.root`.
- Если у вас раньше был `STORAGE_DIR`, проект всё ещё подхватит его как legacy-алиас, но использовать нужно `STORAGE_ROOT`.

## PDF и Playwright

PDF-документы генерируются через Playwright Chromium. На сервере, где запускается бот, после установки зависимостей нужно выполнить:

```bash
npx playwright install chromium
```

Если Chromium не установлен или недоступен, бот не показывает пользователю техническую ошибку Playwright. Пользователь увидит короткое сообщение о временной недоступности генерации документов, а полная ошибка и подсказка по установке попадут в лог.

## Google Sheets

### Как включить

```env
GOOGLE_SHEETS_SYNC_ENABLED=true
GOOGLE_SHEETS_SPREADSHEET_ID=your_spreadsheet_id
GOOGLE_SHEETS_STATS_SHEET_NAME=Статистика
GOOGLE_SHEETS_PAYMENTS_SHEET_NAME=Выплаты
GOOGLE_SHEETS_DOCUMENTS_SHEET_NAME=Документы
```

В `GOOGLE_SHEETS_SPREADSHEET_ID` можно передать как чистый ID, так и полную ссылку:

```env
GOOGLE_SHEETS_SPREADSHEET_ID=https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit#gid=0
```

### Режим 1: через GOOGLE_APPLICATION_CREDENTIALS

```env
GOOGLE_SHEETS_SYNC_ENABLED=true
GOOGLE_SHEETS_SPREADSHEET_ID=your_spreadsheet_id
GOOGLE_APPLICATION_CREDENTIALS=./secrets/google-service-account.json
```

- Путь может быть относительным или абсолютным.
- На старте путь будет приведён к абсолютному виду.
- Если файл не существует, приложение завершится с ошибкой конфигурации.
- В `config.googleSheets.authMode` будет `application_credentials`.

### Режим 2: через GOOGLE_SERVICE_ACCOUNT_EMAIL + GOOGLE_PRIVATE_KEY

```env
GOOGLE_SHEETS_SYNC_ENABLED=true
GOOGLE_SHEETS_SPREADSHEET_ID=your_spreadsheet_id
GOOGLE_SERVICE_ACCOUNT_EMAIL=service-account@project.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```

- В `config.googleSheets.authMode` будет `service_account_env`.
- `GOOGLE_PRIVATE_KEY` автоматически нормализуется: последовательности `\n` превращаются в реальные переводы строк.
- Если указан только `GOOGLE_SERVICE_ACCOUNT_EMAIL` без `GOOGLE_PRIVATE_KEY` или наоборот, приложение не стартует.

### Как настроить саму таблицу

1. Создайте Google Cloud project.
2. Включите `Google Sheets API`.
3. Создайте service account.
4. Поделитесь Google-таблицей с email этого service account.
5. Возьмите `spreadsheetId` из URL:

```text
https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit#gid=0
```

Раздел админки `Google Sheets -> Проверить таблицу` проверяет доступ service account и готовит листы `Статистика`, `Выплаты`, `Документы`: если листа нет, бот создаст его; если заголовки отличаются, обновит только первую строку нужного листа. Остальные листы в таблице не трогаются.

## Как передавать GOOGLE_PRIVATE_KEY

Безопасный вариант для `.env`:

```env
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nLINE_1\nLINE_2\n-----END PRIVATE KEY-----\n"
```

Если ваш secret manager умеет хранить multiline secrets, можно передавать ключ и в многострочном виде. Конфиг аккуратно обработает оба случая.

## Cron-переменные

Используются такие cron-поля:

- `DAILY_REMINDER_CRON`
- `DAILY_MISSED_CHECK_CRON`
- `WEEKLY_STATS_CRON`
- `WEEKLY_STATS_REMINDER_CRON`
- `WEEKLY_STATS_TEAMLEAD_REPORT_CRON`
- `GOOGLE_SHEETS_NIGHTLY_SYNC_CRON`

Недельные напоминания креаторам идут через `WEEKLY_STATS_REMINDER_CRON`, а отчет тимлидам в 21:00 через `WEEKLY_STATS_TEAMLEAD_REPORT_CRON`.

Все cron-значения валидируются на старте. Если выражение невалидно, приложение не запускается.

Ночная синхронизация Google Sheets создаётся только если одновременно выполнены оба условия:

- `GOOGLE_SHEETS_SYNC_ENABLED=true`
- `GOOGLE_SHEETS_NIGHTLY_SYNC_CRON` не пустой

Пример:

```env
GOOGLE_SHEETS_SYNC_ENABLED=true
GOOGLE_SHEETS_NIGHTLY_SYNC_CRON=0 3 * * *
```

## TZ

- `TZ` должен быть валидной IANA timezone, например `Europe/Moscow`.
- Значение используется в `config.app.tz`.
- Scheduler (`node-cron`) запускает задачи в этой timezone.
- `dayjs` тоже получает эту timezone как default.

Если timezone неверная, проект завершится на старте.

## Что ещё валидируется и нормализуется

- `GOOGLE_SHEETS_SYNC_ENABLED` и `PDF_HEADLESS` превращаются в boolean
- `ADMIN_TELEGRAM_IDS` превращается в массив строк
- `PDF_BROWSER_TIMEOUT_MS`, `GOOGLE_SHEETS_BATCH_SIZE`, `MAX_MONTHLY_VIDEO_EDIT_DAY` превращаются в number
- `STORAGE_ROOT` и `GOOGLE_APPLICATION_CREDENTIALS` приводятся к абсолютным путям
- пустые optional env обрабатываются как `undefined/null` на уровне `config`

## Prisma и env

- Prisma CLI по-прежнему использует `DATABASE_URL` из `.env` для `migrate`/`generate`, как и ожидает Prisma.
- Runtime Prisma client получает URL из `config.db.url`, а не читает env напрямую внутри приложения.

## Поведение при ошибочной конфигурации

Если обязательная переменная отсутствует или невалидна:

- приложение падает сразу на старте
- в консоль выводится список конкретных проблем
- бот не продолжает запуск в полусломанном состоянии

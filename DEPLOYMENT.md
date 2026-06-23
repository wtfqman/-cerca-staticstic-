# Production Deployment Checklist

This project is a Telegram bot with PostgreSQL, Prisma, Google Sheets sync and DOCX -> PDF generation through LibreOffice.

## Critical Safety Rules

- Never commit `.env`, Google credentials, `storage/`, generated documents, signed PDFs, receipts or backups.
- Never run the same `BOT_TOKEN` in two places at the same time. Stop the local bot before starting the server bot.
- `storage/` must be persistent on the server. Do not keep it only inside a temporary deploy directory.
- LibreOffice must be installed on the server, otherwise DOCX -> PDF generation will fail.
- Production has several PM2 bots on the same server. This statistics bot is deployed from `/opt/cerca-statistics-bot` and must run as `cerca-statistics-bot`. Do not deploy it into `/opt/cerca-trova-bot`; that directory belongs to the booking bot.

## Server Packages

Use Ubuntu/Debian commands:

```bash
apt update
apt install -y \
  curl git ca-certificates gnupg build-essential \
  postgresql postgresql-contrib \
  libreoffice libreoffice-writer libreoffice-core \
  fonts-dejavu fonts-liberation fontconfig \
  unzip zip \
  nginx

fc-cache -fv
```

Install Node.js 20:

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs
node -v
npm -v
```

Install PM2:

```bash
npm install -g pm2
pm2 -v
```

## PostgreSQL

Create database and user:

```bash
sudo -u postgres psql
```

Inside `psql`:

```sql
CREATE USER cerca_bot WITH PASSWORD 'CHANGE_ME_STRONG_PASSWORD';
CREATE DATABASE cerca_trova_bot OWNER cerca_bot;
GRANT ALL PRIVILEGES ON DATABASE cerca_trova_bot TO cerca_bot;
\q
```

Connection string:

```env
DATABASE_URL=postgresql://cerca_bot:CHANGE_ME_STRONG_PASSWORD@localhost:5432/cerca_trova_bot?schema=public
```

## Project Directory

```bash
mkdir -p /opt/cerca-statistics-bot
mkdir -p /var/cerca-trova-bot/storage
cd /opt/cerca-statistics-bot
```

Clone the repo:

```bash
git clone https://github.com/wtfqman/-cerca-staticstic-.git .
```

Install dependencies:

```bash
npm ci
```

Create production `.env`:

```bash
nano .env
```

Required production values:

```env
BOT_TOKEN=PUT_REAL_BOT_TOKEN_HERE
DATABASE_URL=postgresql://cerca_bot:CHANGE_ME_STRONG_PASSWORD@localhost:5432/cerca_trova_bot?schema=public
APP_ENV=production
LOG_LEVEL=info
TZ=Europe/Moscow

ADMIN_TELEGRAM_IDS=406397522,193310707,8471141711

DOCUMENTS_CHAT_ID=-1003965254308
STORAGE_ROOT=/var/cerca-trova-bot/storage

LIBREOFFICE_EXECUTABLE_PATH=/usr/bin/libreoffice
PDF_FONT_FAMILY=DejaVu Sans
PDF_BROWSER_TIMEOUT_MS=30000
PDF_HEADLESS=true
DOCX_PDF_HTML_FALLBACK_ENABLED=false

GOOGLE_SHEETS_SYNC_ENABLED=true
GOOGLE_SHEETS_SPREADSHEET_ID=PUT_SPREADSHEET_ID_HERE
GOOGLE_SHEETS_STATS_SHEET_NAME=Статистика
GOOGLE_SHEETS_PAYMENTS_SHEET_NAME=Выплаты
GOOGLE_SHEETS_DOCUMENTS_SHEET_NAME=Документы
GOOGLE_SHEETS_BATCH_SIZE=500
GOOGLE_SERVICE_ACCOUNT_EMAIL=PUT_SERVICE_ACCOUNT_EMAIL_HERE
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nPUT_KEY_HERE\n-----END PRIVATE KEY-----\n"

MAX_MONTHLY_VIDEO_EDIT_DAY=10
DOCUMENT_WORKFLOW_MONTH_KEY=

COMPANY_NAME=PUT_COMPANY_NAME_HERE
COMPANY_SHORT_NAME=PUT_COMPANY_SHORT_NAME_HERE
COMPANY_REPRESENTATIVE=PUT_REPRESENTATIVE_HERE
COMPANY_REPRESENTATIVE_BASIS=действующего на основании устава
COMPANY_ADDRESS=PUT_ADDRESS_HERE
COMPANY_INN=PUT_INN_HERE
COMPANY_BANK_NAME=PUT_BANK_NAME_HERE
COMPANY_BANK_ACCOUNT=PUT_BANK_ACCOUNT_HERE
COMPANY_BANK_BIK=PUT_BIK_HERE
COMPANY_BANK_CORR_ACCOUNT=PUT_CORR_ACCOUNT_HERE
COMPANY_EMAIL=PUT_EMAIL_HERE
```

## Build and Database Migration

```bash
npm run prisma:deploy
npm run build
npm run typecheck
```

## Smoke Checks Before Start

```bash
which libreoffice
libreoffice --version
test -d /var/cerca-trova-bot/storage && echo STORAGE_OK
node -e "require('fs').accessSync('/var/cerca-trova-bot/storage', require('fs').constants.W_OK); console.log('STORAGE_WRITABLE')"
```

Check Google Sheets connection from admin menu after bot starts:

- `Google Sheets`
- `Проверить таблицу`

## Start With PM2

```bash
pm2 start dist/index.js --name cerca-statistics-bot --time
pm2 save
pm2 startup
pm2 logs cerca-statistics-bot
```

Restart after future deploys:

```bash
cd /opt/cerca-statistics-bot
git pull --ff-only origin main
npm ci
npm run prisma:deploy
npm run build
pm2 restart cerca-statistics-bot --update-env
pm2 logs cerca-statistics-bot
```

## Emergency Cleanup If Statistics Was Deployed Into Booking Directory

If an accidental PM2 process named `cerca-trova-bot` appears, remove only that wrong process and restore the booking directory from the timestamped backup before deploying statistics from its real directory:

```bash
pm2 delete cerca-trova-bot || true

cd /opt
WRONG_DIR="/opt/cerca-trova-bot"
BOOKING_BACKUP="$(ls -dt /opt/cerca-trova-bot.old-* 2>/dev/null | head -n1)"

if [ -d "$WRONG_DIR/.git" ] && grep -q -- "-cerca-staticstic-" "$WRONG_DIR/.git/config"; then
  mv "$WRONG_DIR" "/opt/cerca-trova-bot.wrong-statistics-$(date +%Y%m%d-%H%M)"
fi

if [ ! -d "$WRONG_DIR" ]; then
  if [ -z "$BOOKING_BACKUP" ]; then
    echo "No booking backup found; stop and inspect /opt manually"
    exit 1
  fi
  mv "$BOOKING_BACKUP" "$WRONG_DIR"
fi

cd /opt/cerca-statistics-bot
git pull --ff-only origin main
npm ci
npm run prisma:generate
npm run build
npm run prisma:deploy
pm2 restart cerca-statistics-bot --update-env
pm2 save --force
pm2 status
```

## First Bot Check

1. Stop local `npm start`.
2. Start server process through PM2.
3. Send `/start` from admin account.
4. Check admin menu opens.
5. Open `Google Sheets -> Проверить таблицу`.
6. Create one test creator only after server health is confirmed.
7. Generate documents and verify:
   - contract PDF is created;
   - NDA PDF is created;
   - assignment PDFs are created;
   - files are stored under `/var/cerca-trova-bot/storage`;
   - service chat receives exported documents only when expected.

## Backup Commands

Database backup:

```bash
mkdir -p /var/backups/cerca-trova-bot
pg_dump "postgresql://cerca_bot:CHANGE_ME_STRONG_PASSWORD@localhost:5432/cerca_trova_bot?schema=public" \
  > /var/backups/cerca-trova-bot/db-$(date +%F-%H%M).sql
```

Storage backup:

```bash
tar -czf /var/backups/cerca-trova-bot/storage-$(date +%F-%H%M).tar.gz /var/cerca-trova-bot/storage
```

## Most Common Production Problems

- `LibreOffice executable was not found`: install LibreOffice and set `LIBREOFFICE_EXECUTABLE_PATH=/usr/bin/libreoffice`.
- PDFs look wrong: install fonts and run `fc-cache -fv`.
- Documents disappear after redeploy: `STORAGE_ROOT` was not persistent.
- Bot does not respond: local and server bot are both running with the same token, or PM2 process crashed.
- Google Sheets errors: service account has no access to the spreadsheet or private key is malformed.

# Project Memory For Future Codex Sessions

This file is the first thing to read in a new Codex chat for this repository.
It is intentionally operational and practical. Do not put bot tokens, database
passwords, Google private keys, or other secrets here.

## Server Map

There are multiple bots on the same server. Do not mix them up.

### Statistics Bot

- Purpose: Telegram bot `creator statistics` for creator profiles, weekly stats, monthly video counts, documents, invoices, receipts, team leads, admin reports, and Google Sheets sync.
- Server path: `/opt/cerca-statistics-bot`
- PM2 process: `cerca-statistics-bot`
- GitHub repo: `https://github.com/wtfqman/-cerca-staticstic-.git`
- Local workspace used by Codex on Windows: `c:\Users\PC\OneDrive\Desktop\cerca trova bot 2`
- Main deploy command sequence:

```bash
cd /opt/cerca-statistics-bot
git pull --ff-only origin main
npm run build
pm2 restart cerca-statistics-bot --update-env
pm2 save --force
```

- If Prisma schema or migrations changed:

```bash
cd /opt/cerca-statistics-bot
git pull --ff-only origin main
npx prisma generate
npm run build
npx prisma migrate deploy
pm2 restart cerca-statistics-bot --update-env
pm2 save --force
```

### Booking Bot

- Purpose: separate booking/request bot.
- Server path: `/opt/cerca-trova-bot`
- PM2 process: `cerca-trova-booking-bot`
- This is not the statistics project. If a task is about `creator statistics`, do not edit, restart, or deploy booking unless the user explicitly asks.
- `pm2 status` often shows both processes. Seeing booking in PM2 output does not mean it should be touched.

## Current Production Notes

- The statistics bot uses the live database from the Cerca Trova bot setup. Do not paste or store the DB password in docs.
- Google Sheets sync is used for reporting. The service account JSON lives on the server, but its private key must never be committed.
- Current documents/chat target was changed to a new chat ID in `.env` on the server: `DOCUMENTS_CHAT_ID=-1003873632508`.
- For safe document export testing, set `TEST_DOCUMENTS_CHAT_ID` and switch `DOCUMENTS_CHAT_TARGET=test`; return to `DOCUMENTS_CHAT_TARGET=production` for the working chat.
- Google Sheets target spreadsheet was configured through `.env`; do not hardcode credentials in code.

### 2026-06-23 Server Incident Note

- The server should have three bot processes, not four:
  - `cerca-ai-creator-bot`
  - `cerca-statistics-bot`
  - `cerca-trova-booking-bot`
- `cerca-trova-bot` is an accidental/extra PM2 process if it appears on this server. Delete only that process with `pm2 delete cerca-trova-bot`.
- Do not clone or deploy this statistics repo into `/opt/cerca-trova-bot`. If it happened, move that wrong clone aside, restore the newest `/opt/cerca-trova-bot.old-*` backup back to `/opt/cerca-trova-bot`, then deploy statistics from `/opt/cerca-statistics-bot`.
- For this repo, `npm run build` and `npm run prisma:deploy` exist. If they are missing on the server, you are in the wrong directory or the wrong project.

## Roles And Access

Known admin Telegram IDs:

- `406397522` (primary/default admin)
- `193310707` / `@elenakolyhalova`
- `8471141711`

Known team leads from the last role correction:

- `846359286` / `@klbrdnv_V`
- `7025455607` / `@danila1255`
- `1652747843` / `@alexndrSAVIN`
- `709509558` / `@Maxximlead`
- `193310707` / `@elenakolyhalova` (also admin and creator)

Known removed/replaced team lead:

- `1731711996` / `@ssssv_a` (S.O.) is deactivated and removed from team lead access by `npm run reconcile:known-users`.
- `748641314` / `@D1nen` was removed from team lead role and returned to creator during the last correction.

When changing roles manually:

- Use Prisma against the PM2 environment database.
- Clear related bot sessions so the new menu appears after `/menu`.
- Restart `cerca-statistics-bot` and save PM2.

## Business Rules

### Creator Documents

- First queue: contract, NDA, assignments.
- Second queue: acts and rights transfer.
- Signed creator documents should remain PDF-only.
- If a creator refills the profile, old signed files may still matter; do not delete user documents unless explicitly requested.
- Admins can export documents to the configured documents chat.
- Recent request: exports should keep invoices/signed acts/assignments close together for accounting.
- Contract references in monthly documents must preserve the original contract number for existing creators. Only the monthly document dates/period dates change. New creators with no reusable contract use the current workflow contract date, and their contract number is generated from that date.
- Date fields are separate: `contractDate` is only the base agreement date, `documentDate` is the concrete document date, `companySignDate` and `creatorSignDate` drive signature dates, and monthly documents use their own `assignmentDate`, `actDate`, or `rightsTransferDate`.
- DOCX generation is guarded by `assertDocumentPayloadValidForRender` plus post-render text validation. Run `npm run documents:smoke-test` after document pipeline changes.

### Invoices And Receipts

- Invoices: creator uploads only PDF.
- Receipts/checks: creator can upload PDF, JPG, PNG, or regular Telegram photo.
- Receipt uploads were changed in commit `7d8b137 Allow image receipts`.
- After invoice upload, bot waits for the receipt after payment.
- Receipt export should include useful caption context: creator, month, file, and amount where available.

### Statistics

- Weekly statistics are separate from monthly video count.
- Monthly video count is needed for salary calculation.
- Weekly views are rounded down by 500,000-view steps for variable payment.
- There were special temporary buttons/scenarios for March/April backfill:
  - `Видео за март и апрель`
  - `Охваты март/апрель`
- From May onward, prefer the normal weekly stats flow and structured social network reporting.
- There is a daily creator button: `Выложил видео за сегодня`.
- The user cares a lot about avoiding false reminders and false "requires attention" reports.

### Google Sheets

Sheets used in the statistics spreadsheet:

- `Документы`
- `Статистика`
- `Выплаты`
- `Соцсети`

The desired `Соцсети` sheet format is a monthly matrix similar to the old manual sheets:

- left columns: social network, creator, team lead, month
- then repeated week groups with reach/views, likes, comments, reposts, saves
- rows grouped by platform: Instagram, TikTok, VK, YouTube
- should be readable and easy to hide/filter

Payments sheet should be clean and focused:

- creator
- team lead
- month
- monthly video count
- salary/base part
- rounded views
- variable part
- total payout
- invoice amount including the extra 1000 rubles where the bot expects it
- avoid mixing unnecessary March/April/May noise in one view when the user asks for a clear month.

To manually rebuild sheets on the server:

```bash
cd /opt/cerca-statistics-bot
node <<'NODE'
require('dotenv').config();

const { container } = require('./dist/container');

(async () => {
  for (const target of ['socials', 'payments', 'documents', 'stats']) {
    const result = await container.services.googleSheetsSyncService.rebuildSheet(target);
    console.log(result);
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
NODE
```

If Google Sheets auth fails:

- Check `.env` for sync enabled, spreadsheet ID, and credentials path.
- Check the service account JSON is valid JSON.
- Check the spreadsheet is shared with the service account email.
- Never paste private keys into commits or logs.

## Common Support Replies

The user often asks for copy-ready replies to creators/team leads. Unless the user says otherwise:

- Address creators politely with `вы`.
- Keep the message short and practical.
- Give exact button path, for example: `/menu -> Мои документы -> Загрузить чек`.
- If the user says "обращайся на ты", then use `ты`.

Examples:

Invoice upload for creator:

```text
Откройте /menu -> «Мои документы» -> «Выставить счет».
Выберите нужный месяц, бот покажет сумму.
После этого отправьте PDF-файл счета в бот одним документом.
```

Receipt upload for creator:

```text
После оплаты откройте /menu -> «Мои документы» -> «Загрузить чек».
Выберите месяц и отправьте чек: можно PDF, JPG/PNG-файл или обычное фото.
```

Weekly stats for May:

```text
Это отдельная недельная статистика, не счет за апрель.
Откройте /menu -> «Внести статистику за 7 дней» и заполните только период, который просит бот.
```

## Coding Notes

- Prefer small, targeted changes.
- Run `npm run build` before committing TypeScript changes.
- Use `git diff --check` before commit when editing code.
- Commit and push to `origin main` when the task is complete, unless the user asks not to.
- Do not commit `.env`, service account JSON, PM2 dumps, generated PDFs, storage files, or Telegram tokens.
- If a terminal paste accidentally includes command output as commands, stop and resume from a clean prompt. Do not try to "fix" those output lines.

## High-Risk Areas

- Payment amounts and invoice amounts affect real money. Verify before changing calculation logic.
- Role changes affect menus and access. Always clear sessions for changed users.
- Documents and receipts go to real working chats. Confirm `DOCUMENTS_CHAT_ID` if the user says files are going to the wrong chat.
- Booking bot is separate. Do not use booking folder or PM2 process for statistics tasks.

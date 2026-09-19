# SHAGGY XMD — Bot Admin Panel

A secure, standalone administrator dashboard for a WhatsApp bot that already
runs separately (e.g. on Railway) and stores its data in MongoDB.

**This project is an admin panel only.** It does not contain any WhatsApp/Baileys
code, does not connect to WhatsApp, and does not deploy or manage your bot process.
It only reads/writes safe application data in your existing MongoDB database.

---

## 1. What this protects, by design

- The MongoDB connection string is read **only** in `src/config/db.js`, from the
  `MONGODB_URI` environment variable. It is never logged, never sent to the
  browser, never returned by any API route, and never written to localStorage.
- Every database route goes through `src/utils/safeDb.js#getSafeCollection()`,
  which only allows access to an explicit allowlist of collections
  (`users`, `groups`, `bot_settings`, `commands`, `api_configs`, `bot_logs`,
  `analytics`). Anything else — including anything that looks like Baileys
  session/auth data, by name **or** by document shape — is automatically
  classified as "protected" and is never readable, editable, or deletable
  from this panel. See `src/utils/collectionSafety.js` for the exact rules.
- There is no generic database editor and no arbitrary query runner.
- API keys are stored but never sent back to the browser — only whether one
  is configured.
- There is no public sign-up route. Admin accounts are created with a CLI
  script (`scripts/createAdmin.js`), so a stranger can never self-register.

---

## 2. Requirements

- Node.js 18+
- An existing MongoDB database (the same one your bot uses, or a separate
  one — your choice)

---

## 3. Setup

```bash
cd shaggy-xmd-admin
npm install
cp .env.example .env
```

Edit `.env` and fill in real values:

```
MONGODB_URI=mongodb+srv://user:password@cluster.mongodb.net
MONGODB_DB_NAME=your_bot_database_name
SESSION_SECRET=<openssl rand -hex 32>
CSRF_SECRET=<openssl rand -hex 32>
NODE_ENV=production
```

Create your first administrator account (no public signup page exists on
purpose):

```bash
node scripts/createAdmin.js myusername "A very strong password 123!" superadmin
```

Start the server:

```bash
npm start
```

Visit `http://localhost:3000` (or your `PORT`) and log in.

---

## 4. Matching this panel to your bot's schema

The panel expects (but tolerates missing/partial) documents shaped roughly like:

- `bot_settings`: one document with `botName`, `ownerName`, `footer`, `prefix`,
  `aiEnabled`, `autoRead`, `autoTyping`, `autoStatus`
- `commands`: `{ name, description, category, permission, enabled, usageCount }`
- `users`: `{ jid, firstSeen, lastActive, messageCount, commandCount, blocked }`
- `groups`: `{ groupId, name, memberCount, botEnabled, aiEnabled, messageCount, lastActivity }`
- `api_configs`: `{ name, category, endpoint, method, enabled, apiKey }`
- `bot_logs`: `{ timestamp, level, event, command, user/group, responseTime }`
- `analytics`: one document per day, `{ date, messages, newUsers, commandsUsed, apiRequests, errors }`

If your bot's actual field names differ, either:
1. Add a small mapping layer in the relevant route file (`src/routes/*.js`), or
2. Adjust your bot to write these field names into the same collections.

If your bot uses different collection names entirely for safe application
data, add them to `EXTRA_SAFE_COLLECTIONS` in `.env` (comma-separated).
If you know of additional collection names used for WhatsApp session/auth
storage, add them to `EXTRA_PROTECTED_COLLECTIONS` as an extra safeguard —
though the built-in detection already covers common Baileys patterns and
also inspects document shape as a second line of defense.

---

## 5. Deployment

This app is a normal Node/Express server — deploy it anywhere that runs
Node.js 18+: Railway, Render, Fly.io, a VPS, etc. (You said your bot already
runs on Railway; this can be deployed there too, as a **separate** service,
or anywhere else you prefer — it doesn't need to be co-located with the bot.)

Steps for any host:
1. Push this project to its own repo (it does not need to be merged with
   your bot's codebase).
2. Set the environment variables from `.env.example` in your host's
   dashboard (never commit the real `.env` file).
3. Set the start command to `npm start`.
4. After the first deploy, run `node scripts/createAdmin.js ...` once
   (via the host's shell/console) to create your login.
5. Make sure `NODE_ENV=production` so cookies are marked `secure` — this
   requires the panel to be served over HTTPS, which most hosts provide by
   default on their generated domain.

---

## 6. Project structure

```
server.js                  Express app entrypoint, security middleware wiring
scripts/createAdmin.js     CLI to create/update an admin account
src/
  config/db.js             MongoDB connection (only place MONGODB_URI is read)
  middleware/
    auth.js                Session guard + idle timeout
    csrf.js                CSRF token generation/verification
    rateLimit.js            Login / API / write rate limits
  models/
    Admin.js               Admin account schema (bcrypt password hashing)
    AuditLog.js            Admin audit log schema
  utils/
    collectionSafety.js    Allowlist + Baileys/session detection rules
    safeDb.js              Central gate all data routes must go through
    audit.js               Helper to write audit log entries
  routes/
    auth.js, dashboard.js, settings.js, commands.js, users.js,
    groups.js, apiManager.js, logs.js, analytics.js, database.js, audit.js
views/                     EJS templates (dark navy / electric blue theme)
public/
  css/style.css            Theme
  js/app.js                Shared frontend helpers (CSRF-aware fetch, toasts, modals)
```

---

## 7. Notes

- Empty states are shown wherever the underlying collection has no data —
  no numbers are ever fabricated.
- All writes are validated server-side (`express-validator`) in addition to
  any client-side checks.
- The audit log records login/logout, settings changes, command/API/group/
  user changes, each with admin id, action, target, timestamp, and result.

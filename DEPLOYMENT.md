# Deploying Relay

Relay is a Next.js 15 app with a Postgres database (via Prisma) and self-hosted
email + password accounts. This guide takes you from a clean machine to a live URL on
**Vercel + Neon Postgres**.

---

## What changed from the prototype

- **No more demo/"acting as" switcher.** Identity comes from a signed session cookie.
- **Real accounts** — email + password (bcrypt-hashed), 30-day JWT session cookie.
- **Multi-workspace** — anyone can create a workspace (becomes admin) or join one with
  its invite code. A user can belong to several; the active one lives in a cookie.
- **Postgres** instead of SQLite (SQLite can't run on Vercel's serverless filesystem).

---

## Environment variables

Set these in `.env` locally and in the Vercel dashboard for production:

| Variable | What it is |
| --- | --- |
| `DATABASE_URL` | Postgres connection string (Neon **pooled** URL in production). |
| `AUTH_SECRET` | Random ≥32-char string that signs session cookies. Generate: `openssl rand -base64 32`. |
| `GOOGLE_CLIENT_ID` | *(optional)* Google OAuth client id — enables "Continue with Google". |
| `GOOGLE_CLIENT_SECRET` | *(optional)* Google OAuth client secret. |
| `OPENCODE_API_KEY` | Your LLM provider key. |
| `LLM_BASE_URL` | OpenAI-compatible base URL (e.g. `https://opencode.ai/zen/go/v1`). |
| `LLM_MODEL` | Default model id (e.g. `deepseek-v4-flash`). |

⚠️ Never commit `.env` (it's already in `.gitignore`). Rotate any key that leaks.

---

## 1. Create the database (Neon)

1. Sign up at <https://neon.tech> and create a project (pick a region near your users).
2. Copy the **pooled** connection string (looks like
   `postgresql://user:pass@ep-xxx-pooler.region.aws.neon.tech/dbname?sslmode=require`).
3. Neon also gives a **direct** (non-pooled) URL — keep it handy for schema pushes.

## 2. Local setup

```bash
cp .env.example .env
# edit .env: paste your Neon URL into DATABASE_URL, generate AUTH_SECRET, add MINIMAX_*.

npm install                 # also runs `prisma generate`
npx prisma db push          # creates all tables in your Neon database
npm run dev                 # http://localhost:3002
```

Open the app, click **Create an account**, then **Create a workspace**. You're in.

> Tip: for local dev you can use a Neon **dev branch** so you don't touch production
> data. You don't need Postgres installed on your Mac.

## 3. Push code to GitHub

The project is already a git repo. Create a GitHub repo and push:

```bash
git remote add origin git@github.com:<you>/relay.git
git push -u origin main
```

## 4. Deploy to Vercel

1. Go to <https://vercel.com>, **Add New → Project**, import your GitHub repo.
2. Framework preset: **Next.js** (auto-detected). Build command and output are default.
3. Under **Environment Variables**, add all five from the table above
   (`DATABASE_URL` = your Neon **pooled** URL).
4. Click **Deploy**.

`postinstall` runs `prisma generate` automatically on every Vercel build, so the
Prisma client always matches the schema.

## 5. Create the production schema

Run this **once** (and again whenever the schema changes), pointing at your Neon DB:

```bash
# from your machine, with DATABASE_URL set to the Neon (direct) URL:
npx prisma db push
```

That's it — visit your Vercel URL, sign up, create a workspace, and share the invite
code with teammates.

---

## Google sign-in (optional)

The "Continue with Google" button appears only when `GOOGLE_CLIENT_ID` and
`GOOGLE_CLIENT_SECRET` are set. To enable it:

1. Go to <https://console.cloud.google.com/apis/credentials> → **Create credentials →
   OAuth client ID** → application type **Web application**.
2. Under **Authorized redirect URIs**, add one per origin you use:
   - `http://localhost:3002/api/auth/google/callback`
   - `https://<your-vercel-domain>/api/auth/google/callback`
3. (First time only) configure the **OAuth consent screen** — External, add your app
   name + support email; add yourself as a test user while it's unpublished.
4. Copy the **Client ID** and **Client secret** into `GOOGLE_CLIENT_ID` /
   `GOOGLE_CLIENT_SECRET` (locally in `.env`, and in the Vercel dashboard).

Notes:
- The redirect URI is derived from the request origin, so the same code works on
  localhost and production — just register both URIs above.
- If someone signed up with email + password and later uses Google with the **same
  email**, the accounts are linked automatically.
- Google-only accounts have no password; the login form tells them to use Google.

## Inviting teammates

- Open the **workspace switcher** (top bar) → the invite code is shown; click to copy.
- A teammate signs up, then chooses **Join with a code** and pastes it.

## Source-of-truth files

Each workspace has a **Sources** store (folder icon in the top bar): upload reference
files your team treats as canonical. Text files (`.md`, `.txt`, `.csv`, code, JSON…)
are read and fed to the agent as authoritative context; any file can be downloaded by
the team. Bytes are stored in Postgres, so it works locally and on Vercel with no extra
service — **max 4 MB per file** (staying under serverless request limits). For larger
files or heavy usage, swap the store for object storage (Vercel Blob / S3) later.

## Upgrading later (nice-to-haves, not required)

- **Password reset / email verification** — add an email provider (Resend/Postmark) and
  reset-token routes.
- **Prisma Migrate** — switch from `prisma db push` to versioned migrations
  (`prisma migrate dev` / `prisma migrate deploy`) once the schema stabilizes, so
  production changes are tracked and reversible.
- **Rate limiting** on `/api/auth/*` to slow brute-force attempts.

---

## Troubleshooting

- **"AUTH_SECRET is not set"** in production → add the env var in Vercel and redeploy.
- **Prisma "Can't reach database"** → check `DATABASE_URL`, ensure `?sslmode=require`,
  and use the **pooled** URL on Vercel.
- **`prisma db push` protocol error** locally → your `.env` `DATABASE_URL` must start
  with `postgresql://` (not `file:`).
- **Schema changed but the app errors** → rerun `npx prisma db push` and redeploy.

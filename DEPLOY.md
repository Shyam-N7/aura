# Deploying AURA to Vercel (aurafm.live)

AURA ships as **one Vercel project**: the Vite frontend as static assets and the
Express backend as a single serverless function. Both live on the same origin,
so the frontend's relative `/api/*` calls work with no CORS and no API base URL.

```
aurafm.live  (Vercel)
  ├─ static dist/            ← vite build
  └─ /api/*  → api/[...path].js → server/app.js (Express, stateless per request)
                                    └─► Postgres (Neon)  +  Gemini / Resend / catalog
```

## How the code is structured for serverless

| File | Role |
|------|------|
| `server/app.js` | The Express app. **No side effects at import** — no DB connect, no migrations, no `listen()`. Exports the app. |
| `server/index.js` | **Local dev only.** Bootstraps the DB (`initDb`) then `app.listen(8787)`. Run via `npm run dev:all`. |
| `api/[...path].js` | **Vercel entry.** `export default app` — the whole Express app behind one catch-all function. |
| `server/migrate.js` | One-off migration runner (`npm run migrate`). Applies schema to an existing DB; never runs `CREATE DATABASE`. |
| `vercel.json` | Build = `npm run build`, output = `dist`, SPA fallback for non-`/api` routes. |

Serverless-safety changes already made: migrations split out of the request
path; `bcrypt` → `bcryptjs` (pure JS); media-URL DES decrypt → `crypto-js`
(no `--openssl-legacy-provider` needed); body parsing tolerant of host
pre-parsing. Local `npm run dev:all` behaves exactly as before.

> In-memory caches (greeting/featured/discover/bridges/related) go cold per
> function instance instead of persisting in one long-lived process. Correctness
> is unaffected (all are TTL/date-seeded); the only cost is slightly more
> upstream calls. Fine for a demo.

---

## Step 1 — Provision Postgres (Neon, free)

1. Create a project at https://neon.tech → it gives you a database.
2. From the connection dialog, copy **both** strings:
   - **Pooled** (host contains `-pooler`) → the app's `DATABASE_URL`. Pooling
     stops serverless fan-out from exhausting Postgres connections.
   - **Direct** (host *without* `-pooler`) → used only for the one-off migration
     in Step 2 (multi-statement DDL runs cleaner off the pooler).
   Both look like: `postgresql://USER:PASSWORD@ep-xxx[-pooler].REGION.aws.neon.tech/DB?sslmode=require`

## Step 2 — Run migrations once

From the project root, point `DATABASE_URL` at the Neon **direct** URL and run
the migrator (creates all tables; needs no admin/CREATE DATABASE rights):

```powershell
# PowerShell — use the DIRECT (non -pooler) string here
$env:DATABASE_URL = "postgresql://...neon.tech/DB?sslmode=require"
npm run migrate
```
Expected: `AURA migrations applied — schema_version=7`. Run it again any time you
add migrations; it's idempotent.

## Step 3 — Put the project in Git (private)

It isn't a repo yet. Use a **private** GitHub repo so the catalog code stays
unpublished. `.env.local`, `dist/`, and `node_modules/` are already gitignored.

```powershell
git init
git add -A
git commit -m "AURA: serverless-ready for Vercel"
# create a PRIVATE repo on github.com, then:
git remote add origin https://github.com/<you>/aura.git
git branch -M main
git push -u origin main
```

## Step 4 — Import into Vercel + set env vars

1. https://vercel.com → **Add New → Project** → import the GitHub repo.
2. Vercel auto-detects Vite from `vercel.json` (build `npm run build`, output `dist`).
3. **Environment Variables** — add every key below (copy values straight from
   your local `.env.local`, except `DATABASE_URL` = the Neon pooled URL).
   Apply to **Production** (and Preview if you want PR previews).

   > ⚠️ **Every "Required" var below must be set (none blank), or the function
   > fails to load on cold start and EVERY route 500s — including `/api/health`.**
   > `config.js`/`db.js` validate at import time, so one missing var takes down
   > the whole API, not just one feature.

   **Required (app won't boot without these):**
   ```
   DATABASE_URL          (Neon pooled URL)
   JWT_SECRET            (copy from .env.local)
   CATALOG_API_BASE  CATALOG_MEDIA_KEY  CATALOG_BITRATE  CATALOG_USER_AGENT
   CATALOG_CTX  CATALOG_CTX_HOME  CATALOG_API_VERSION
   CATALOG_AUDIO_SRC_QUALITY  CATALOG_IMG_SRC_SIZE  CATALOG_IMG_DEST_SIZE
   CATALOG_M_SEARCH  CATALOG_M_SONG  CATALOG_M_HOME  CATALOG_M_PLAYLIST
   CATALOG_M_LYRICS  CATALOG_M_ARTIST  CATALOG_M_ALBUM
   LYRICS_API_BASE  LYRICS_USER_AGENT  LYRICS_TIMEOUT_MS
   ```

   **Optional (features degrade gracefully if absent):**
   ```
   CATALOG_M_STATION_CREATE  CATALOG_M_STATION_SONGS  CATALOG_CTX_STATION
                         → "related / up next" radio. CATALOG_CTX_STATION must be
                           the catalog's app context (the web context returns an
                           empty station); without these, related-tracks falls
                           back to an artist-seeded search.
   GEMINI_API_KEY        → AI features (why / talk / journal / DNA / greeting)
   GOOGLE_CLIENT_ID      → Google sign-in (server-side verify)
   RESEND_API_KEY        → real signup/reset emails
   MAIL_FROM             → e.g. AURA <noreply@aurafm.live>
   MUSIXMATCH_USERTOKEN  → extra synced-lyrics coverage, FREE (best for Indian
                           regional film music, which LRCLIB largely lacks). Mint
                           one from the desktop token endpoint:
                           GET apic-desktop.musixmatch.com/ws/1.1/token.get
                               ?app_id=web-desktop-app-v1.0&format=json
                           (desktop User-Agent + `Cookie: x-mxm-token-guid=`) →
                           message.body.user_token. ToS gray area; the token can
                           be rate-limited/revoked — re-mint and update this var.
   ```

   **Lyrics generation (Replicate WhisperX) — OPTIONAL & PAID.** Only the long tail
   that no provider (LRCLIB → Musixmatch → NetEase) has anywhere is generated from
   audio. Pay-per-use (~1–4¢/song, charged once then cached forever) and needs a
   billing-enabled Replicate account. Leave the whole group blank to keep it off.
   To enable, set `REPLICATE_API_TOKEN`, `PUBLIC_BASE_URL` (`https://aurafm.live`),
   `REPLICATE_WEBHOOK_SIGNING_SECRET` (`whsec_…` from Replicate's
   `GET /v1/webhooks/default/secret`), `CRON_SECRET` (random string; authorizes the
   daily reaper cron in `vercel.json`), and optionally `LYRICS_GEN_DAILY_CAP` (spend
   guard, default 500/day). The pipeline (HMAC-verified webhook, atomic daily cap)
   is already built — see `.env.example` for the full notes.

   > After adding `MUSIXMATCH_USERTOKEN`, clear cached misses so already-viewed
   > songs re-check through the richer chain (misses are cached `'none'` for 7 days):
   > `DELETE FROM lyrics WHERE source IN ('none','pending');`

   **Build-time (browser bundle) — add under env too:**
   ```
   VITE_GOOGLE_CLIENT_ID → enables the Google sign-in button (must match GOOGLE_CLIENT_ID)
   ```

   **Do NOT set `PORT`** — Vercel functions don't listen on a port. Don't set
   `MAIL_DEV_ECHO` in production unless you intend emails to only log.

4. **Deploy.**

## Step 5 — Attach the domain

Project → **Settings → Domains → Add `aurafm.live`**. Because Vercel is your
registrar, it's one click — Vercel sets the DNS automatically. Add `www.aurafm.live`
too if you want it to redirect to the apex.

## Step 6 — Auth + email for a public demo

- **Google sign-in:** in Google Cloud Console → Credentials → your OAuth client →
  add `https://aurafm.live` to **Authorized JavaScript origins**. Set both
  `GOOGLE_CLIENT_ID` (server) and `VITE_GOOGLE_CLIENT_ID` (build) to that client ID.
- **Email signup (OTP):** Resend won't deliver from `@aurafm.live` until you
  verify the domain — Resend → Domains → add `aurafm.live` → add the shown
  SPF/DKIM records in Vercel DNS. **Until then, email/password signup can't
  receive codes** — so for the demo either (a) use Google sign-in only, (b)
  finish Resend domain verification (~15 min), or (c) ask me to add a one-click
  guest/demo account.

## Post-deploy smoke test

```
GET  https://aurafm.live/api/health            → {"ok":true,"ts":...}
GET  https://aurafm.live/api/catalog/featured  → {"results":[...]}   (proves catalog + DES decrypt)
POST https://aurafm.live/api/auth/signup       → confirms request bodies arrive (not empty)
```
Open the site, play a track (confirms decrypted stream URLs work), and check the
Vercel **Functions** logs if anything 500s.

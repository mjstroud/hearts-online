# ☀ Shoot the Sun

Private online Hearts, with house rules, for a family game that runs all year. Lives at [shootthesun.com](https://shootthesun.com). Sign in, share a join code, and play live together or a few tricks at a time. Every move is saved, the scoreboard keeps a running total across hundreds of hands, and the stats pages track who keeps getting stuck with the Queen.

Built with [Astro](https://astro.build) (server-rendered), [Svelte](https://svelte.dev) for the live table, and SQLite through Node's built-in `node:sqlite`. There are no native modules and no external services.

## Features

- **Accounts and private games.** Username and password sign-in. Each game has a 6-character join code and invite link, and only seated players can see it. Leave and come back from any device. Site admins can make one-time password reset links from `/admin`.
- **Profile photos.** Upload one from the Account page and it replaces your initials wherever players are shown. The browser crops it to a 256px square before uploading. It's stored in the SQLite file with camera and location metadata stripped. The cats always keep their 🐱.
- **Live or at your own pace.** Moves sync instantly over Server-Sent Events. A game can also sit idle for days and resume where it left off. Optional browser alerts tell you when it's your turn, through a small service worker so they work on Android too. A tab left open across a deploy shows a "New version, tap to refresh" pill.
- **Phone-first.** Built for phones: no zooming on text boxes or quick taps, notch-safe padding, an action bar that doesn't move the hand, and full reduced-motion support. Add it to your home screen for an app-style icon and full-screen window.
- **Terms and privacy.** Short Terms and Privacy pages. New players agree at sign-up, and existing players agree once on their next visit.
- **Optional move timer** (30 s to 5 min, off by default). When someone runs out of time, a cat sits in for them until they tap "I'm back" or play a card. If every person at the table is away, the table pauses instead of playing itself.
- **House rules** (configurable per game):
  - Jack of Diamonds is **−10**.
  - A 4-card face-down **crib** goes to whoever wins the first trick. Only they get to see it, and its cards count toward their score.
  - **Shooting the Moon** (all hearts and the Q♠): everyone else +26.
  - **Shooting the Sun** (win every trick): everyone else +52.
  - The **lowest club in play** leads the first trick.
  - Passing rotates left → right → across → keep. With 5 players it's left → right → left across → right across → keep.
  - **5-player games** take out the 2♣, 2♦ and 2♠, so the 4-card crib still works and everyone gets 9 cards.
  - Games only end on a **completed hand**. By default there's no score limit, and the host marks a final hand when the season's over. If a limit is set, the game ends after the first hand in which someone reaches it.
- **Playtest tables.** A solo sandbox for trying out rules:
  - every hand and the crib face up (each can be toggled)
  - computer players on auto at a chosen speed, or on manual so you play their cards yourself
  - AI-step one move, finish a trick or a hand, and undo
  - stacked deals: Moon and Sun setups, the Q♠, J♦ or lowest club in the crib, or your own custom deck, with a choice of pass direction

  The panel also shows latency: tap to screen, tap to server reply, and tap to live update. Playtest games don't count toward lifetime stats.
- **Scoreboard.** Standings, a running-total chart, and a hand-by-hand score sheet marking who took the Q♠, the J♦, the crib, or shot the moon or sun.
- **Advanced stats**, per game and lifetime:
  - average points per hand
  - Q♠ %, J♦ %, and crib %, plus the average crib value
  - hearts and tricks per hand
  - clean hands and hands won
  - moons and suns
  - best and worst hand
  - how often each player passed or received the Queen
  - fun superlatives
- **Computer players.** The host can fill empty seats with simple bots.
- **How to play** page covering the house rules.

## Running locally

Requires **Node 22.23.4+** (Node 24 recommended).

```bash
npm install
npm run dev        # http://localhost:4321
```

The database is created at `./data/hearts.db` on first run. To try things out by yourself, sign up and open **⚗ Playtest** on the Games page.

Other scripts:

```bash
npm test               # unit tests (Vitest)
npm run build          # production build into ./dist
npm run check:budgets  # after a build: fail if the game page's JS or the CSS goes over its size budget
npm start              # run the production server
```

In dev, `/dev/long-names?players=5` (or `4`) makes a playtest table full of 32-character names for checking layouts; add `&me=long` to lengthen your own. To try it on a real phone, run `npm run dev -- --host` and open the PC's network address on the same Wi-Fi (leave `SITE_URL` unset). `CLAUDE.md` has the project's ground rules and [ROADMAP.md](ROADMAP.md) the plan.

## Configuration

Set these as environment variables, or in a `.env` file (see `.env.example`):

| Variable        | Default             | Purpose                                                                 |
| --------------- | ------------------- | ----------------------------------------------------------------------- |
| `DATABASE_PATH` | `./data/hearts.db`  | SQLite file location. Put it on a persistent disk in production.        |
| `SIGNUP_CODE`   | _(unset)_           | If set, new accounts must enter this code. Keeps sign-ups family-only.  |
| `ADMIN_USERNAMES` | _(unset)_         | Comma-separated usernames that can open `/admin` and make password reset links. |
| `SITE_URL`      | _(unset)_           | The one public address (`https://shootthesun.com`). Other hosts redirect there, and reset links use it. |
| `HOST` / `PORT` | `localhost` / `4321`| Address the production server listens on.                               |

## Deploying

The app is a single long-running Node process with a SQLite file. Any host with a **persistent volume** works. Serverless platforms won't work because live updates need a running server and the database needs a disk.

### Docker

```bash
docker build -t hearts-table .
docker run -p 8080:8080 -v hearts-data:/data -e SIGNUP_CODE=letmein hearts-table
```

### Fly.io

A `fly.toml` is included. GitHub Actions does the deploying, so no machine needs `flyctl` installed.

**One-time setup**

1. Pick a unique app name and set `app` in `fly.toml`.
2. In the Fly dashboard, create an org token for your `personal` organization. Add it to the GitHub repo as the secret `FLY_ORG_TOKEN`.
3. Optional: add a `SIGNUP_CODE` repo secret to keep sign-up family-only.
4. In GitHub, go to Actions → **Fly launch** → Run workflow. It creates the app, the `hearts_data` volume, and the secret, then deploys.
5. In the Fly dashboard, create a deploy token for the new app. Add it as the secret `FLY_API_TOKEN`, then delete `FLY_ORG_TOKEN` from GitHub and revoke it in Fly.

**After that:** every push to `main` that passes tests deploys automatically. Logs, secrets, and machine status are in the Fly dashboard. Each deploy restarts the single machine, which causes a few seconds of downtime.

You can also do the one-time setup from your own computer with `fly auth login`, then `fly apps create`, `fly volumes create hearts_data --region ord --size 1`, `fly secrets set ...` and `fly deploy`. You still need step 5 afterwards so that pushes to `main` deploy.

**Secrets to set:** `SIGNUP_CODE`, `ADMIN_USERNAMES` (your username), and `SITE_URL` once the custom domain works (see below).

**Custom domain (shootthesun.com, DNS on Cloudflare)**

1. `fly ips allocate-v6`, plus `fly ips allocate-v4 --shared` if the app has no IPv4 yet. `fly ips list` shows the addresses.
2. In Cloudflare DNS, add an `A` record for `shootthesun.com` pointing at the shared IPv4 and an `AAAA` record pointing at the IPv6. Add a `CNAME` for `www` pointing at `<app>.fly.dev`. Set all three to **DNS only** (grey cloud) so Fly can issue and serve the certificates.
3. `fly certs add shootthesun.com` and `fly certs add www.shootthesun.com`. Then `fly certs check shootthesun.com` until both are issued.
4. `fly secrets set SITE_URL=https://shootthesun.com`. From then on, the fly.dev address and `www.` redirect to the apex domain. Don't set this before the certificate is issued, or every visit gets redirected to an address that doesn't work yet.

**Backups:** Fly snapshots the volume daily and keeps the snapshots for a few days (`fly volumes snapshots list`).

### Railway / Render

Deploy from this repo with the Dockerfile. Attach a volume mounted at `/data` and set `SIGNUP_CODE`.

**Backups:** everything lives in the one SQLite file. Copy it (or use `sqlite3 hearts.db ".backup backup.db"`) to back up a year of scores.

## Project layout

```text
src/
  lib/engine/      Pure, tested rules engine: dealing, passing, legal plays, scoring, bots, per-player views
  lib/server/      SQLite storage, auth/sessions, game actions, live-update hub, stats
  components/      PlayingCard, the live game table (Svelte), charts, shared Astro pieces
  pages/           Routes: landing, auth, games, scoreboard, stats, rules, JSON/SSE API
  middleware.ts    Sessions, route protection, same-origin checks, security headers
```

### How a move flows

1. The browser POSTs `{type: "play", card: "QS"}` to `/api/games/:id/action`.
2. The server loads the game and checks that the player is seated and the move is legal. It applies the move and saves it in one SQLite transaction. A finished hand is appended to the `hands` table, and every stat is computed from that table.
3. Each connected player's `/api/games/:id/events` stream receives **their own** view of the table. Other players' cards, and the crib unless you won it, never leave the server.
4. If a computer player is next, the server plays for it after a short pause.

## Security notes

- Passwords are hashed with scrypt. Sessions use random tokens, stored only as SHA-256 hashes, in `HttpOnly`, `SameSite=Lax` cookies.
- State-changing requests must come from the same origin. The check works behind a TLS proxy.
- Sign-in and sign-up attempts are rate-limited per username and per IP. Changing your password signs out your other devices.
- Redirects after sign-in only go to paths on this site.
- Profile photos are checked on the server, whatever the browser says they are. The format is worked out from the bytes and the file is parsed: JPEG or WebP only, no animation, at most 60 KB and a 32–512px square, so a tiny file can't claim to be huge. Each upload gets a new unguessable URL, served only to signed-in people with a sandboxing Content-Security-Policy.

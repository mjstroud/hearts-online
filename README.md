# ♥ Hearts Table

A private online Hearts table for a family game that runs all year. Sign in, share a join code, and play live together or a few tricks at a time. Every move is saved, the scoreboard keeps a running total across hundreds of hands, and the stats pages track who keeps getting stuck with the Queen.

Built with [Astro](https://astro.build) (server-rendered), [Svelte](https://svelte.dev) for the live table, and SQLite through Node's built-in `node:sqlite`. There are no native modules and no external services.

## Features

- **Accounts and private games.** Username and password sign-in. Each game has a 6-character join code and invite link, and only seated players can see it. Leave and come back from any device.
- **Live or at your own pace.** Moves sync instantly over Server-Sent Events. A game can also sit idle for days and resume where it left off. Optional browser alerts tell you when it's your turn.
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

  Playtest games don't count toward lifetime stats.
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

Requires **Node 22.13+** (Node 24 recommended).

```bash
npm install
npm run dev        # http://localhost:4321
```

The database is created at `./data/hearts.db` on first run. To try things out by yourself, sign up and open **⚗ Playtest** on the Games page.

Other scripts:

```bash
npm test           # rules-engine unit tests (Vitest)
npm run build      # production build into ./dist
npm start          # run the production server
```

## Configuration

Set these as environment variables, or in a `.env` file (see `.env.example`):

| Variable        | Default             | Purpose                                                                 |
| --------------- | ------------------- | ----------------------------------------------------------------------- |
| `DATABASE_PATH` | `./data/hearts.db`  | SQLite file location. Put it on a persistent disk in production.        |
| `SIGNUP_CODE`   | _(unset)_           | If set, new accounts must enter this code. Keeps sign-ups family-only.  |
| `HOST` / `PORT` | `localhost` / `4321`| Address the production server listens on.                               |

## Deploying

The app is a single long-running Node process with a SQLite file. Any host with a **persistent volume** works. Serverless platforms won't work because live updates need a running server and the database needs a disk.

### Docker

```bash
docker build -t hearts-table .
docker run -p 8080:8080 -v hearts-data:/data -e SIGNUP_CODE=letmein hearts-table
```

### Fly.io

A `fly.toml` is included. Change `app` to a unique name first.

```bash
fly launch --no-deploy            # accept the existing fly.toml
fly volumes create hearts_data --size 1
fly secrets set SIGNUP_CODE=your-family-code
fly deploy
```

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

# ☀ Shoot the Sun

Private online Hearts, with house rules, for a family game that runs all year. Lives at [shootthesun.com](https://shootthesun.com). Sign in, share a join code, and play live together or a few tricks at a time. Every move is saved, the scoreboard keeps a running total across hundreds of hands, and the stats pages track who keeps getting stuck with the Queen.

Built with [Astro](https://astro.build) (server-rendered), [Svelte](https://svelte.dev) for the live table, and SQLite through Node's built-in `node:sqlite`. There are no native modules and no external services.

## Features

- **Accounts and private games.** Username and password sign-in. Each game has a 6-character join code and invite link, and only seated players can see it. Leave and come back from any device. Site admins can make one-time password reset links from `/admin`.
- **Profile photos.** Upload one from the Account page and it replaces your initials wherever players are shown. The browser crops it to a 256px square before uploading. It's stored in the SQLite file with camera and location metadata stripped. The cats always keep their 🐱.
- **Live or at your own pace.** Moves sync instantly over Server-Sent Events. A game can also sit idle for days and resume where it left off. Optional browser alerts tell you when it's your turn, through a small service worker so they work on Android too. A tab left open across a deploy shows a "New version, tap to refresh" pill.
- **Phone-first.** Built for phones: no zooming on text boxes or quick taps, notch-safe padding, an action bar that doesn't move the hand, and full reduced-motion support. Add it to your home screen for an app-style icon and full-screen window. The Get the app page (`/app`, linked from the account menu, the footer and a dismissible card on /games on phones) shows a one-tap Install button when the browser offers one, and step-by-step instructions for iPhone, Android and computers when it doesn't.
- **An easy-to-read table.**
  - Trick cards stack by seat, so the led card is never buried. A ring marks the led card and a glow marks the card currently winning.
  - The finished trick stays on the felt until the next lead, and a Last trick button brings it back. Tap a trick, or hover on a computer, to see who played what.
  - A corner of the felt shows tricks left and whether hearts are broken.
  - **Sun and Moon watches.** Anyone who could still shoot glows: sun rays behind the avatar of whoever has won every trick so far (from the first trick), and a pale Moon halo behind whoever has taken every point card so far (from the first heart). The glow grows in three steps as the run goes on, and from the second step (3 tricks in a row, or 5 hearts) the corner names them too. It's worked out from face-up cards only, so the crib stays secret. The host can turn the watches off.
- **Table moments.** Short messages when hearts break, the Q♠ is played and eaten, or the J♦ is grabbed. A Sun or Moon watch has no message: its glow lights up, grows, and goes out when the run is broken. When someone shoots the Moon or the Sun, a sunrise or moonrise plays before the results.
- **Trick review.** Every finished hand's tricks can be replayed from the results screen ("See the tricks") or by tapping a hand number on the scoreboard. They load on demand from `/api/games/:id/hands/:number`.
- **Terms and privacy.** Short Terms and Privacy pages. New players agree at sign-up, and existing players agree once on their next visit.
- **Less waiting.**
  - **Queue your card.** Once the lead card is down (on the first trick, as soon as play starts), tap a card you could follow with and it goes down the moment your turn arrives. Tap it again to cancel. Nobody else can tell you queued it until it's played.
  - **The last trick plays itself.** Everyone's last card is forced, so after the usual pause the server plays the trick one card at a time, at the cats' pace, so everyone can see who played what. On your turn, a tap on your last card still plays it straight away.
  - **Hands end early** once nobody can take any more points, as everyone can see from the cards played face up. The server plays out the rest at once. Those tricks are left out of trick counts and the trick review. It never looks at hidden hands or the crib, so it fires only once every heart, the Q♠ and the J♦ have been played.
  - The tab title, turn alerts and the "Your move" list on /games only count moves you actually have to make, not a card a cat or the server is about to play for you.
  - The host can switch the last trick and early ending off on the game's Settings page, mid-game too. Both are on by default.
- **Removing a player.** The host can remove anyone but themselves from the game's Settings page at any time. In a waiting room the seat empties. Mid-game a cat takes the seat for good and plays out the hand in progress, and the hands the person finished stay theirs in the stats, scoreboard and trick review.
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
- **Keep playing or rematch.** When a game is over, the host can do one of two things from the results screen:
  - **Keep playing:** the same game deals on. Totals, hand numbers and the pass rotation carry on, and the scoreboard and stats keep counting. If the game ended on its score limit, the host picks a higher limit or no limit.
  - **Set up a rematch:** a new waiting room with the same players, seats and house rules, scores back to zero. The host can shuffle seats or add and remove players before dealing. Everyone's results screen links to it, and a second click opens the same rematch.

  While a rematch exists, the old game can't be continued; deleting the rematch brings Keep playing back. Both go through the action API (`extend` and `rematch`).
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
npm run check          # type check: astro check and svelte-check (CI runs it; warnings in .svelte files fail it)
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
| `SITE_ENV`      | _(unset)_           | `dev` only on the dev site: DEV badge, "Dev ·" titles, noindex, and the `/dev` tools. Leave unset everywhere else. |
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

**After that:** every push to `main` that passes tests deploys automatically. Logs, secrets, and machine status are in the Fly dashboard. Each deploy restarts the single machine, which causes a few seconds of downtime. Day-to-day work goes to the dev site first; see [Branches and releases](#branches-and-releases).

You can also do the one-time setup from your own computer with `fly auth login`, then `fly apps create`, `fly volumes create hearts_data --region ord --size 1`, `fly secrets set ...` and `fly deploy`. You still need step 5 afterwards so that pushes to `main` deploy.

**Secrets to set:** `SIGNUP_CODE`, `ADMIN_USERNAMES` (your username), and `SITE_URL` once the custom domain works (see below).

**Custom domain (shootthesun.com, DNS on Cloudflare)**

1. `fly ips allocate-v6`, plus `fly ips allocate-v4 --shared` if the app has no IPv4 yet. `fly ips list` shows the addresses.
2. In Cloudflare DNS, add an `A` record for `shootthesun.com` pointing at the shared IPv4 and an `AAAA` record pointing at the IPv6. Add a `CNAME` for `www` pointing at `<app>.fly.dev`. Set all three to **DNS only** (grey cloud) so Fly can issue and serve the certificates.
3. `fly certs add shootthesun.com` and `fly certs add www.shootthesun.com`. Then `fly certs check shootthesun.com` until both are issued.
4. `fly secrets set SITE_URL=https://shootthesun.com`. From then on, the fly.dev address and `www.` redirect to the apex domain. Don't set this before the certificate is issued, or every visit gets redirected to an address that doesn't work yet.

**Backups:** Fly snapshots the volume daily and keeps the snapshots for a few days (`fly volumes snapshots list`).

### Branches and releases

Two long-lived branches, each deployed by CI when it's pushed:

| Branch | Deploys to | What goes there |
|---|---|---|
| `dev` | [dev.shootthesun.com](https://dev.shootthesun.com) (Fly app `hearts-table-dev`, `fly.dev.toml`) | Finished work, ready to try on real phones. |
| `main` | [shootthesun.com](https://shootthesun.com) (Fly app `hearts-table`, `fly.toml`) | Releases only. |

`dev` is the repo's default branch on GitHub, so pull requests aim at it unless you choose otherwise.

- **Everyday work:** branch off `dev` (for example `feature/table-moments`), then open a pull request into `dev` (base: `dev`), or merge locally and push `dev`. Pushing `dev` deploys the dev site. Squash-merging a feature branch is fine.
- **A release:** when `dev` is ready, open a pull request from `dev` into `main` between play sessions. Its description is the release notes.
  - If the release adds a database migration, snapshot the real site's volume first: `fly volumes snapshots create <volume id>`. `fly volumes list` shows the id.
  - Merge it with **Create a merge commit**, never squash or rebase, or `main` gets commits `dev` doesn't have and the two drift apart. Merging deploys the real site.
  - Then tag what was deployed: `git fetch origin`, then `git tag -a release-YYYY-MM-DD origin/main -m "..."`, then `git push origin release-YYYY-MM-DD`. Tags don't trigger CI.
- **An urgent fix for the real site:** branch off `main`, open a pull request into `main`, then merge `main` back into `dev` (also with a merge commit) so the two don't drift.
- Pull requests to either branch run the tests, but only pushes deploy. Only a release or an urgent fix ever targets `main`.

### Dev site

`dev.shootthesun.com` is a second Fly app (`hearts-table-dev`) with its own volume and database. Accounts and games there are separate from the real site, so test freely.

- It has a gold **DEV** badge by the logo, a "Dev ·" tab title, and headers that keep search engines out.
- The `/dev/long-names` table works there too.
- It sleeps when nobody's using it (`auto_stop_machines`), so the first visit after a while takes a few seconds to wake it.
- **Manual deploy:** `fly deploy --remote-only --config fly.dev.toml` deploys whatever is in your working copy, committed or not. It's handy for a quick check before pushing.

> **Careful:** in this repo, any `fly` command without `--app` or `--config` acts on the **real** app, because `fly.toml` names it. For the dev site, always add `--app hearts-table-dev` (or `--config fly.dev.toml` for deploys). Only deploy the real app by hand from a clean, up-to-date `main`.

**One-time setup** (already done for `hearts-table-dev`; kept here in case it ever needs redoing):

1. `fly apps create hearts-table-dev --org personal`, then `fly volumes create hearts_dev_data --app hearts-table-dev --region ord --size 1`.
2. `fly secrets set SIGNUP_CODE=<a code> ADMIN_USERNAMES=<your username> --app hearts-table-dev --stage`, so sign-up is never open. You'll need to sign up on the dev site under that username before admin works, because its database is separate.
3. First deploy: `fly deploy --remote-only --config fly.dev.toml`. Then `fly ips list --app hearts-table-dev` should show an IPv6 and a shared IPv4; if not, run `fly ips allocate-v6 --app hearts-table-dev` and `fly ips allocate-v4 --shared --app hearts-table-dev`.
4. `fly certs add dev.shootthesun.com --app hearts-table-dev`. It prints the DNS records to add (`fly certs setup dev.shootthesun.com --app hearts-table-dev` shows them again). In Cloudflare DNS for shootthesun.com, add an `A` record and an `AAAA` record, both named `dev`, pointing at the dev app's shared IPv4 and IPv6 from `fly ips list --app hearts-table-dev`. Set both to **DNS only** (grey cloud), like the main domain's records.
5. `fly certs check dev.shootthesun.com --app hearts-table-dev` until it says the certificate is issued, usually within a few minutes of the DNS records existing.
6. Only then: `fly secrets set SITE_URL=https://dev.shootthesun.com --app hearts-table-dev`. Setting it earlier redirects visits to an address that doesn't work yet. Never copy the real site's `SITE_URL` here: it would send every dev visit to shootthesun.com.
7. CI: `fly tokens create deploy --app hearts-table-dev`, then save the output as the GitHub repo secret `FLY_DEV_API_TOKEN` (Settings → Secrets and variables → Actions). Until it's set, pushes to `dev` run the tests but skip the deploy with a warning.
8. On GitHub, make `dev` the default branch (Settings → General → Default branch).

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
4. If a computer player is next, the server plays for it after a short pause. If the next person has queued a card, it goes down in the same transaction. Queued cards live in server memory, apart from the game's saved state, so queueing changes nothing the rest of the table can see.

## Security notes

- Passwords are hashed with scrypt. Sessions use random tokens, stored only as SHA-256 hashes, in `HttpOnly`, `SameSite=Lax` cookies.
- State-changing requests must come from the same origin. The check works behind a TLS proxy.
- Sign-in and sign-up attempts are rate-limited per username and per IP. Changing your password signs out your other devices.
- Redirects after sign-in only go to paths on this site.
- Profile photos are checked on the server, whatever the browser says they are. The format is worked out from the bytes and the file is parsed: JPEG or WebP only, no animation, at most 60 KB and a 32–512px square, so a tiny file can't claim to be huge. Each upload gets a new unguessable URL, served only to signed-in people with a sandboxing Content-Security-Policy.

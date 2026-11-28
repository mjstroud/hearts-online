# Shoot the Sun

Online Hearts with house rules for one family, live at https://shootthesun.com. Real people play on it, and a season game runs all year, so treat every deploy and every stored row as production data. README.md covers the features, the house rules, configuration and deploying. ROADMAP.md is the plan: what to build next, in phases, and why.

Stack: Astro 7 (server-rendered, node adapter), Svelte 5 with runes for the live table, SQLite through Node's built-in `node:sqlite`, and live updates over Server-Sent Events from an in-process hub. One Node process and one SQLite file on one Fly.io machine.

## Commands

```bash
npm run dev               # http://localhost:4321, database at ./data/hearts.db
npm run dev -- --host     # also on the LAN, for testing on a real iPhone (see below)
npm test                  # Vitest
npm run check             # types: astro check (.astro, .ts) and svelte-check (.svelte, warnings fail too)
npm run build             # production build into ./dist
npm run check:budgets     # after a build: fails if the browser bundle is over budget
npm start                 # run the production build
```

- **Dev seed with long names:** sign in locally, then open `/dev/long-names` for a 5-player playtest table where every other seat has a 32-character, one-word name. `?players=4` gives four seats, and `me=long` (as in `/dev/long-names?players=4&me=long`) gives your own local account a 32-character name too. It also works on the dev site; the real site answers 404.
- **Phone sizes:** `/dev/phones` shows one of your games at every phone size in ground rule 8, one at a time, with automatic checks; **Check every size** runs them all. Its sizes are what a browser leaves the page after its own bars (estimates); `&fit=app` uses the whole screen, as an installed app. `/dev/checklist` is the family's five-minute check on their own phones.
- **Real iPhone:** run `npm run dev -- --host` and open the Network address it prints on an iPhone on the same Wi-Fi. Sign-in works over plain http. Leave `SITE_URL` blank in `.env`, or the phone gets redirected to that address. Service workers, home-screen installs and push need https, so test those on the dev site (dev.shootthesun.com).
- **CI** (`.github/workflows/ci.yml`) runs the type check, the tests, the build and the budget check on every push to `dev` or `main` and on pull requests.
- **Branches:** `dev` is the default branch. Work branches off `dev` and lands by merging it into `dev` locally with a merge commit (`git merge --no-ff`) and pushing `dev`. No pull request is needed (and `gh` isn't installed). Every push to `dev` deploys the dev site, dev.shootthesun.com (`fly.dev.toml`, app `hearts-table-dev`, its own database). A release merges `dev` into `main` the same way, with a merge commit (never squash or rebase). Every push to `main` deploys the real site (`fly.toml`, app `hearts-table`), restarting its one machine. Never merge or push to `main` unless the owner asks for a release or an urgent fix. For an urgent fix, branch off `main`, merge into `main`, then merge `main` back into `dev`. README → Branches and releases has the full steps.
- **`fly` commands default to the real app** (`fly.toml` names `hearts-table`). For the dev site, always pass `--app hearts-table-dev` or `--config fly.dev.toml`. Only deploy the real app by hand from a clean, up-to-date `main`.
- **Dev site:** `src/lib/server/env.ts` (`isDevSite()`, from `SITE_ENV=dev`) adds the DEV badge and noindex and turns on dev tools. Anything dev-only must check `devToolsEnabled()`, never just `import.meta.env.DEV`.

## Layout

- `src/lib/engine/`: the pure rules engine (dealing, passing, legal plays, scoring, bots) and `view.ts`, which builds what one seat may see. Keep game rules here.
- `src/lib/server/`: SQLite and migrations (`db.ts`), auth and sessions, game actions and `publish()` (`games.ts`), the live-update hub (`hub.ts`), stats.
- `src/lib/types.ts`: `GameView` and the other shapes the browser receives.
- `src/components/game/`: the live table island. `Game.svelte` is the entry, `Table.svelte` the felt, `DevPanel.svelte` the playtest tools.
- `src/pages/`: routes, plus the JSON and SSE API under `api/games/[id]/` (`action`, `state`, `events`, and `hands/[number]` for the trick review). `src/pages/dev/` holds dev-only routes.
- `src/middleware.ts`: sessions, sign-in for protected paths, same-origin checks, security headers.
- `src/styles/global.css`: shared styles and theme variables. `scripts/check-budgets.mjs`: the size budgets.
- Tests sit next to the code as `*.test.ts`. Server tests point `DATABASE_PATH` at a throwaway file before importing any server module (see the top of `src/lib/server/games.test.ts`). The cats' chatter is random and on its own timers, so `vitest.setup.ts` switches it off for every test file; a test that wants it turns it on with scripted dice, as `chatter.test.ts` does.
- Chatter (taunts now, chat in 4b) goes to seated players through `sendToSeated` in `games.ts`, never `publish()`. Taunts: `src/lib/taunts.ts` (the list), `api/games/[id]/taunt.ts`, `src/lib/server/chatter.ts` (the cats), and the lazy `TauntLayer.svelte` (tray, bubbles, throws).

## Ground rules

1. **Your own actions show instantly.** A play, pass or queued card appears in the same frame it's tapped; the server's update confirms it a moment later.
2. **Stay within the budgets** (gzipped; CI fails a change that goes over):
   - Game page JS at most 55 KB (`npm run check:budgets`).
   - Any other single JS file at most 15 KB; aim for 10 KB or less for a new interactive component.
   - The CSS any one page loads at most 14 KB: its stylesheet files plus any inline CSS (also `npm run check:budgets`). Optional pieces bring their own CSS when they load (`<svelte:options css="injected" />`).
   - One player's live update at most 4 KB (`src/lib/server/view-size.test.ts`).
   Don't raise a budget to make a change fit without asking first.
3. **Load only what's needed.** Optional pieces (the playtest panel, restaurant or taunt art) load with a dynamic `import()` only when they're switched on, never for every player.
4. **Animate with CSS keyframes on `transform` and `opacity` only.** No animated shadows or filters, nothing that loops forever, one shared overlay layer, and full `prefers-reduced-motion` support, Svelte transitions included.
5. **Keep chatter off `publish()`.** Reactions and chat get their own broadcast, and chat history its own endpoint. A game update rebuilds every player's view and reorders /games, so only real game changes go through it.
6. **Never put existing games at risk.**
   - Migrations only add things: append to `MIGRATIONS` in `db.ts`, never edit an old one.
   - Work facts out from the tricks already stored instead of storing them again.
   - Only add `GameView` and `TableView` fields; never rename or remove one. Tabs stay open for days running old code.
   - Take a Fly volume snapshot before deploying a migration.
   - New host options reach running games through their defaults (`normalizeSettings` in `rules.ts`), so choose defaults on purpose.
7. **The table only learns from face-up cards.** Anything shown to the whole table, and every table-wide moment, comes from cards played face-up. The crib winner's own view counts the crib (`queenTakenBy`, `jackTakenBy`, `pointsTaken`), so those fields must never trigger a moment.
8. **Phones come first.** Check every change that affects phones at four sizes, each upright and sideways, with 4 and 5 players and 32-character one-word names (old accounts still have them; new names stop at 16):
   - a small Android, 360×780;
   - an iPhone SE, 375×667;
   - a standard iPhone, 393×852;
   - a large phone, 430×932.

   `/dev/phones` shows a game at all eight and checks each for overflow, overlaps and a hand out of reach. The sizes live in `src/lib/phones.ts`.
   - Anything that shows a player name must cope with a 32-character name: cut short with "…" is fine; overflowing or overlapping never is.
   - Sideways, the whole table, your hand's rank corners and the action button must fit on the screen without scrolling.
   - Check on a real iPhone before merging anything that affects phones. `/dev/checklist` on the dev site is a five-minute check anyone in the family can run on their own phone.
9. **Try it on the dev site first, and release between play sessions.** Every release to `main` restarts the real site's one machine, mid-game for anyone playing. A migration needs a volume snapshot of the real site first.
10. **Ask before** adding an outside service (fonts, CDNs, APIs, push, paid accounts) or changing the site's look or branding. The default look stays as it is.
11. **The GitHub repo is public.** No secrets, no personal details, no family photos in it. Photos live in the database.

Hidden cards never leave the server: each player's view is built for them (`buildView` in `games.ts`, `tableViewFor` in `view.ts`), and only the owner of a playtest table gets the whole deal (`dev`). Keep it that way for anything new.

Also: give every new feature a JSON endpoint, not just a server-rendered form, so a future app can use the same server. Keep comments short and in plain English, explaining why, and match the surrounding code style.

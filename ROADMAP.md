# Roadmap

Updated 2026-11-26 with the owner's answers, checked against the code. Phase 1 is built (see its status). Every open question is answered (see [Decisions](#decisions)).

Sizes are in Claude Code working sessions:

- **XS:** a few minutes
- **S:** a short session
- **M:** a full session with tests
- **L:** several sessions, with schema or protocol changes
- **XL:** a project in itself, with outside services or paid accounts

## What changed after your answers

- **Two-corner cards are out.** Instead: trick cards stack by seat, the 5-player side cards move in on phones, hovering raises a card on desktop, and tapping the trick on a phone opens a strip showing each card with who played it.
- **Last trick** is scoped to the cards, who won and what was led. **Trick review after each hand** replaces the per-game history setting. Every trick of every finished hand is already saved (about 1.5 KB a hand, about 0.6 MB for a 300-hand season), so it needs no new storage.
- **Autocomplete** now follows your rule: end the hand once nothing left can score *and everyone can see that from face-up cards*. A rule that only uses face-up cards leaks nothing about the crib. "Claim the rest" is dropped. Auto-playing the final trick stays, because it saves a trick in every hand.
- **Pre-moves** are confirmed and designed (Phase 3).
- **New: table-wide moments** for hearts, the Q♠, the J♦, and Sun/Moon watches and shots (Phase 2).
- **Performance moves to Phase 1** as guardrails, so new features can't quietly slow the game.
- **Phones first.** Phone fixes and the home-screen basics move to Phase 1.
- **Chat:** a simple saved text chat, plus a "Join call" button for voice. No calling built into the app.
- **Public lobbies:** anyone can ask to join a public table, and the host accepts, rejects or kicks.
- **Restaurant mode, cartoony art, cat photos and thrown taunts** are planned (Phase 5).
- **A store app** is a long-term goal (Phase 6), built on the same server and accounts.

## Ground rules

These are the "build it fast from the start" rules. They answer the performance question, and they belong in a `CLAUDE.md` so every future session follows them (Phase 1).

1. **Your own actions show instantly.** Anything you do (play, pass, queue a card) appears on screen in the same frame, and the server's update confirms it a moment later. A dev-only readout in the playtest panel shows tap-to-screen and tap-to-server times.
2. **Budgets, checked in CI** (`npm run check:budgets` and `view-size.test.ts`):
   - Game page JS: at most 55 KB gzipped (39.5 KB after Phase 1, 44.3 KB after Phase 2; raised from 45 KB with the owner's OK).
   - Any other JS file: at most 15 KB, and aim for 10.
   - All CSS together: at most 14 KB. It was 10.2 KB after Phase 1; the owner OK'd raising the cap from 11 KB for the Phase 2 visuals.
   - One player's live update: at most 4 KB (2.5–2.8 KB with 32-char names).
   A deploy that goes over fails. Raise a budget only with the owner's OK.
3. **Load only what's needed.** The playtest panel currently ships to every player. Restaurant and taunt art should load only when switched on.
4. **Animation:** CSS keyframes on `transform` and `opacity` only. No animated shadows or filters, nothing that loops forever, one shared overlay layer, and reduced motion fully respected (Svelte transitions currently ignore it).
5. **Chatter stays out of game updates.** Reactions and chat get their own broadcast, and chat history gets its own endpoint. Today every game update rebuilds every player's view and reorders /games.
6. **Existing games are never at risk:**
   - Migrations only add things.
   - Facts are worked out from tricks already stored, never stored again.
   - View fields are only ever added, because tabs open for days run old code.
   - Take a Fly volume snapshot before each migration.
   - New host options reach running games through their defaults, so choose defaults on purpose.
7. **The table only learns from face-up cards.** Anything shown to the table, and every table-wide moment, comes from cards played face-up. The crib winner's view counts the crib's points (`queenTakenBy`, `jackTakenBy`, `pointsTaken`), so those fields must never trigger a moment.
8. **Phones are the main platform.** Check every change at 375px wide, with 4 and 5 players, 32-character names, portrait and landscape. Check it on a real iPhone before merging anything that affects phones (see [Rollout](#rollout)).
9. **Try it on the dev site first, and release between play sessions.** Every release to `main` restarts the real site's one machine.

## Bugs found

- **Android turn alerts never fire.** `new Notification()` is rejected by Android Chrome ([Game.svelte:179](src/components/game/Game.svelte:179)). The fix is a service worker with `showNotification`.
- **The winning card covers things.** It gets z-index 5 ([Table.svelte:539](src/components/game/Table.svelte:539)), which paints over the "takes it" pill *and* the seat plaques. `.trick { isolation: isolate }` fixes both.
- **Nobody sees the final trick.** The hand result opens the instant the last card lands ([Game.svelte:156](src/components/game/Game.svelte:156)), and the final results replace the table, so the final trick and any Sun or Moon never show on the felt.
- **5 players on a phone, worked out from the CSS:**
  - The tricks-left counter is covered by the top-left plaque.
  - The left trick card's rank sits under a long-name plaque ([Table.svelte:522](src/components/game/Table.svelte:522)).
- **Reduced motion is half on.** It only shortens durations ([global.css:731](src/styles/global.css:731)), so infinite loops flicker and Svelte transitions ignore it.
- **iPhones zoom into text boxes** under 16px ([global.css:410](src/styles/global.css:410), [games/index.astro:129](src/pages/games/index.astro:129)). No button or card sets `touch-action: manipulation`, so the tap-tap card confirm can count as a double-tap zoom. These are the likeliest causes of the zoom-on-rotation. Font inflation is already turned off ([global.css:118](src/styles/global.css:118)). Confirm on an iPhone.
- **`viewport-fit=cover` with no safe-area padding** ([Layout.astro:35](src/layouts/Layout.astro:35)).
- **The hand jumps on phones** between the select and confirm taps, because the action bar wraps ([Table.svelte:319](src/components/game/Table.svelte:319)).
- **The playtest panel ships to every player** ([Table.svelte:10](src/components/game/Table.svelte:10)).
- **Google Fonts blocks the first paint** from a second domain ([Layout.astro:39](src/layouts/Layout.astro:39)), and the README claims "no external services".
- **Opening the live stream sends your first update twice** ([events.ts:46](src/pages/api/games/[id]/events.ts)).
- **/stats re-reads every hand of every game on each view.** That cost keeps growing through the season.
- **The alerts button reads backwards** ([Table.svelte:421](src/components/game/Table.svelte:421)).

## Phases

Each phase can ship on its own, between play sessions.

### Phase 1: Guardrails and phone basics

**Status (2026-11-26): live.** It's commit `b103966`, Fly release v9, deployed after volume snapshot `vs_eGg8PO2lb3pFQ8lq4xZK1a0`. Existing family accounts were covered by the terms without a click: `terms_version` = 1, with `terms_accepted_at` left empty.

- **Checked:** 150 tests and the build pass, and budgets are met. A browser check covered sign-up, the terms gate, 5- and 4-player tables with 32-char names at 375×812, 812×375 and 1280×800, the self-hosted fonts, the manifest and the service worker. Console and server logs show no errors.
- **Still needs a real device:**
  - Android turn alerts.
  - Adding to the home screen on an iPhone.
  - The rotation zoom.
  - The new-version pill after a real deploy.

No change to how the game plays. The database gets one migration (v7, terms acceptance).

- **S:** size budgets in CI, plus a test that keeps a 5-player update with 32-char names under 4 KB.
- **S:** the dev latency readout.
- **XS:** load the playtest panel only on playtest tables.
- **XS:** write the ground rules into `CLAUDE.md`.
- **S:** self-host the same fonts, subset and preloaded.
- **S:** a "New version, tap to refresh" pill, driven by a build id in the live stream.
- **S:** a dev seed with 32-char names at 4 and 5 players, a 375px checklist, and a first real-iPhone pass (including the rotation zoom).
- **M:** phone fixes: 16px inputs, `touch-action: manipulation`, safe areas, a fixed-height action bar, and real reduced motion.
- **S:** 5-player phone layout: side trick cards move in, the counter comes out from under the plaque, and trick isolation.
- **S:** home-screen basics: manifest, icons from the existing favicon, an apple-touch-icon, and a service worker with **no** caching, used only for alerts (fixes Android). Also the alerts label.
- **S:** trick cards stack by seat, so the led card no longer gets buried. Pulled forward from Phase 2.
- **S–M:** terms and privacy pages, a required "I agree" checkbox at sign-up, and existing players accept once. Acceptance is recorded in migration v7. The terms are boilerplate about liability and user content: no operator name, address or governing law.

### Phase 2: Read the table, and table moments

**Status (2026-11-26): live.** Released with Get the app and keep playing / rematch as `release-2026-11-26.2` (Fly release v10), after volume snapshot `vs_xxm03p9lvbKtppwP5lDmRz3`.

- **Checked:** 230 tests pass and budgets are met. In the browser:
  - a 5-player hand with 32-char names, with moments, watches and a real Shoot the Sun celebration;
  - the trick review;
  - keep playing and rematch on a playtest.
- **Not checked on real phones yet:** the look of the animations, the inspector on touch, and the install flow on the two Android phones.
- **One design change:** a Sun or Moon shot is announced once, by the full-screen celebration, not also on the felt.

All client code plus facts worked out in the view. No rule changes and no migration.

- **S–M:** hover raises a trick card on desktop. Tapping the trick on a phone opens the inspector strip (play order, names, led card, winner).
- **S:** the finished trick stays on the felt until the next lead, even on a cold open. A "Last trick" button in the felt's bottom-right corner opens the inspector for it.
- **S:** a ring on the led card and a suit dot on the leader's avatar. A glow, with no raise, on the card currently winning.
- **S:** one message slot on the felt with a priority queue (see [Table moments](#table-moments)).
- **S:** public table facts in the view, the same for every seat: who broke hearts, the Sun watch and the Moon watch. A test proves the crib never changes them. The watches are **on by default**, and the host can turn them off.
- **S:** a status cluster in the felt's bottom-left corner: tricks left, a heart that goes solid when broken, and the ☀/☾ watch. It replaces the statusbar chip.
- **M:** the moments themselves (below).
- **S:** a hand-end sequence: the final trick sits on the felt about 1.2s, then any Sun or Moon moment, then the result. Tap to skip. The hand result also shows the final trick.
- **M:** a trick review after each hand, from the hand result and the scoreboard: each trick's cards, who led, who won, and the points.

### Added 2026-11-26 (owner requests)

- **S: Get the app.** A `/app` page with an Install button when the browser offers one, plus step-by-step instructions for iPhone, Android Chrome, Samsung Internet, Firefox and desktop. It's linked from the account menu and footer, with a dismissible nudge on /games on phones, all hidden inside the app. The service worker is registered on every page so browsers treat the site as installable. **Live** in release-2026-11-26.2.
- **M: Finished games: keep playing or rematch** (host only). **Live** in release-2026-11-26.2.
  - **Keep playing** continues the same game: totals carry on, as do hand numbers and the pass rotation. If the game ended on its score limit, the host picks a new limit above the highest total, or none. Anyone a cat was sitting in for gets their seat back, and the cats and the move timer start again.
  - **Rematch** opens a waiting room with the same players, seats and settings, with scores reset. Everyone's end screen links to it, and a second click returns the same rematch. A playtest rematch is dealt straight away.
  - Both go through the game action API (`extend` and `rematch`) and are stored in the existing game state (`rematchId`, and an `extensions` history of each limit change), so no migration is needed. Views gain one field, `rematchId`.
  - Decisions: a rematch goes back to the limit the game first finished with. Keep playing is blocked while a rematch exists; deleting the rematch brings it back. An extended game counts as in progress in lifetime stats until it finishes again. Rematch names add a plain " rematch" (then " rematch 2"), which is easy to type when deleting one.
  - Size: the end-screen choices and the Sun/Moon banner now load with `import()`, and so does the playtest latency timer (ground rule 3). The game page's JS went from 44.3 KB to 44.0 KB.
  - Follow-up (XS): mark where a game was extended on the scoreboard, from `extensions`.

### Follow-up: measure CSS per page

Astro inlines small stylesheets into each page's HTML. That CSS is re-sent with every page load, and `check:budgets` doesn't count it: about 3 KB gzipped on the game page after Phase 2. Switching to `build.inlineStylesheets: 'never'` makes all CSS cacheable files. But then the "all CSS together" budget sums every page's CSS (23.7 KB) instead of what one page loads.

So change `check:budgets` to read each route's `styles` list from the server build (`dist/server/entry.mjs`) and cap the largest page, then switch. **S.** Check every page's styles in the browser after the switch.

### Phase 3: Less waiting

**Status (2026-11-26): live.** Released as `release-2026-11-26.4` (Fly release v12) after volume snapshot `vs_w8Qgp2OXbDKSla6laDYmPo`. Migration v8 (one table, `removed_players`) ran on the real site.

- **Checked:**
  - A six-lens design review, then a five-lens code review with each finding verified by a skeptic.
  - The tests (simulations included), the type check, the build and the budgets: game page JS 46.2 of 55 KB, CSS 11.6 of 14 KB.
  - In the browser: queueing, the stagger, the last trick and auto-finish at 375px and on desktop, and removing a player end to end with a 32-character name.
- **Decisions made while building:**
  - **Queued cards live in server memory,** a map beside the playtest undo history, not in the database. Losing one on a deploy just means it isn't queued. Queueing never touches the version, `updated_at`, the move clock or a cat's pause, so the table can't tell. Your own other tabs get a quiet refresh.
  - **The last trick plays in one go** after the usual trick pause (one save, one update), and the browser slides the cards in 150ms apart.
  - **Auto-finish never cuts in when only the last trick is left;** that trick always plays out visibly and counts. It also requires the J♦ to be played face up even when the J♦ rule is off, so every stored "who took what" fact comes from a face-up card.
  - **Auto-finish turns out to be rare.** "A suit every player has shown they're out of" can never hold in legal play: whoever leads a suit for the last time still had it. So the rule fires only once every heart, the Q♠ and the J♦ have been played. In simulation that's about 1 hand in 6,700 with the bots, and around 1% with looser play. Nearly all the time saved comes from the last trick.
  - **Removing a player** swaps a cat into the seat and never deletes or reseats. Their open streams are told and closed. They can't open the game afterwards: /stats lists it as "Removed", with only their own hands counted. The trick review and the hand result name each hand's own players.
  - **A JSON `settings` action** mirrors the settings form, so a future app can switch the pace options.
- **Not checked yet:** a real iPhone, and Firefox on the dev site. Tabs left open from before the release may raise a false "Your turn" alert at the last trick until they're refreshed.

- **M:** one rule for "seats the server is about to play", so no false "Your turn" alerts, /games badges or move-timer hand-offs.
- **S:** auto-play the final trick after the normal pause. A late tap just succeeds.
- **M–L:** pre-moves:
  - You can queue a card once the lead suit is known: straight away on trick 1, otherwise once the lead card is down.
  - It plays in the same instant your turn arrives, and only you see it.
  - It's stored apart from the game's versioned state, so the rest of the table can't see that you queued something.
  - Tap-tap to queue, tap again to cancel.
  - Cards that arrive together slide in about 150ms apart, so the play order still reads.
- **S:** public-information auto-finish (see [Autocomplete rule](#autocomplete-rule)). The server plays out the rest at once and marks where it took over, so trick counts can leave those tricks out. Each hand record also gains player ids, which protects stats if seats ever change hands.
- **XS:** host options for final-trick auto-play and auto-finish, changeable mid-game. Both are **on by default, including in the current season game**.
- **S–M:** the host can remove a player at any time. In the lobby the seat empties. Mid-game a cat takes the seat for good. Earlier hands stay credited to the removed player through the player ids above.

### Phase 4: Talk and tease

- **S:** a broadcast to seated players only, with rate limits. No database write and no game update.
- **M:** reactions and short taunts in a bubble on the sender's avatar, plus a mute switch per device.
- **M–L:** text chat (migration v9):
  - Messages are kept for **24 hours**, reload on reconnect or page load, and older ones are deleted.
  - On phones it's a bottom sheet with an unread badge, plus a preview bubble on the sender's avatar.
  - 280 characters per message.
- **S:** the host pastes a FaceTime, Meet or Discord link, and players get a "Join call" button.
- **XS:** a Share invite button using the phone's share sheet.

### Phase 5: Personality

- **S:** cat photos. An admin uploads them into the existing photo storage, so they stay out of the public repo, and the three "cats never have photos" checks are lifted.
- **M:** a cartoony SVG set for moments, reactions, empty states and a link-preview image. It ships as one cached file, within budget.
- **M:** poker-style thrown taunts. An item arcs from your avatar to theirs, one in flight per sender, held back during big moments.
- **M:** restaurant mode (see [Restaurant mode](#restaurant-mode)):
  - A per-game host toggle, **switched on for the current season game**.
  - The default look stays the same everywhere else.
  - It moves to per-player themes if those ever exist.

### Phase 6: Open tables, front door, then the app

- **L:** public lobbies (migration v10):
  - A host makes a lobby public, and it appears in an open-tables list.
  - People request a seat. The host accepts or rejects (a rejected person can't ask again) and can kick at any time (built in Phase 3).
  - Includes rate limits and a move timer on by default.
  - Needs the Phase 1 terms.
- **S:** landing page: a simple join / log in / sign up page with lighter copy. It goes with public lobbies, because today's "only the family can sit down" line becomes false. It can come earlier with copy that's true either way.
- **L:** push notifications through Apple's and Google's push services (approved, for later).
- **XL:** a store app (see [Mobile app path](#mobile-app-path)).

## Table moments

Every moment plays on a live change only, never on a page load or reconnect. Each uses CSS keyframes, with a still version for reduced motion.

| Moment | What happens |
|---|---|
| Hearts not broken / broken | The heart in the status cluster is an outline, then turns solid red, or becomes the Q♠ if that broke them. A short warm wash crosses the felt, with "Hearts are broken: Mom's 7♥". |
| Q♠ played | A quick dark ripple from the card. When the trick closes: "Dad eats the Queen · +13". |
| J♦ taken | A gold glint on the card, then "Mom grabs the Jack · −10". |
| Sun watch | From trick 4 (trick 3 with 5 players), if one seat has won every trick: a ☀ glow on their plaque and in the status cluster. When someone else takes a trick: "Sun's down". This is exact: trick winners are public, and the shooter is always the crib winner. |
| Moon watch | If one seat has taken every point card played so far, including at least 7 hearts: ☾ on their plaque. It's a "watch", not a sure thing, because the crib may hold a heart someone else won. In simulated games about half of moon watches were already dead. When it ends: "Moon blocked by Bob". |
| Sun or Moon shot | A full-table sunrise or moonrise sweep before the hand result, in the hand-end sequence. |

- **One message slot, in priority order:** shot, then auto-finished, Q♠ eaten, hearts broken, watch change, J♦, "takes it", and "your lead". Messages merge where they can ("Bob takes it · Q♠ +13") and each shows for at least 1.2s.
- **Room on a phone:** with 5 players at 375px, the only free spots are the felt's bottom corners. The status cluster goes bottom-left, "Last trick" goes bottom-right, and taunts aim at avatars.
- **Layers, bottom to top:** restaurant decor, then moment washes, then trick cards, then plaques, then the message slot, then bubbles and thrown items, then dialogs. Nothing ever covers a card's rank corner.
- **Gameplay effect:** a visible Moon watch makes it easier for the table to stop a shooter (see the questions).

## Autocomplete rule

Check at the end of each trick. End the hand early only when both hold:

1. **No scoring card can still be in a hand, as everyone can see.** Every heart, the Q♠ and the J♦ (if that rule is on) has either been played face-up, or belongs to a suit every player has shown they're out of, so it can only be in the crib.
2. **The Sun can't happen.** Either the Sun rule is off, or two different players have won tricks.

The Moon needs no separate check: once no scoring card can be in a hand, it's settled. Never test the real hands or the crib, because that would tell the table where the crib's points are.

- **How the hand ends:** scoring needs every card played, so the server plays out the rest instantly and marks where it took over. Trick counts and the trick review leave those tricks out.
- **How often:** in 20,000 simulated hands each at 4 and 5 players, this fires in 0.1–5% of hands, depending on how freely hearts get led, and saves about one trick when it does. Auto-playing the final trick saves a trick in every hand, so most of the time saved comes from that.

## Restaurant mode

This is an easter egg for a family that played most of a season waiting for food. It's ranked by fun for the effort:

1. **A diner tabletop** instead of the paper felt: a red-checked tablecloth or laminate with a chrome edge.
2. **Glass rings that build up.** One faint ring per hand played, placed from the game id and hand number so everyone sees the same table. A long season looks well loved.
3. **The check.** The hand result becomes a diner receipt: "Q♠ ...... 13", "J♦ ...... −10", "Hearts ×5 ...... 5", "Crib (side order)", total, "Thanks, come again". The host's "final hand" button reads "Check, please".
4. **Props:** salt and pepper shakers, a napkin dispenser, a sugar caddy, a sweating glass with a straw. On desktop they sit in the corners. On phones they sit faintly under everything, because the free corners are taken.
5. **The scoreboard on a napkin,** with a pen tally.
6. **Order's up.** Now and then, at the end of a hand, a bell and "Order up! Hand 212 is served."
7. **A table tent card** with the table name and join code.
8. **A cat waiter** with a notepad when the game is waiting on you: "Ready to order?"

All of it is opt-in decoration drawn under the game layers. The art stays under 30 KB, loads only when the mode is on, and nothing animates continuously.

## Mobile app path

You want an app that shares accounts, data and games with the site. The server already does every game action through JSON endpoints and a live stream, so an app would talk to the same server. The staged path:

1. **Home-screen web app** (Phase 1): manifest, icons, alerts. No store, no fees.
2. **Push notifications** (Phase 6): "your turn" alerts while the app is closed. Needs Apple's and Google's push services. On iPhone it only works once the site is added to the home screen.
3. **Store app** (Phase 6, XL): a native shell (for example Capacitor) around the same site, with native push, haptics and share.
   - Apple rejects apps that are "just a website" (App Store guideline 4.2), so the native extras matter.
   - Apple's developer program is $99 a year; Google Play is $25 once.
   - A shell that loads the live site keeps sign-in and the same-origin checks working as they do today. A fully bundled app would need token sign-in instead.

**Things to keep doing now so the app doesn't force a rewrite:**

- Keep the rules in the shared engine.
- Give every new feature a JSON endpoint, not just a server-rendered form.
- Only ever add view fields, since old app builds linger like old tabs.
- Plan a token sign-in path when the app starts.

## Terms and privacy

- **Terms:** boilerplate to keep you out of trouble, with no operator name, address or governing law. It covers:
  - the site is provided as-is, with no warranty and a limit on liability;
  - players are responsible for what they post (names, game names, photos, chat), the site doesn't screen it and isn't responsible for it, and offensive content or accounts can be removed;
  - acceptable use, permission to show what people upload, no real-money gambling, a minimum age of 13, and terms that can change.
- **Privacy:** list only what's actually stored: username, display name, password hash, sessions, games and hands, photos, and (until Phase 1 self-hosts them) Google Fonts. Promise no account deletion until it exists.
- **Acceptance:** a required checkbox with the acceptance and terms version recorded is much stronger than a line of text. It's worth it if ads or email ever come.
- This isn't legal advice. If ads, payments or a real user base arrive, talk to a lawyer. A business entity (an LLC), not a terms page, is what actually separates you personally from the site.
- **Before a real public launch** (beyond Phase 6): an email service for verification and resets, report and block tools, and a cookie-consent banner if ads come.

## Won't do

- **Two-corner card faces.**
- **Calling built into the app.** A "Join call" link covers voice.
- **Autocomplete checks that look at hidden hands or the crib.**
- **"Claim the rest", and a mid-hand trick-history setting.** They're replaced by auto-finish and the post-hand review.
- **Illustrated court cards, a revived theme lab, or changing the default look.** Restaurant mode is opt-in only.
- **A service worker that caches pages.** It would keep stale code on phones.

## Rollout

- **Try everything on the dev site first** (dev.shootthesun.com, deployed from the `dev` branch), then release `dev` to `main` between play sessions. Take a Fly volume snapshot of the real site before each migration: v7 (terms acceptance, done), v8 (removed players, Phase 3), v9 (chat) and v10 (public lobbies).
- **The dev site is the https test bed** for service workers, home-screen installs and push on real phones.
- **Real-iPhone loop:** run `npm run dev -- --host`, then open the PC's network address on an iPhone on the same Wi-Fi. Sign-in works over plain http there. Service workers, home-screen installs and push need https, so test those on the dev site (dev.shootthesun.com).
- **The GitHub repo is public.** Cat photos go in the database, not the repo.

## Decisions

Made 2026-11-26.

1. **Season game:** final-trick auto-play and auto-finish switch on in the current game as soon as they ship.
2. **Moon/Sun watch:** on by default. The host can turn it off.
3. **Chat:** messages are kept 24 hours and survive reconnects.
4. **Kicking:** the host can remove a player at any time.
5. **Outside services:** push services and app-store developer accounts are OK, but not needed until much later.
6. **Terms:** boilerplate about liability and user content only, with no name, address or governing law. The 13+ minimum age and the sign-up checkbox stay.
7. **Restaurant mode:** a per-game host toggle for now, switched on for the current main game. It moves to per-player themes if those ever exist.
8. **Fonts:** self-hosted. The Google Fonts files (OFL) now live in `src/assets/fonts/`.

## Code pointers

- **Trick area:** [Table.svelte:209-232](src/components/game/Table.svelte:209) (markup), [490-547](src/components/game/Table.svelte:490) (layout). Drawing order is play order today. The 5-player transforms are at 522-536 and the phone rules at 1068-1147.
- **Last trick:** `lastTrick` is the latest finished trick, or last hand's final trick at the start of a hand ([view.ts:114](src/lib/engine/view.ts:114)). `HandSummary.finalTrick` is sent but [HandResult.svelte](src/components/game/HandResult.svelte) never draws it.
- **Trick review:** `HandRecord.tricks` ([scoring.ts:15](src/lib/engine/scoring.ts:15)) is written to `hands.record` ([games.ts:414](src/lib/server/games.ts:414)).
- **Moments:** `heartsBroken` is set for any point card ([hand.ts:223](src/lib/engine/hand.ts:223)). The crib winner's points and tags include the crib ([view.ts:105-111](src/lib/engine/view.ts:105)), so drive moments from trick cards only. The Sun is "one seat won every trick" ([scoring.ts:44](src/lib/engine/scoring.ts:44)). The Moon needs penalty 26, crib included ([hand.ts:261](src/lib/engine/hand.ts:261)).
- **Server-played seats:** one rule, `serverPlays` in games.ts (the cats, a cat sitting in while someone's still here, and the last trick). `clocked` is the move timer's side of it. `yourTurn` in the view and on /games comes from the same rule. Bot pauses are 900ms and 1700ms (`BOT_DELAYS`). The next hand deals in the same update as the last card (game.ts `gamePlay`).
- **Pre-moves:** `queueSuit` and `followPlays` in hand.ts are shared by the server and the browser. Queued cards live in the `premoves` map in games.ts and fire from `applyResult`, after every play. `saveGame` bumps the version and `updated_at`, which is why queued cards never go through it.
- **Mid-game host options:** `MID_GAME_SETTINGS` in rules.ts. Grow that list for new toggles. `normalizeSettings` fills in defaults with no migration.
- **Auto-finish:** `canAutoFinish` in autofinish.ts, called from `gamePlay`. Records carry `autoFrom`; `tableTricks` and `tableTricksWon` in scoring.ts leave the played-out tricks out.
- **Removed players:** the `removed_players` table (v8), and `occupant()` in stats.ts, which gives each hand's player per seat from `record.players`, falling back to that table for older records.
- **Stats:** seats map to whoever sits there now ([stats.ts:63](src/lib/server/stats.ts:63)). Add player ids to hand records before any mid-game seat change.
- **Live updates:** `publish` rebuilds a view per player ([games.ts:377](src/lib/server/games.ts:377)) and never unsubscribes removed players ([games.ts:390](src/lib/server/games.ts:390)). People asking to join a public table aren't seated, so they need their own channel.
- **Public lobbies:** `joinGame` and `removePlayer` work in the lobby only ([games.ts:233](src/lib/server/games.ts:233), [538](src/lib/server/games.ts:538)). The games list is at [games.ts:735](src/lib/server/games.ts:735). Don't parse state blobs per row for an open-tables list.
- **Cat photos:** blocked at [Avatar.svelte:19](src/components/Avatar.svelte:19), [games.ts:62](src/lib/server/games.ts:62) and [games.ts:132](src/lib/server/games.ts:132).
- **Restaurant mode:** the table is cream paper, not green felt (`--felt-bg`, [global.css:57](src/styles/global.css:57)).
- **Landing page:** signed-in users go straight to /games ([index.astro:6](src/pages/index.astro:6)).
- **Display names:** every new piece of UI that shows a name (bubbles, chat, open tables, the inspector) must cope with 32-character names at 375px.

# Roadmap

Updated 2026-11-26 with the owner's answers, checked against the code. Phases 1 to 3 are live. Phase 4 was planned the same day, after a read of the code it touches, with a [phone pass](#phone-pass-before-phase-4) before it. The phone pass went live on 2026-11-27, so Phase 4 is next. Every open question is answered (see [Decisions](#decisions)). Phase 4 will still ask the owner to OK a CSS budget increase and the starter taunt list.

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
- **Chat:** a simple saved text chat. No calling built into the app. (The "Join call" button has since moved to [Someday](#someday).)
- **Public lobbies:** anyone can ask to join a public table, and the host accepts, rejects or kicks.
- **Restaurant mode, cartoony art, cat photos and thrown taunts** are planned (Phase 5). (Thrown taunts now get their workings in Phase 4 and their art in Phase 5.)
- **A store app** is a long-term goal (Phase 7), built on the same server and accounts.

## What changed when planning Phase 4

Decided 2026-11-26:

- **The "Join call" link is out** of Phase 4 and onto the [Someday](#someday) list.
- **Taunts are emoji only:** emotes on your own avatar and throwables aimed at someone else's, with one 15s cooldown. No preset phrases, because chat covers words. Phase 4 builds how they work; Phase 5 draws them.
- **The cats chatter lightly** in Phase 4. Each cat gets a personality later.
- **Chat belongs to the game:** a removed player loses it, a rematch starts empty, and nobody can delete messages. Mute is per device and hides only the chat previews on avatars.
- **A phone pass comes first.** A player on Android Chrome had to scroll off the table to play in landscape.
- **Phase 4 ships in two releases:** 4a, taunts (no migration), then 4b, chat (migration v9). Measuring CSS per page comes first.
- **New work:**
  - personal themes, with presets and a theme builder (Phase 5);
  - email sign-in, replacing usernames (Phase 6);
  - a new last phase for more card games, starting with Euchre (Phase 8).
- **Push and the store app move to Phase 7.**
- **New sections:** [Thinking ahead](#thinking-ahead), for public players and paying for the site, and [Someday](#someday).

## Ground rules

These are the "build it fast from the start" rules. They answer the performance question, and they belong in a `CLAUDE.md` so every future session follows them (Phase 1).

1. **Your own actions show instantly.** Anything you do (play, pass, queue a card) appears on screen in the same frame, and the server's update confirms it a moment later. A dev-only readout in the playtest panel shows tap-to-screen and tap-to-server times.
2. **Budgets, checked in CI** (`npm run check:budgets` and `view-size.test.ts`):
   - Game page JS: at most 55 KB gzipped (39.5 KB after Phase 1, 44.3 KB after Phase 2; raised from 45 KB with the owner's OK).
   - Any other JS file: at most 15 KB, and aim for 10.
   - All CSS together: at most 14 KB. It was 10.2 KB after Phase 1; the owner OK'd raising the cap from 11 KB for the Phase 2 visuals.
   - One player's live update: at most 4 KB (2.5–2.8 KB with 32-char names).
   A deploy that goes over fails. Raise a budget only with the owner's OK.
3. **Load only what's needed.** The playtest panel loads only on playtest tables. Restaurant art should load only when the mode is on, and taunt art only when the first taunt arrives.
4. **Animation:** CSS keyframes on `transform` and `opacity` only. No animated shadows or filters, nothing that loops forever, one shared overlay layer, and reduced motion fully respected (Svelte transitions go through src/lib/motion.ts so they respect it).
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
- **Fixed (2026-11-27): landscape phones.** At 667×375, a long-name "takes it" message overlapped the status cluster. The sideways layout keeps the message clear of the cluster and "Last trick" at the eight phone sizes, and `/dev/phones` now checks for it. On a sideways screen narrower than those (540–640px) it can still touch the cluster in a rare case: two digits of tricks left, a watch on a long name, and hearts broken by the Q♠. Measured in the browser, not yet on a phone.
- **Fixed (2026-11-27): the hand is off screen on a phone turned sideways.** A player on Android Chrome could see the table but had to scroll off it to pick a card. A sideways phone is wider than 640px, so it got the desktop layout. That layout needs at least 340px of height for the table alone, which pushed the hand below the bottom of the screen. The [phone pass](#phone-pass-before-phase-4) gives sideways phones a layout of their own.
- **Fixed (2026-11-27): upright, your own seat's tags touched the button.** "Choosing" (and any tag of yours) hung 3px into the Pass or Play button at every phone size. `/dev/phones` found it; the hand now sits a few pixels lower.

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
- **XS: The last trick plays at a readable pace.** All of its cards used to arrive in one update, 150ms apart, along with the next deal and the new totals, so it was over before anyone could see who played what. Now the server plays it one card at a time at the cats' pace: the usual 1.7s trick pause, then 0.9s before each card after the first (`BOT_DELAYS`). It looks like any other trick, and only the last card brings the next deal. That adds about 2.3s a hand with four players and 3s with five. On your turn, a tap on your own card still plays it at once. It's all on the server, so tabs running old code get it too. One side effect: a tab still running code from before Phase 3 (release .4) works out "Your turn" from `toAct`, so it now flashes "Your turn" for each person in the last trick, not just the leader, until it's refreshed. **Live** in `release-2026-11-26.6` (Fly release v14), released mid-game at the owner's request; no migration, so no snapshot. Not checked yet on a real iPhone or in Firefox.

### Follow-up: measure CSS per page

Astro inlines small stylesheets into each page's HTML. That CSS is re-sent with every page load, and `check:budgets` doesn't count it: about 3 KB gzipped on the game page after Phase 2. Switching to `build.inlineStylesheets: 'never'` makes all CSS cacheable files. But then the "all CSS together" budget sums every page's CSS (23.7 KB) instead of what one page loads.

So change `check:budgets` to read each route's `styles` list from the server build (`dist/server/entry.mjs`) and cap the largest page, then switch. **S.** Check every page's styles in the browser after the switch. Scheduled as the first step of Phase 4.

### Phase 3: Less waiting

**Status (2026-11-26): live.** Released as `release-2026-11-26.4` (Fly release v12) after volume snapshot `vs_w8Qgp2OXbDKSla6laDYmPo`. Migration v8 (one table, `removed_players`) ran on the real site.

- **Checked:**
  - A six-lens design review, then a five-lens code review with each finding verified by a skeptic.
  - The tests (simulations included), the type check, the build and the budgets: game page JS 46.2 of 55 KB, CSS 11.6 of 14 KB.
  - In the browser: queueing, the stagger, the last trick and auto-finish at 375px and on desktop, and removing a player end to end with a 32-character name.
- **Decisions made while building:**
  - **Queued cards live in server memory,** a map beside the playtest undo history, not in the database. Losing one on a deploy just means it isn't queued. Queueing never touches the version, `updated_at`, the move clock or a cat's pause, so the table can't tell. Your own other tabs get a quiet refresh.
  - **The last trick plays in one go** after the usual trick pause (one save, one update), and the browser slides the cards in 150ms apart. *Changed since: it now plays one card at a time (see [Added 2026-11-26](#added-2026-11-26-owner-requests)).*
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

### Since Phase 3: watch glows and a type check

**Status (2026-11-26): live.** Released as `release-2026-11-26.5` (Fly release v13). There was no migration, so no snapshot.

- **Sun and Moon watches glow** behind the watcher's avatar from the first trick or heart, in three steps, with no pop-ups (see [Table moments](#table-moments)). New public facts `sunRun` and `moonRun` drive them. `sunWatch` and `moonWatch` keep their meaning for tabs running old code.
- **The hearts-broken icon** in the status cluster is bigger.
- **Phones lay out at their own width on first paint.** Card and avatar sizes come from container queries, not measured widths.
- **CI type-checks** every .astro, .ts and .svelte file (`npm run check`), and Svelte warnings fail it too. It was added after a stale call in a .svelte file reached the dev site: the build and the tests don't check types, and astro check never looks inside .svelte files. It reached `main` in `release-2026-11-26.6`, along with plain-text suns on iPhones.
- **Not checked yet:** a real iPhone, and the owner's Firefox.

### Phone pass (before Phase 4)

The family nearly always plays on phones, and a player on Android Chrome had to scroll off the table to play in landscape. This comes before Phase 4 because Phase 4 adds bubbles, a taunt tray and a chat sheet to the same small screen, so the layout should settle first. No migration.

**Status (2026-11-27): live.** Released as `release-2026-11-27.1` (Fly release v15), after the real site's games had been quiet for 20 minutes. No migration, so no snapshot. Checked in the browser at every size, but not yet on a real phone.

- **Sideways phones get their own layout:** `(orientation: landscape) and (max-height: 500px) and (min-width: 540px)`, in Table, WatchGlow, Game and Layout.
  - The table fills the screen. Three designs were prototyped and judged; this one won on playability and robustness.
  - The page opens scrolled past the site header to the table. On a sideways phone the header scrolls away instead of staying pinned (the owner's choice, 2026-11-27), so the menu is a scroll up. Turning the phone upright scrolls back to the top.
  - Your cards run along the bottom edge, showing only their tops: the rank corners and a picked card always show. Your plaque sits bottom-left, and the hint and button sit in a dark box bottom-right.
  - The name and chips sit in the table's top corners on dark ground. The Playtest chip is hidden there (the panel under the table says so).
  - It costs 0.6 KB of CSS (12.9 of 14 KB) and a few lines of script. Upright phones and ordinary desktop windows are unchanged, apart from the 3px fix in [Bugs found](#bugs-found). Any window at least 540px wide and at most 500px tall (say, a quarter-screen window, or a laptop zoomed right in) gets the sideways layout too, which fits it better than the old one did.
- **Polish after the owner tried it on their phone (2026-11-27), on the dev site, not released yet:** the table ran into the screen's edges, and the cards cut off at the bottom made it look as if there was more to scroll to.
  - A little room above and below the table (8–16px, less on the shortest screens), and the felt's bottom edge now shows, with your cards tucked into it.
  - The page centres the table when it opens or the phone turns, and again 400ms later once a turning phone has settled. The old scroll passed `behavior: 'instant'`, which some phone browsers reject outright, so it may never have scrolled at all.
  - Sideways, the "Hand N" chip makes way so the chips take at most two rows.
  - Pages beside the table (/games, the waiting room, final results and the rest) had no side margin on screens wider than 640px, every sideways phone included: `.page` wiped the container's gutter. They get the gutter now. Desktop widths are unchanged.
  - Checked in headless Edge with iPhone notch and home-bar insets: all four phones, upright and sideways, in a browser and as an app, with 4 and 5 players.
- **`/dev/phones`** shows one of your games at all eight sizes, as a browser leaves them (estimates) or as an installed app (`&fit=app`). It checks each for a page wider than the screen, pieces on top of each other, covered rank corners and, sideways, anything off the screen. **Check every size** runs all eight. `/dev/long-names?then=phones` starts a table there. The dev server and the dev site allow same-site frames for it; the real site still refuses all frames.
- **`/dev/checklist`** is the family's five-minute check, on the dev site: upright, sideways, alerts and the app. It ends with a box that says what the phone told the site, for screenshots.
- **The phone sizes** are in CLAUDE.md's phone rule and the README.
- **Not checked on a real phone yet**, so the checklist is how to catch these:
  - the sideways layout in real Android Chrome and iPhone Safari: their toolbars, the home-bar and notch insets, and whether opening scrolled to the table sticks;
  - turning the phone mid-game;
  - everything in the backlog below.

- **S–M: a landscape layout for short screens.** A sideways phone (roughly 667–932 wide and 360–430 tall) is wider than 640px, so today it misses the phone rules. It gets the single-column layout, but keeps the desktop table and seat placement. The table alone needs 340px of height, so the hand ends up below the bottom of the screen.
  - Give short landscape screens their own layout, for example `(orientation: landscape) and (max-height: 500px)`.
  - Put the hand beside the table or over the bottom of the felt, with the action bar in reach, so you can see the trick and play without scrolling.
  - It should also fix the open overlap between a long-name "takes it" message and the status cluster at 667×375 (see [Bugs found](#bugs-found)).
- **S: clear the real-phone backlog.** These have only been checked in emulation so far:
  - the zoom after rotating, and the first-load layout;
  - Android turn alerts, and the Android install flow;
  - adding to the home screen, and Get the app, on an iPhone;
  - the new-version pill after a real deploy;
  - the animations, and the inspector on touch;
  - queueing a card (tap-tap, cancel) and the stagger, on touch;
  - the last trick's pace, and the watch glows;
  - uploading a profile photo in iPhone Safari.
- **S: a fixed set of phone sizes**, written into CLAUDE.md's phone rule and the README, and checked before every release that touches phones. Each size in portrait and landscape, with 4 and 5 players and 32-character names:
  - a small Android, 360×780;
  - an iPhone SE, 375×667;
  - a standard iPhone, 393×852;
  - a large phone, 430×932.

  A 32-character name must still fit from 375px up. At 360px nothing may overflow or overlap, but long names may be cut short with an ellipsis.
- **XS: a five-minute checklist for the family** to run on their own phones on the dev site, because real phones catch what emulation misses.
- **Later: the Android emulator.** The emulator that comes with Android Studio is free, runs on the owner's PC and has real Chrome for Android in it, so the sideways layout can be checked in the browser where the bug was reported. The owner wants it set up, but not as part of the phone pass (2026-11-27). It's a multi-gigabyte download, and the owner accepts Google's SDK licence during setup. Also on the [Someday](#someday) list so it isn't lost.

### Phase 4: Talk and tease

Planned 2026-11-26 after a read of the code it touches (see [Phase 4 code pointers](#phase-4-code-pointers)). It comes after the [phone pass](#phone-pass-before-phase-4) and ships in two releases.

**First step, after the phone pass and before 4a: [measure CSS per page](#follow-up-measure-css-per-page).**
- The budget check reports 13.0 of 14 KB of CSS (the phone pass took 0.7 KB), but that adds up every page's CSS files. The game page loads 10.7 KB of those files, plus about 3 KB gzipped of inline CSS that the check never counts, so it really loads about 13.7 KB.
- Bubbles, throws, the taunt tray and the chat sheet won't fit in what's left. Measure per page first, then tell the owner the exact increase needed.
- Game page JS is 48.2 of 55 KB. That's enough, as long as the chat sheet loads with `import()`.

**Release 4a: taunts (no migration)**

- **S: a broadcast to seated players only.** A new helper in games.ts beside `publishTo`, which already looks up the players and then calls the hub's `sendTo`. hub.ts knows nothing about seats.
  - It looks up who is seated each time it sends, because a removed player's stream stays open until `publish()` hangs it up.
  - It uses a new named live-stream event, which tabs running old code ignore.
  - No database write, no version bump, and never through `publish()`.
- **M: taunts.** Emoji only; words belong in chat.
  - **Emotes** pop up in a bubble on the sender's avatar.
  - **Throwables** are aimed at another player: tap your own avatar to open the tray, then tap theirs. The item arcs from avatar to avatar using one CSS keyframe on `transform` and `opacity`.
  - **A fixed starter list** of about 8 emotes and 4 throwables, for the owner to veto. The server sends an id from the list, never the emoji itself, so Phase 5's art can replace the emoji without changing anything else. Characters with two forms (such as ❤) get a variation selector, so every phone draws them in colour.
  - **One 15s cooldown per player** covers emotes and throws together. The server enforces it in memory, so it resets on a restart, which is fine. The button shows how long is left.
  - **Taunts can't be muted.**
  - **Layers:** bubbles and thrown items get one new layer above the message slot and below dialogs. That means renumbering the arena's z-indexes, since nothing fits between the message slot (4) and the inspector (5). Throws wait until big moments are over.
- **S–M: the cats chatter, lightly.** Now and then a cat sends an emote or a throw, under the same 15s cooldown, with at most one cat reacting to any moment.
  - **Triggers come only from face-up events:** a trick won, the Q♠ or J♦ taken in a trick, hearts broken, a Sun or Moon shot, or being hit by a throw.
  - **Never from hidden cards:** not the cat's own hand, its pass, the crib, its legal plays or a queued card, or the table could read hidden cards from the reaction (ground rule 7).
  - Reactions to the end of a hand wait until everyone's screen has shown the result.
  - **Only real cats react.** A cat sitting in for an absent player doesn't, and neither does the server playing out the last trick.
  - **Testable:** the chance comes from a random source passed in, so tests stay predictable.
  - **Wiring:** reactions fire after the change is saved, from the two places that play cards: `performAction` and `runBots` (queued cards fire inside both, through `applyResult`). They use their own timers, never `botTimers`.
  - Personalities come later (Phase 5).
- **XS: Share invite** in the waiting room. It opens the phone's share sheet with the join link.

**Release 4b: chat (migration v9; take a volume snapshot first)**

- **M–L: text chat.**
  - **It belongs to one game.** It carries on through Keep playing, and a rematch starts empty.
  - It's open in the waiting room, during play and after the game ends.
  - **Plain text:** one line, emoji allowed, up to 280 characters, counted and cleaned the way display names are. Links aren't clickable and nothing is drawn as HTML, because the site has no Content-Security-Policy to fall back on.
  - **Kept 24 hours.** Older messages are deleted whenever a new one is written, and left out when history is read. There's no background job.
  - **Its own JSON endpoints:** `GET` for history and `POST` to send. History is fetched on page load, on every reconnect and when the tab comes back, because the live stream doesn't replay anything a tab missed. New messages go out through the seated-only broadcast.
  - **A mild spam limit:** about 5 messages in 10 seconds, not the 15s taunt cooldown.
  - **Only seated players** can read or send.
    - A removed player loses access straight away, and their earlier messages stay, under their name.
    - Anyone who comes back sees the last 24 hours: after a reload, after "I'm back", or after leaving a waiting room and joining again.
    - A player removed from a waiting room can still join again with the link, as today, and then sees the last 24 hours like anyone else who comes back.
  - **Nobody deletes messages by hand:** not the sender, the host or an admin. Messages go only when they're 24 hours old or the game is deleted.
  - Its table references `games(id) ON DELETE CASCADE`, so deleting a game deletes its chat.
- **S: a chat button with an unread count** in the bar above the table, on every screen size.
  - On phones it opens a bottom sheet. On desktop the same sheet opens as a panel beside the table.
  - The sheet is drawn from Game.svelte, outside the arena, so chat lasts through the waiting room, the table and the end screen.
  - New messages also show as a short preview bubble on the sender's avatar.
  - The unread count is kept per device. Chat never sends notifications.
- **XS: mute, per device,** in the chat sheet, so it can be reached in the waiting room, at the table and on the end screen. It's also in the panel below the hand, beside the deck and alerts switches. It hides only the chat previews on avatars. The unread count stays, and the sheet still shows everything.
- **XS: the end of a hand doesn't interrupt typing.**
  - Today the hand-end sequence swallows every tap, plus the Escape, Enter and Space keys, so a space or Enter typed in chat would be lost.
  - The hand result takes focus when it opens, and closes on any Escape pressed anywhere.
  - While the chat sheet is open, the result waits until it's closed.
- **XS: the privacy page** gets a line about chat, kept 24 hours. The terms already cover chat, so the terms version stays the same and nobody is asked to accept again. The terms' line about removing offensive content is a right the site keeps; Phase 4 builds no tool for it.

### Phase 5: Personality

- **S:** cat photos. An admin uploads them into the existing photo storage, so they stay out of the public repo, and the three "cats never have photos" checks are lifted.
- **M:** a cartoony SVG set for moments, empty states and a link-preview image. It ships as one cached file, within budget, and loads only when needed.
- **M: taunts, drawn.** The Phase 4 emotes and throwables swap their emoji for cartoony art from that set, and the throws get a fuller, poker-style flight. How they work (the list, the cooldown, waiting out big moments) stays as Phase 4 built it.
- **M: cat personalities.** Each cat gets its own taunts and its own chattiness, building on Phase 4's light chatter. Key them by username (`bot-1` to `bot-7`), not display name. Goes well with the photos.
- **M–L: themes.** A personal choice that changes only what you see, saved to your account so it follows you between devices.
  - Presets, including restaurant mode, plus a theme builder with colour pickers for the table, the cards, each suit and the other parts of the page.
  - The builder checks contrast, so the suits stay readable.
  - The server draws the page in your theme, as it does for the 4-colour deck, so pages never flash the default look first.
  - The default look stays Color Block.
  - A head start: the October theme lab had six looks and a picker. Commit `c1f3a90` removed it.
    - Its deleted files (src/lib/themes.ts, src/pages/themes.astro, src/styles/themes.css) can be restored from `c1f3a90~1`.
    - Reverting the whole commit now conflicts with later work in PlayingCard.svelte, Table.svelte, Layout.astro and global.css, so treat the lab as reference, not a revert.
    - The theme-lab branch it mentions no longer exists.
  - Saving it to the account needs a migration. The builder is its own page, so it adds nothing to the game page.
- **M:** restaurant mode (see [Restaurant mode](#restaurant-mode)):
  - A per-game host switch, **on for the current season game**, that overrides everyone's theme at that table.
  - It's also a preset anyone can pick for themselves.
  - The default look stays the same everywhere else.

### Phase 6: Accounts and open tables

This is everything a stranger needs before they can sit down.

- **M–L: sign in with email** (a migration). Email replaces usernames for signing in.
  - New accounts sign up with an email and verify it. Anyone can reset their own password by email.
  - Family accounts sign in once more with their username, add an email, and use the email from then on. Usernames stay stored, but stop being a way to sign in. Admin reset links stay as a backup.
  - It needs an email-sending service. That's an outside service, so it needs the owner's OK (usually free at this volume). The privacy page changes to match.
  - Plan the store app's token sign-in at the same time.
- **S–M, maybe: Google sign-in,** after email works. It's mostly useful for public players. If the store app offers Google sign-in, Apple's rules generally require an Apple-approved privacy-friendly option as well (Sign in with Apple qualifies). So decide on Google when the app is closer.
- **M: chat moderation before public tables.** Phase 4 has no deleting, which is fine for the family. Strangers sharing a table need at least report, block and a host mute.
- **L:** public lobbies (a migration):
  - A host makes a lobby public, and it appears in an open-tables list.
  - People request a seat. The host accepts or rejects (a rejected person can't ask again) and can kick at any time (built in Phase 3).
  - Includes rate limits and a move timer on by default.
  - Needs the Phase 1 terms, email sign-in and chat moderation.
- **S:** landing page: a simple join / log in / sign up page with lighter copy. It goes with public lobbies, because today's "only the family can sit down" line becomes false. It can come earlier with copy that's true either way.

### Phase 7: Push and the store app

- **L:** push notifications through Apple's and Google's push services (approved, for later).
- **XL:** a store app (see [Mobile app path](#mobile-app-path)).

### Phase 8: More card games

The family also plays Euchre, so one day the site should host more than Hearts. This phase is last on purpose. Euchre has partners, trump, bidding and a 24-card deck, so it's a project of its own (**L–XL**): its own engine, views, cats, stats and season game.

Until then, keep the door open:

- Game rules stay in the engine. Nothing outside it should assume Hearts unless it has to.
- Features that aren't about the cards (chat, taunts, accounts, themes, lobbies) key on the game and the player, never on seats, suits or Hearts terms.
- When the second game arrives, add a game-type column to `games` that defaults to Hearts. It's an added column, so old games are untouched.

## Table moments

Every moment plays on a live change only, never on a page load or reconnect. Each uses CSS keyframes, with a still version for reduced motion.

| Moment | What happens |
|---|---|
| Hearts not broken / broken | The heart in the status cluster is an outline, then turns solid red, or becomes the Q♠ if that broke them. A short warm wash crosses the felt, with "Hearts are broken: Mom's 7♥". |
| Q♠ played | A quick dark ripple from the card. When the trick closes: "Dad eats the Queen · +13". |
| J♦ taken | A gold glint on the card, then "Mom grabs the Jack · −10". |
| Sun watch | Sun rays behind the avatar of the seat that has won every trick so far, from the first trick. Three steps: faint from trick 1, clear from 3 in a row, blazing from two thirds of the hand (8 of 12, 6 of 9). From the clear step the status cluster names them. When someone else takes a trick the sun sinks and goes out. No message. This is exact: trick winners are public, and the shooter is always the crib winner. |
| Moon watch | A pale halo behind the avatar of the seat that has taken every point card played so far, once that includes a heart. Three steps: faint from the first heart, clear from 5, full with the Q♠ and 7 hearts (or 10). It's a "watch", not a sure thing, because the crib may hold a heart someone else won. When it's blocked the halo greys and goes out. No message. |
| Sun or Moon shot | A full-table sunrise or moonrise sweep before the hand result, in the hand-end sequence. |

- **One message slot, in priority order:** shot, then auto-finished, Q♠ eaten, hearts broken, J♦, "takes it", and "your lead". Messages merge where they can ("Bob takes it · Q♠ +13") and each shows for at least 1.2s.
- **Room on a phone:** with 5 players at 375px, the only free spots are the felt's bottom corners. The status cluster goes bottom-left, "Last trick" goes bottom-right, and taunts aim at avatars.
- **Layers, bottom to top:** restaurant decor, then moment washes, then trick cards, then plaques, then the message slot, then bubbles and thrown items, then dialogs. Nothing ever covers a card's rank corner.
- **Gameplay effect:** a visible Moon watch makes it easier for the table to stop a shooter. The watches are on by default, and the host can turn them off (see [Decisions](#decisions), 2).

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

It's switched on two ways (Phase 5):

- **The host switch** overrides everyone's theme at that table, so everyone there sees the same diner. It's on for the season game.
- **The personal preset** in the theme picker brings the same decor everywhere you play (the tabletop, rings, the check, the props), seen only by you.

## Mobile app path

You want an app that shares accounts, data and games with the site. The server already does every game action through JSON endpoints and a live stream, so an app would talk to the same server. The staged path:

1. **Home-screen web app** (Phase 1): manifest, icons, alerts. No store, no fees.
2. **Push notifications** (Phase 7): "your turn" alerts while the app is closed. Needs Apple's and Google's push services. On iPhone it only works once the site is added to the home screen.
3. **Store app** (Phase 7, XL): a native shell (for example Capacitor) around the same site, with native push, haptics and share.
   - Apple rejects apps that are "just a website" (App Store guideline 4.2), so the native extras matter.
   - Apple's developer program is $99 a year; Google Play is $25 once.
   - A shell that loads the live site keeps sign-in and the same-origin checks working as they do today. A fully bundled app would need token sign-in instead.
   - If the app offers Google sign-in, Apple generally requires a privacy-friendly option too, such as Sign in with Apple (see Phase 6).

**Things to keep doing now so the app doesn't force a rewrite:**

- Keep the rules in the shared engine.
- Give every new feature a JSON endpoint, not just a server-rendered form.
- Only ever add view fields, since old app builds linger like old tabs.
- Plan a token sign-in path along with email sign-in (Phase 6).

## Terms and privacy

- **Terms:** boilerplate to keep you out of trouble, with no operator name, address or governing law. It covers:
  - the site is provided as-is, with no warranty and a limit on liability;
  - players are responsible for what they post (names, game names, photos, chat), the site doesn't screen it and isn't responsible for it, and offensive content or accounts can be removed;
  - acceptable use, permission to show what people upload, no real-money gambling, a minimum age of 13, and terms that can change.
- **Privacy:** list only what's actually stored: username, display name, password hash, sessions, games and hands, and photos. (Google Fonts left the list when Phase 1 self-hosted the fonts.) Promise no account deletion until it exists.
- **Acceptance:** a required checkbox with the acceptance and terms version recorded is much stronger than a line of text. It's worth it if ads or email ever come.
- This isn't legal advice. If ads, payments or a real user base arrive, talk to a lawyer. A business entity (an LLC), not a terms page, is what actually separates you personally from the site.
- **What each phase adds to the privacy page:** Phase 4 adds chat (kept 24 hours), Phase 5 adds saved themes, and Phase 6 adds email addresses.
- **Before a real public launch:** email sign-in and chat moderation (both Phase 6), and a cookie-consent banner if ads come (see [Thinking ahead](#thinking-ahead)).

## Thinking ahead

The long-term goal is a site that public players use, that pays for itself (through ads or something like them), and that hosts more than one card game. None of that is a task yet, but early decisions should leave room for it:

- **Ads never go on the live table.** If they come, they go on pages like /games, stats or the end screen, and load after the page, so play stays fast and the game page budgets hold. Ads also bring an ad network (an outside service), a cookie-consent banner and a privacy rewrite.
- **If the site ever needs to pay for itself, a "support the site" link is worth trying before ads.** It runs on one small Fly machine, so tips might cover it with far less work.
- **Public players need email sign-in and chat moderation first** (Phase 6).
- **Keep features that aren't about the cards game-agnostic** (see [Phase 8](#phase-8-more-card-games)).
- **Keep giving every feature a JSON endpoint, and only ever add view fields,** so the store app (Phase 7) can use the same server.
- **Store only what a feature needs,** and list it on the privacy page.
- **One machine is fine for a long time.** One Node process and one SQLite file can serve far more players than the family. The in-process live hub ties the site to one machine, and each deploy restarts games in play. Revisit that only if public play grows.
- **The legal side:** if ads, payments or a real user base arrive, talk to a lawyer and consider an LLC (see [Terms and privacy](#terms-and-privacy)).

## Someday

Ideas worth keeping that aren't planned:

- **A "Join call" button.** The host pastes a FaceTime, Meet or Discord link, and players get a button. Dropped from Phase 4 on 2026-11-26. Calling built into the app stays on [Won't do](#wont-do).
- **Set up the Android emulator** (Android Studio, on the owner's PC) to test real Chrome for Android, starting with the sideways layout. The owner said yes, later (2026-11-27). See the [phone pass](#phone-pass-before-phase-4).

## Won't do

- **Two-corner card faces.**
- **Calling built into the app.** A "Join call" link is on the [Someday](#someday) list instead.
- **Autocomplete checks that look at hidden hands or the crib.**
- **"Claim the rest", and a mid-hand trick-history setting.** They're replaced by auto-finish and the post-hand review.
- **Illustrated court cards, or changing the default look.** Color Block stays the default. Themes (Phase 5) and restaurant mode are opt-in. (A theme picker used to be on this list. The owner asked for themes on 2026-11-26.)
- **A service worker that caches pages.** It would keep stale code on phones.

## Rollout

- **Try everything on the dev site first** (dev.shootthesun.com, deployed from the `dev` branch), then release `dev` to `main` between play sessions. Take a Fly volume snapshot of the real site before each migration: v7 (terms acceptance, done), v8 (removed players, done), v9 (chat, Phase 4b), then later ones for themes, email sign-in and public lobbies.
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
7. **Restaurant mode:** a per-game host toggle for now, switched on for the current main game. Decision 17 replaces "it moves to per-player themes if those ever exist": it stays a host switch and also becomes a theme preset.
8. **Fonts:** self-hosted. The Google Fonts files (OFL) now live in `src/assets/fonts/`.

Made while planning Phase 4, 2026-11-26:

9. **Join call link:** out of Phase 4, onto the [Someday](#someday) list.
10. **Taunts:** emoji emotes and emoji throwables only, no preset phrases. Phase 4 builds how they work, and Phase 5 draws them.
11. **Cooldowns:** one 15s cooldown per player for taunts, shared by emotes and throws. Chat gets only a mild spam limit.
12. **Cats:** light chatter in Phase 4. Each cat gets a personality later.
13. **Mute:** per device, and for chat only. It hides the chat previews on avatars and keeps the unread count.
14. **Chat belongs to the game:**
    - A removed player loses access.
    - Anyone who comes back sees the last 24 hours.
    - A rematch starts empty.
    - Nobody can delete a message by hand.
15. **Phone pass first:** before Phase 4, to fix landscape phones and set up a repeatable phone check.
16. **Email replaces usernames** for signing in (Phase 6). Google sign-in maybe, later.
17. **Themes are personal:** presets plus a theme builder (Phase 5). Restaurant mode is both a table-wide host switch and a preset.
18. **The long view:** more card games (Euchre first) come last. Public players and paying for the site guide decisions now, but aren't tasks yet (see [Thinking ahead](#thinking-ahead)).
19. **Phase 4 ships in two releases:** measuring CSS per page comes first, then 4a (taunts, no migration), then 4b (chat, migration v9, with a volume snapshot of the real site first).

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
- **Live updates:** `publish` in games.ts rebuilds a view per player. Since Phase 3 it also sends `removed` to anyone no longer seated and closes their stream. Every stream that opens or closes also runs `publish()`, to update the online dots. People asking to join a public table aren't seated, so they need their own channel.
- **Public lobbies:** `joinGame` and `removePlayer` work in the lobby only ([games.ts:233](src/lib/server/games.ts:233), [538](src/lib/server/games.ts:538)). The games list is at [games.ts:735](src/lib/server/games.ts:735). Don't parse state blobs per row for an open-tables list.
- **Cat photos:** blocked at [Avatar.svelte:19](src/components/Avatar.svelte:19), [games.ts:62](src/lib/server/games.ts:62) and [games.ts:132](src/lib/server/games.ts:132).
- **Restaurant mode:** the table is cream paper, not green felt (`--felt-bg`, [global.css:57](src/styles/global.css:57)).
- **Landing page:** signed-in users go straight to /games ([index.astro:6](src/pages/index.astro:6)).
- **Display names:** every new piece of UI that shows a name (bubbles, chat, open tables, the inspector) must cope with 32-character names at 375px.

### Phase 4 code pointers

From a read of the code on 2026-11-26. Function names are given rather than line numbers, because those move.

- **Hub:** hub.ts has `subscribe`, `subscribers`, `sendTo` and `onlineUsers`, but nothing that sends to everyone. A subscriber holds only a user id. events.ts checks membership only when a stream opens.
- **Live-stream events:** `state`, `build`, `removed` and `deleted`.
  - They carry no `id:` lines, so nothing is replayed after a drop.
  - Game.svelte listens by event name, so tabs running old code ignore new names. Don't name one `message` (the default type), `open` or `error` (Game.svelte already listens for the stream's own open and error events).
- **Who may see a game:** only seated players, through `isMember`. There are no spectators. Once a game has started, `joinGame` refuses everyone, so a player removed mid-game can never come back to that game.
- **Where cats could react:**
  - **Hooks:** after `publish()` in `performAction` and in `runBots`, both in games.ts.
  - **Detecting moments:** the browser does it today (`detectMoments` in src/lib/moments.ts, from `publicFacts` in view.ts). The server would compare a face-up snapshot from before and after the change.
  - **Hand ends:** `gamePlay` drops `trickComplete` and deals the next hand in the same call. Queued cards can also end a hand inside `applyResult`, and `botTurn` returns only a boolean. So compare `state.lastHand?.number` before and after the change, never `state.hand`, and don't rely on the first play's `result.completedHand`.
  - **Randomness:** there's no `Math.random` in src; deals use `secureRng`.
- **Rate limits:** `takeAttempt` in auth.ts has a fixed 15-minute window. The taunt cooldown and the chat limit need a small new helper, kept on `globalThis` like the hub, bot timers and premoves. (auth.ts's own map is a plain module Map, so it resets whenever the dev server reloads that module.)
- **Text:** `normalizeDisplayName` and `graphemes` in src/lib/names.ts clean text and count characters the way people see them. `normalizeDisplayName` turns line breaks into spaces. Nothing uses `{@html}`; keep it that way.
- **New endpoints:** in this order:
  - a signed-in user (the middleware);
  - membership, with the same 404 for "no such game" and "not your game", as in state.ts, events.ts and hands/[number].ts;
  - a rate limit (429), as in the avatar upload;
  - validation (400);
  - then the action.

  action.ts itself answers non-members with a 403 from `performAction` and has no rate limit. Chat and taunts get their own routes, not new `GameAction` types, because every change through `performAction` is saved with `saveGame` and then sent to everyone with `publish()`. `saveGame` bumps the version and `updated_at`, which reorders /games.
- **Layers and focus:**
  - Inside the arena, `.msg` is z 4 and `.insp` is z 5.
  - `.arena` and `.hand-zone` are size containers, so fixed children inside them are placed relative to the container. A chat sheet belongs in Game.svelte.
  - During the hand-end sequence, `skipEnding` in Game.svelte swallows every click and the Escape, Enter and Space keys. HandResult takes focus when it opens and closes on any Escape pressed anywhere in the window.
- **Per-device settings:** localStorage keys start with `hearts:` (`hearts:notify`, `hearts:seen-hand:<id>`, `hearts:seen-shot:<id>`, `hearts:app-nudge`). The 4-colour deck is the `hearts_deck` cookie, read on the server.
- **Rematch:** `insertRematch` makes a new game id, so chat stored per game starts empty there. Keep playing keeps the same id.
- **Phone layout:** Table.svelte's phone rules are under `@media (max-width: 640px)`, plus `max-width: 374px` for 360px phones. A sideways phone is wider than 640px, so it keeps the desktop table (at least 340px tall) and seat placement. It does get the single-column layout from `max-width: 1080px`, and the container queries on the arena and the hand.

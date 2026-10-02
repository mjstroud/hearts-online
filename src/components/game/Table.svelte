<script lang="ts">
  import { flip } from 'svelte/animate';
  import { fade, fly, scale } from 'svelte/transition';
  import { type Card, SUIT_SYMBOL, cardLabel, suitOf } from '../../lib/engine/cards';
  import type { Trick } from '../../lib/engine/hand';
  import type { GameAction, GameView } from '../../lib/types';
  import { avatarColor, initials, signed } from '../../lib/ui';
  import PlayingCard from '../PlayingCard.svelte';
  import DevPanel from './DevPanel.svelte';
  import Standings from './Standings.svelte';

  interface Props {
    view: GameView;
    act: (a: GameAction) => Promise<boolean>;
    busy: boolean;
    notify: boolean;
    toggleNotify: () => void;
    onShowResult: () => void;
  }
  let { view, act, busy, notify, toggleNotify, onShowResult }: Props = $props();

  type Pos = 'bottom' | 'left' | 'top' | 'right' | 'top-left' | 'top-right';
  const POS4: Pos[] = ['bottom', 'left', 'top', 'right'];
  const POS5: Pos[] = ['bottom', 'left', 'top-left', 'top-right', 'right'];
  // Direction a card flies in from, per seat position.
  const FROM: Record<Pos, { x: number; y: number }> = {
    bottom: { x: 0, y: 140 },
    top: { x: 0, y: -140 },
    left: { x: -160, y: 0 },
    right: { x: 160, y: 0 },
    'top-left': { x: -110, y: -110 },
    'top-right': { x: 110, y: -110 },
  };

  const t = $derived(view.table!);
  const n = $derived(view.players.length);
  const me = $derived(view.me.seat);
  const anchor = $derived(me ?? 0);
  const posOf = (seat: number): Pos => (n === 5 ? POS5 : POS4)[(seat - anchor + n) % n];
  const nameOf = (seat: number | null) => (seat === null ? '' : seat === me ? 'You' : (view.players[seat]?.name ?? ''));
  const list = (names: string[]) =>
    names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;

  const myTurn = $derived(t.phase === 'playing' && me !== null && t.turn === me);
  const needPass = $derived(t.phase === 'passing' && me !== null && !t.myPass);
  const leading = $derived(!!t.current && t.current.plays.length === 0);
  const leadSuit = $derived(t.current && t.current.plays.length ? suitOf(t.current.plays[0].card) : null);

  // ----- Selection (pass picks, or a tap-to-confirm play on touch screens)
  let selected = $state<Card[]>([]);
  const selKey = $derived(`${t.handNumber}:${t.phase}:${t.trickNumber}:${myTurn}`);
  $effect(() => {
    selKey;
    selected = [];
  });

  const finePointer = typeof window !== 'undefined' && window.matchMedia('(hover: hover) and (pointer: fine)').matches;

  async function pass() {
    if (selected.length !== t.passCount) return;
    await act({ type: 'pass', cards: selected });
  }

  async function play(card: Card) {
    selected = [];
    await act({ type: 'play', card });
  }

  function clickCard(card: Card) {
    if (busy) return;
    if (needPass) {
      if (selected.includes(card)) selected = selected.filter((c) => c !== card);
      else if (selected.length < t.passCount) selected = [...selected, card];
      else selected = [...selected.slice(1), card];
      return;
    }
    if (myTurn && t.legal.includes(card)) {
      if (finePointer || selected[0] === card) play(card);
      else selected = [card];
    }
  }

  // ----- Keep a just-finished trick on the felt for a moment
  let held = $state<Trick | null>(null);
  let lastKey: string | null = null;
  let holdTimer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => {
    const lt = t.lastTrick;
    const key = lt ? lt.plays.map((p) => p.card).join('') : '';
    if (lastKey === null) {
      lastKey = key;
      return;
    }
    if (key && key !== lastKey) {
      lastKey = key;
      held = lt;
      clearTimeout(holdTimer);
      holdTimer = setTimeout(() => (held = null), 1600);
    }
  });
  const shown = $derived(t.current && t.current.plays.length > 0 ? t.current : held);
  const showingWinner = $derived(!!shown && shown.winner !== null);

  // ----- Responsive sizing
  let arenaW = $state(900);
  let handW = $state(900);
  const trickW = $derived(arenaW < 520 ? 52 : arenaW < 760 ? 66 : 80);
  const cardW = $derived(handW < 520 ? 58 : handW < 760 ? 74 : 92);
  const handCount = $derived(t.myHand.length);
  const step = $derived(Math.max(14, Math.min(cardW * 0.74, (handW - cardW - 8) / Math.max(1, handCount - 1))));
  const handOffset = $derived((handW - (cardW + step * Math.max(0, handCount - 1))) / 2);
  const mid = $derived((handCount - 1) / 2);
  const spread = $derived(Math.min(2.4, 24 / Math.max(handCount, 1)));
  const ARC = 0.5;
  const arcDrop = $derived(mid ** 2 * ARC);

  // You sit at the bottom, so "left" is screen-left.
  function passArrow(label: string): string {
    if (label === 'Left') return '←';
    if (label === 'Right') return '→';
    if (label === 'Across') return '↑';
    if (label === 'Left across') return '↖';
    if (label === 'Right across') return '↗';
    return '·';
  }

  // Playtest-only visibility toggles (the dev panel owns the switches).
  let showHands = $state(true);
  let showCrib = $state(true);
  const manualBots = $derived(view.dev?.botMode === 'manual');

  const fresh = (card: Card) => t.received.includes(card) && t.myHand.length === t.totalTricks;

  const hint = $derived.by(() => {
    if (me === null) return 'You are watching this game.';
    if (t.phase === 'passing') {
      if (needPass) {
        const dir = t.passLabel.toLowerCase();
        return `Pick ${t.passCount} cards to pass ${dir} to ${nameOf(t.passTarget)}.`;
      }
      const waiting = t.passed.flatMap((p, s) => (p ? [] : [nameOf(s)]));
      if (manualBots) return `Waiting for ${list(waiting)} to pass. Pass for them in the playtest panel, or press AI move.`;
      return `Waiting for ${list(waiting)} to pass…`;
    }
    if (myTurn) {
      if (leading) {
        if (t.trickNumber === 1) return `Lead the ${cardLabel(t.legal[0])} to open the hand.`;
        if (!t.heartsBroken && t.myHand.some((c) => suitOf(c) === 'H') && t.legal.some((c) => suitOf(c) !== 'H'))
          return 'Your lead. Hearts haven’t been broken yet.';
        return 'Your lead.';
      }
      if (leadSuit && t.myHand.some((c) => suitOf(c) === leadSuit)) return `Your turn. Follow suit with a ${SUIT_SYMBOL[leadSuit]}.`;
      if (leadSuit && t.trickNumber === 1 && view.settings.noPointsOnFirstTrick)
        return `You’re out of ${SUIT_SYMBOL[leadSuit]}. No points on the first trick.`;
      return `You’re out of ${leadSuit ? SUIT_SYMBOL[leadSuit] : 'that suit'}. Play anything.`;
    }
    if (manualBots) return `${nameOf(t.turn)} is up. Play a card for them in the playtest panel, or press AI move.`;
    return `Waiting for ${nameOf(t.turn)} to play…`;
  });
</script>

<div class="container wide layout">
  <div class="main">
    <div class="statusbar">
      <h1 class="game-name">{view.name}</h1>
      <div class="chips">
        {#if view.mode === 'playtest'}<span class="badge sky">⚗ Playtest</span>{/if}
        {#if view.endAfterHand}<span class="badge gold" title="The host is ending the game when this hand is finished">⚑ Final hand</span>{/if}
        <span class="badge num">Hand {t.handNumber}</span>
        <span class="badge" class:gold={t.phase === 'passing'}>⇄ {t.passLabel}</span>
        {#if t.phase === 'playing'}
          <span class="badge num">Trick {t.trickNumber}/{t.totalTricks}</span>
          <span class="badge" class:heart={t.heartsBroken}>{t.heartsBroken ? '♥ Broken' : '♡ Not broken'}</span>
        {/if}
      </div>
    </div>

    <div class="arena" bind:clientWidth={arenaW} class:five={n === 5} style={`--tw: ${trickW}px`}>
      <div class="felt">
        <div class="felt-logo" aria-hidden="true">♥</div>

        <div class="center">
          {#if shown}
            <div class="trick">
              {#each shown.plays as p (p.card)}
                {@const pos = posOf(p.seat)}
                <div
                  class={`played at-${pos}`}
                  class:winner={showingWinner && shown.winner === p.seat}
                  class:loser={showingWinner && shown.winner !== p.seat}
                  in:fly={{ ...FROM[pos], duration: 280, opacity: 0.2 }}
                  out:fade={{ duration: 160 }}
                >
                  <PlayingCard card={p.card} width={trickW} jackScored={view.settings.jackOfDiamonds} />
                </div>
              {/each}
            </div>
            {#if showingWinner && shown.winner !== null}
              <div class="takes" in:scale={{ start: 0.9, duration: 180 }}>{nameOf(shown.winner)} {shown.winner === me ? 'take' : 'takes'} it</div>
            {/if}
          {:else if t.phase === 'passing'}
            <div class="center-note" in:fade>
              <span class="big-arrow" aria-hidden="true">{passArrow(t.passLabel)}</span>
              <strong>Pass {t.passLabel.toLowerCase()}</strong>
              <span>{t.passed.filter(Boolean).length} of {n} ready</span>
            </div>
          {:else if t.cribWinner === null}
            <div class="crib" in:fade title="The crib goes to whoever wins the first trick">
              {#if view.dev && showCrib}
                <div class="crib-open">
                  {#each view.dev.crib as c (c)}<PlayingCard card={c} width={trickW * 0.62} jackScored={view.settings.jackOfDiamonds} />{/each}
                </div>
              {:else}
                <div class="crib-stack">
                  {#each Array(Math.min(t.cribSize, 4)) as _, i}
                    <span style={`--i: ${i}`}><PlayingCard width={trickW * 0.72} /></span>
                  {/each}
                </div>
              {/if}
              <span class="crib-label">Crib · {t.cribSize} cards</span>
            </div>
          {:else if myTurn}
            <div class="center-note" in:fade><strong>Your lead</strong></div>
          {/if}
        </div>
      </div>

      {#each view.players as p (p.userId)}
        {@const pos = posOf(p.seat)}
        {@const acting = view.toAct.includes(p.seat)}
        <div class={`seat at-${pos}`} class:acting class:me={p.seat === me}>
          <div class="seat-avatar">
            <span class="avatar" style={`--size: ${arenaW < 520 ? 38 : 46}px; --avatar: ${avatarColor(p.username)}`}>
              {p.isBot ? '🤖' : initials(p.name)}
            </span>
            {#if !p.isBot}<span class="presence" class:on={p.online}></span>{/if}
            {#if p.seat !== me}<span class="cards-left num" title="Cards in hand">{t.handSizes[p.seat]}</span>{/if}
          </div>
          <div class="seat-name">{p.seat === me ? 'You' : p.name}</div>
          <div class="seat-score num">
            <strong>{p.score}</strong>
            {#if t.phase === 'playing'}
              <span class:pos={t.pointsTaken[p.seat] > 0} class:neg={t.pointsTaken[p.seat] < 0}>
                {t.pointsTaken[p.seat] === 0 ? '·' : signed(t.pointsTaken[p.seat])}
              </span>
            {/if}
          </div>
          <div class="seat-tags">
            {#if t.phase === 'passing'}
              <span class="tag" class:done={t.passed[p.seat]}>{t.passed[p.seat] ? '✓ Passed' : 'Choosing'}</span>
            {/if}
            {#if t.cribWinner === p.seat}<span class="tag crib-tag" title="Won the crib">Crib</span>{/if}
            {#if t.queenTakenBy === p.seat}<span class="tag q" title="Took the Queen of Spades">Q♠</span>{/if}
            {#if t.jackTakenBy === p.seat && view.settings.jackOfDiamonds}<span class="tag j" title="Took the Jack of Diamonds">J♦</span>{/if}
          </div>
        </div>
      {/each}
    </div>

    <div class="hand-zone">
      <div class="action-bar">
        <p class="hint" class:mine={myTurn || needPass}>{hint}</p>
        {#if needPass}
          <button class="btn btn-primary" disabled={busy || selected.length !== t.passCount} onclick={pass}>
            Pass {selected.length}/{t.passCount} → {nameOf(t.passTarget)}
          </button>
        {:else if myTurn && !finePointer && selected.length === 1}
          <button class="btn btn-primary" disabled={busy} onclick={() => play(selected[0])}>Play {cardLabel(selected[0])}</button>
        {/if}
      </div>

      <div class="hand" bind:clientWidth={handW} style={`height: ${cardW * 1.4 + 34 + arcDrop}px`}>
        {#each t.myHand as card, i (card)}
          {@const playable = needPass || (myTurn && t.legal.includes(card))}
          <div
            class="slot"
            style={`left: ${handOffset + i * step}px; transform: translateY(${(i - mid) ** 2 * ARC}px) rotate(${(i - mid) * spread}deg); z-index: ${i}`}
            animate:flip={{ duration: 260 }}
            out:fly={{ y: -60, duration: 200 }}
          >
            <PlayingCard
              {card}
              width={cardW}
              selected={selected.includes(card)}
              dimmed={myTurn && !t.legal.includes(card)}
              fresh={fresh(card)}
              jackScored={view.settings.jackOfDiamonds}
              onclick={needPass || myTurn ? () => clickCard(card) : undefined}
              disabled={busy || !playable}
            />
          </div>
        {/each}
      </div>
    </div>

    {#if view.dev}
      <DevPanel {view} {act} {busy} bind:showHands bind:showCrib />
    {/if}
  </div>

  <aside class="side">
    <section class="panel side-panel">
      <div class="spread">
        <h2 class="panel-title">Standings</h2>
        <span class="faint num small">{view.handsPlayed} hand{view.handsPlayed === 1 ? '' : 's'} played</span>
      </div>
      <Standings players={view.players} lastHand={view.lastHand} meId={view.me.userId} scoreLimit={view.settings.scoreLimit} />
      <div class="side-links">
        <a href={`/games/${view.id}/scoreboard`}>Scoreboard</a>
        <a href={`/games/${view.id}/stats`}>Stats</a>
        {#if view.me.isOwner}<a href={`/games/${view.id}/settings`}>Settings</a>{/if}
      </div>
    </section>

    {#if t.myCrib}
      <section class="panel side-panel" in:fly={{ y: 12 }}>
        <h2 class="panel-title">Your crib</h2>
        <p class="faint small">You won the first trick, so these are yours. Only you can see them.</p>
        <div class="mini-cards">
          {#each t.myCrib as c}<PlayingCard card={c} width={46} jackScored={view.settings.jackOfDiamonds} />{/each}
        </div>
      </section>
    {/if}

    {#if t.phase === 'playing' && (t.received.length || t.myPass)}
      <section class="panel side-panel">
        <h2 class="panel-title">This hand’s pass</h2>
        {#if t.myPass}
          <div class="pass-row">
            <span class="faint small">To {nameOf(t.passTarget)}</span>
            <div class="mini-cards">{#each t.myPass as c}<PlayingCard card={c} width={36} showValue={false} />{/each}</div>
          </div>
        {/if}
        {#if t.received.length}
          <div class="pass-row">
            <span class="faint small">From {nameOf(t.passSource)}</span>
            <div class="mini-cards">{#each t.received as c}<PlayingCard card={c} width={36} showValue={false} />{/each}</div>
          </div>
        {/if}
      </section>
    {/if}

    {#if view.lastHand}
      <section class="panel side-panel">
        <div class="spread">
          <h2 class="panel-title">Last hand <span class="faint num">#{view.lastHand.number}</span></h2>
          <button class="btn btn-ghost btn-sm" onclick={onShowResult}>Details</button>
        </div>
        <div class="last-hand">
          {#each view.players as p}
            <div class="lh-row">
              <span>{p.seat === me ? 'You' : p.name}</span>
              <span class="lh-tags">
                {#if view.lastHand.sun === p.seat}<span title="Shot the Sun">☀</span>{/if}
                {#if view.lastHand.moon === p.seat}<span title="Shot the Moon">☾</span>{/if}
                {#if view.lastHand.queen === p.seat}<span title="Queen of Spades">Q♠</span>{/if}
                {#if view.lastHand.jack === p.seat && view.lastHand.jackScored}<span class="j" title="Jack of Diamonds">J♦</span>{/if}
                {#if view.lastHand.cribWinner === p.seat}<span title="Won the crib">▣</span>{/if}
              </span>
              <strong class="num">{signed(view.lastHand.scores[p.seat])}</strong>
            </div>
          {/each}
        </div>
      </section>
    {/if}

    <button class="btn btn-ghost btn-sm notify" onclick={toggleNotify}>
      {notify ? '🔔 Turn alerts on' : '🔕 Alert me when it’s my turn'}
    </button>
  </aside>
</div>

<style>
  .layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 300px;
    gap: 24px;
    padding-top: 18px;
    padding-bottom: 28px;
  }

  .main {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .statusbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    flex-wrap: wrap;
  }

  .game-name {
    font-family: var(--font-display);
    font-size: 22px;
    font-weight: 560;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 100%;
  }

  .chips {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }

  /* ---------- Arena ---------- */
  .arena {
    position: relative;
    height: clamp(330px, 50vh, 500px);
  }

  .felt {
    position: absolute;
    inset: 34px 64px 30px;
    border-radius: 999px;
    background:
      radial-gradient(ellipse at 50% 40%, rgb(255 255 255 / 0.08), transparent 60%),
      radial-gradient(ellipse at center, var(--felt-1) 0%, var(--felt-2) 55%, var(--felt-3) 100%);
    box-shadow:
      inset 0 0 0 1px rgb(255 255 255 / 0.06),
      inset 0 0 0 10px rgb(0 0 0 / 0.22),
      inset 0 0 0 11px rgb(255 255 255 / 0.05),
      inset 0 20px 60px rgb(0 0 0 / 0.45),
      0 30px 70px -20px rgb(0 0 0 / 0.7);
    overflow: hidden;
  }

  .felt::before {
    content: '';
    position: absolute;
    inset: 0;
    opacity: 0.35;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.35 0'/%3E%3C/filter%3E%3Crect width='120' height='120' filter='url(%23n)'/%3E%3C/svg%3E");
    mix-blend-mode: overlay;
    pointer-events: none;
  }

  .felt-logo {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    font-size: 140px;
    color: rgb(0 0 0 / 0.07);
    pointer-events: none;
    filter: blur(0.3px);
  }

  .center {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
  }

  .trick {
    position: relative;
    width: var(--tw);
    height: calc(var(--tw) * 1.4);
  }

  .played {
    position: absolute;
    inset: 0;
    transition:
      transform 0.3s var(--ease),
      filter 0.3s,
      opacity 0.3s;
  }

  .played.at-bottom {
    transform: translate(0, 40%) rotate(-2deg);
  }
  .played.at-top {
    transform: translate(0, -40%) rotate(3deg);
  }
  .played.at-left {
    transform: translate(-72%, 0) rotate(-6deg);
  }
  .played.at-right {
    transform: translate(72%, 0) rotate(5deg);
  }
  .played.at-top-left {
    transform: translate(-50%, -32%) rotate(-4deg);
  }
  .played.at-top-right {
    transform: translate(50%, -32%) rotate(4deg);
  }
  .five .played.at-left {
    transform: translate(-118%, 10%) rotate(-6deg);
  }
  .five .played.at-right {
    transform: translate(118%, 10%) rotate(6deg);
  }
  .five .played.at-top-left {
    transform: translate(-62%, -40%) rotate(-4deg);
  }
  .five .played.at-top-right {
    transform: translate(62%, -40%) rotate(4deg);
  }
  .five .played.at-bottom {
    transform: translate(0, 46%) rotate(-2deg);
  }

  .played.winner {
    z-index: 5;
    filter: drop-shadow(0 0 14px rgb(242 196 109 / 0.75));
  }

  .played.loser {
    filter: brightness(0.75);
  }

  .takes {
    position: absolute;
    bottom: 14%;
    padding: 5px 12px;
    border-radius: 99px;
    background: rgb(0 0 0 / 0.45);
    color: var(--gold);
    font-size: 13px;
    font-weight: 600;
    backdrop-filter: blur(6px);
  }

  .center-note {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    color: rgb(255 255 255 / 0.8);
    text-align: center;
    font-size: 13px;
  }

  .center-note strong {
    font-family: var(--font-display);
    font-size: 22px;
    font-weight: 560;
    color: #fff;
  }

  .big-arrow {
    font-size: 30px;
    line-height: 1;
    color: var(--gold);
  }

  .crib {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
  }

  .crib-stack {
    position: relative;
    width: calc(var(--tw) * 0.72 + 18px);
    height: calc(var(--tw) * 0.72 * 1.4 + 8px);
  }

  .crib-stack span {
    position: absolute;
    left: calc(var(--i) * 6px);
    top: calc(var(--i) * -2px + 6px);
    transform: rotate(calc((var(--i) - 1.5) * 4deg));
  }

  .crib-open {
    display: flex;
    gap: 4px;
  }

  .crib-label {
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: rgb(255 255 255 / 0.75);
  }

  /* ---------- Seats ---------- */
  .seat {
    position: absolute;
    z-index: 3;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 3px;
    width: 116px;
    text-align: center;
  }

  .seat.at-top {
    top: 0;
    left: 50%;
    transform: translate(-50%, -6px);
  }
  .seat.at-bottom {
    bottom: 0;
    left: 50%;
    transform: translate(-50%, 18px);
  }
  .seat.at-left {
    left: 0;
    top: 50%;
    transform: translate(-6px, -50%);
  }
  .seat.at-right {
    right: 0;
    top: 50%;
    transform: translate(6px, -50%);
  }
  .seat.at-top-left {
    top: 0;
    left: 22%;
    transform: translate(-50%, -2px);
  }
  .seat.at-top-right {
    top: 0;
    right: 22%;
    transform: translate(50%, -2px);
  }

  .seat-avatar {
    position: relative;
    border-radius: 50%;
    padding: 3px;
    background: rgb(9 13 12 / 0.75);
    box-shadow: 0 6px 16px rgb(0 0 0 / 0.4);
  }

  .seat-avatar .avatar {
    position: relative;
  }

  /* Spinning ring on a pseudo-element so the badges on the avatar stay upright. */
  .acting .seat-avatar::before {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: 50%;
    background: conic-gradient(from 0deg, var(--gold), var(--heart), var(--gold));
    animation: spin 2.6s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .presence {
    position: absolute;
    right: 2px;
    bottom: 2px;
    width: 11px;
    height: 11px;
    border-radius: 50%;
    background: var(--faint);
    border: 2px solid #0b120f;
  }

  .presence.on {
    background: var(--mint);
  }

  .cards-left {
    position: absolute;
    top: -2px;
    right: -8px;
    min-width: 22px;
    height: 20px;
    padding: 0 5px;
    border-radius: 6px;
    display: grid;
    place-items: center;
    font-size: 11px;
    font-weight: 700;
    color: #fff;
    background: linear-gradient(160deg, #c8344a, #8e1830);
    border: 1px solid rgb(255 255 255 / 0.4);
    box-shadow: 0 2px 6px rgb(0 0 0 / 0.4);
  }

  .seat-name {
    max-width: 100%;
    padding: 1px 8px;
    border-radius: 6px;
    font-size: 13px;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    background: rgb(9 13 12 / 0.6);
  }

  .acting .seat-name {
    color: var(--gold);
  }

  .seat-score {
    display: flex;
    gap: 6px;
    align-items: baseline;
    font-size: 12px;
    padding: 1px 8px;
    border-radius: 6px;
    background: rgb(9 13 12 / 0.6);
  }

  .seat-score strong {
    font-size: 14px;
  }

  .seat-score span {
    color: var(--faint);
  }

  .seat-score .pos {
    color: #ff98a4;
  }

  .seat-score .neg {
    color: var(--mint);
  }

  .seat-tags {
    display: flex;
    gap: 3px;
    flex-wrap: wrap;
    justify-content: center;
  }

  .tag {
    font-size: 10.5px;
    font-weight: 700;
    padding: 1px 6px;
    border-radius: 5px;
    background: rgb(0 0 0 / 0.5);
    color: var(--muted);
    white-space: nowrap;
  }

  .tag.done {
    color: var(--mint);
  }

  .tag.q {
    background: #1a1d22;
    color: #fff;
  }

  .tag.j {
    background: var(--gold);
    color: #3b2604;
  }

  .tag.crib-tag {
    background: rgb(124 180 255 / 0.18);
    color: var(--sky);
  }

  /* ---------- Hand ---------- */
  .hand-zone {
    margin-top: 22px;
  }

  .action-bar {
    min-height: 44px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 14px;
    flex-wrap: wrap;
    text-align: center;
  }

  .hint {
    color: var(--muted);
    font-size: 14.5px;
  }

  .hint.mine {
    color: var(--text);
    font-weight: 600;
  }

  .hand {
    position: relative;
    margin-top: 10px;
  }

  .slot {
    position: absolute;
    top: 26px;
    transform-origin: 50% 120%;
    transition:
      left 0.25s var(--ease),
      transform 0.25s var(--ease);
  }

  /* ---------- Side ---------- */
  .side {
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding-top: 44px;
  }

  .side-panel {
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    border-radius: 18px;
  }

  .side-links {
    display: flex;
    gap: 4px;
    border-top: 1px solid var(--border);
    padding-top: 10px;
    margin-top: 2px;
  }

  .side-links a {
    flex: 1;
    text-align: center;
    padding: 6px 4px;
    border-radius: 8px;
    font-size: 13px;
    font-weight: 600;
    color: var(--muted);
    text-decoration: none;
  }

  .side-links a:hover {
    color: var(--text);
    background: rgb(255 255 255 / 0.05);
  }

  .small {
    font-size: 12.5px;
  }

  .mini-cards {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }

  .pass-row {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .last-hand {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 13.5px;
  }

  .lh-row {
    display: grid;
    grid-template-columns: 1fr auto 44px;
    gap: 8px;
    align-items: center;
  }

  .lh-row strong {
    text-align: right;
  }

  .lh-tags {
    display: flex;
    gap: 4px;
    font-size: 11px;
    font-weight: 700;
    color: var(--muted);
  }

  .lh-tags .j {
    color: var(--gold);
  }

  .notify {
    align-self: center;
  }

  @media (max-width: 1080px) {
    .layout {
      grid-template-columns: 1fr;
    }

    .side {
      padding-top: 0;
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
      align-items: start;
    }
  }

  @media (max-width: 640px) {
    .layout {
      padding-top: 10px;
      gap: 16px;
    }

    .arena {
      height: 330px;
    }

    .felt {
      inset: 30px 34px 26px;
    }

    .felt-logo {
      font-size: 90px;
    }

    .seat {
      width: 84px;
    }

    .seat.at-left {
      transform: translate(-14px, -50%);
    }

    .seat.at-right {
      transform: translate(14px, -50%);
    }

    .seat.at-top-left {
      left: 20%;
    }

    .seat.at-top-right {
      right: 20%;
    }

    .seat-name {
      font-size: 12px;
    }

    .game-name {
      font-size: 18px;
    }
  }
</style>

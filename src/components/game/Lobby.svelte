<script lang="ts">
  import { CRIB_SIZE, MAX_PLAYERS, MIN_PLAYERS, cardsPerPlayer, passCycle, passLabel } from '../../lib/engine/rules';
  import type { GameAction, GameView } from '../../lib/types';
  import { BOT_AVATAR, avatarColor, initials } from '../../lib/ui';

  interface Props {
    view: GameView;
    act: (a: GameAction) => Promise<boolean>;
    leave: () => void;
    busy: boolean;
  }
  let { view, act, leave, busy }: Props = $props();

  let copied = $state<'code' | 'link' | null>(null);
  const isOwner = $derived(view.me.isOwner);
  const count = $derived(view.players.length);
  const canStart = $derived(count >= MIN_PLAYERS && count <= MAX_PLAYERS);
  const previewPlayers = $derived(Math.min(Math.max(count, MIN_PLAYERS), MAX_PLAYERS));
  const s = $derived(view.settings);

  async function copy(kind: 'code' | 'link') {
    const text = kind === 'code' ? view.joinCode : `${location.origin}/join/${view.joinCode}`;
    try {
      await navigator.clipboard.writeText(text);
      copied = kind;
      setTimeout(() => (copied = null), 1600);
    } catch {
      prompt('Copy this:', text);
    }
  }
</script>

<div class="container page">
  <div class="page-head">
    <div class="stack" style="--gap: 6px">
      <span class="eyebrow">Waiting room</span>
      <h1 class="display">{view.name}</h1>
    </div>
    {#if isOwner}
      <a class="btn btn-sm" href={`/games/${view.id}/settings`}>Room settings</a>
    {/if}
  </div>

  <div class="grid">
    <section class="panel panel-pad stack invite">
      <div class="stack" style="--gap: 4px">
        <h2 class="panel-title">Invite the family</h2>
        <p class="muted">Share the code or link. Anyone with an account can use it to take a seat.</p>
      </div>
      <button class="code" onclick={() => copy('code')} title="Copy join code">
        {#each view.joinCode.split('') as ch}<span>{ch}</span>{/each}
      </button>
      <div class="row">
        <button class="btn btn-sm" onclick={() => copy('code')}>{copied === 'code' ? 'Copied!' : 'Copy code'}</button>
        <button class="btn btn-sm" onclick={() => copy('link')}>{copied === 'link' ? 'Copied!' : 'Copy invite link'}</button>
      </div>
    </section>

    <section class="panel panel-pad stack seats">
      <div class="spread">
        <h2 class="panel-title">Seats <span class="faint num">{count}/{MAX_PLAYERS}</span></h2>
        {#if isOwner && count > 1}
          <button class="btn btn-ghost btn-sm" disabled={busy} onclick={() => act({ type: 'shuffleSeats' })}>⤨ Shuffle seats</button>
        {/if}
      </div>
      <ol class="seat-list">
        {#each view.players as p (p.userId)}
          <li>
            <span class="seat-no num">{p.seat + 1}</span>
            <span class="avatar" style={`--avatar: ${avatarColor(p.username)}`}>{p.isBot ? BOT_AVATAR : initials(p.name)}</span>
            <span class="who">
              <strong>{p.name}</strong>
              <small class="faint">
                {#if p.isBot}Computer player 🐾{:else}@{p.username}{/if}
                {#if p.userId === view.ownerId} · Host{/if}
                {#if p.userId === view.me.userId} · You{/if}
              </small>
            </span>
            {#if !p.isBot}<span class="dot" class:on={p.online} title={p.online ? 'Online now' : 'Offline'}></span>{/if}
            {#if isOwner && p.userId !== view.ownerId}
              <button class="btn btn-ghost btn-sm" disabled={busy} onclick={() => act({ type: 'removePlayer', userId: p.userId })}>Remove</button>
            {/if}
          </li>
        {/each}
        {#each Array(Math.max(0, MIN_PLAYERS - count)) as _, i}
          <li class="open"><span class="seat-no num">{count + i + 1}</span><span class="faint">Open seat</span></li>
        {/each}
      </ol>
      <p class="hint">Play passes to the left in seat order: 1 → 2 → 3 …</p>

      {#if isOwner}
        <div class="row actions">
          <button class="btn" disabled={busy || count >= MAX_PLAYERS} onclick={() => act({ type: 'addBot' })} title="Seats one of the cats">+ Computer player</button>
          <button class="btn btn-primary" disabled={busy || !canStart} onclick={() => act({ type: 'start' })}>
            Deal the first hand →
          </button>
        </div>
        {#if !canStart}<p class="hint">Hearts needs {MIN_PLAYERS} or {MAX_PLAYERS} players.</p>{/if}
      {:else}
        <div class="row actions">
          <p class="muted">Waiting for the host to start the game…</p>
          <button class="btn btn-ghost btn-sm" disabled={busy} onclick={leave}>Leave game</button>
        </div>
      {/if}
    </section>

    <section class="panel panel-pad stack rules">
      <h2 class="panel-title">House rules for this game</h2>
      <ul class="rule-list">
        <li><span class="pip">♥</span><span>Hearts are 1 point each, the <strong>Q♠ is 13</strong>.</span></li>
        {#if s.jackOfDiamonds}<li><span class="pip gold">♦</span><span>Taking the <strong>J♦ is −10</strong>.</span></li>{/if}
        <li>
          <span class="pip">▣</span>
          <span>
            A {CRIB_SIZE}-card face-down crib goes to whoever wins the first trick ({cardsPerPlayer(previewPlayers)} cards each with
            {previewPlayers} players{previewPlayers === 5 ? ', after removing the 2♣, 2♦ and 2♠' : ''}).
          </span>
        </li>
        <li><span class="pip">♣</span><span>The lowest club in play leads the first trick.</span></li>
        {#if s.shootTheMoon}<li><span class="pip">☾</span><span>Shoot the Moon: everyone else <strong>+26</strong>.</span></li>{/if}
        {#if s.shootTheSun}<li><span class="pip gold">☀</span><span>Shoot the Sun (win every trick): everyone else <strong>+52</strong>.</span></li>{/if}
        <li><span class="pip">⇄</span><span>Passing: {passCycle(previewPlayers).map((o) => passLabel(o, previewPlayers)).join(' → ')}.</span></li>
        <li><span class="pip">⚑</span><span>{s.scoreLimit ? `The game ends after the hand in which someone reaches ${s.scoreLimit}.` : 'No score limit. The host ends the game after a finished hand.'}</span></li>
        {#if !s.noPointsOnFirstTrick}<li><span class="pip">!</span><span>Points may be dumped on the first trick.</span></li>{/if}
      </ul>
      <a class="muted small" href="/rules">Full rules →</a>
    </section>
  </div>
</div>

<style>
  .grid {
    display: grid;
    grid-template-columns: 1fr 1.3fr;
    gap: 20px;
    align-items: start;
  }

  .seats {
    grid-row: span 2;
    grid-column: 2;
  }

  .invite {
    grid-column: 1;
  }

  .rules {
    grid-column: 1;
  }

  .code {
    all: unset;
    display: flex;
    gap: 8px;
    cursor: pointer;
  }

  .code span {
    flex: 1;
    max-width: 52px;
    height: 60px;
    display: grid;
    place-items: center;
    border-radius: 12px;
    font-family: var(--font-mono);
    font-size: 26px;
    font-weight: 500;
    background: rgb(0 0 0 / 0.3);
    border: 1px solid var(--border-strong);
    color: var(--gold);
  }

  .code:hover span {
    border-color: rgb(242 196 109 / 0.4);
  }

  .seat-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .seat-list li {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 12px;
    border-radius: 14px;
    background: rgb(255 255 255 / 0.025);
    border: 1px solid var(--border);
    min-height: 60px;
  }

  .seat-list li.open {
    border-style: dashed;
    background: transparent;
  }

  .seat-no {
    width: 22px;
    text-align: center;
    color: var(--faint);
    font-weight: 600;
    font-size: 13px;
  }

  .who {
    display: flex;
    flex-direction: column;
    line-height: 1.3;
    margin-right: auto;
    min-width: 0;
  }

  .who strong {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--faint);
  }

  .dot.on {
    background: var(--mint);
    box-shadow: 0 0 0 3px var(--mint-soft);
  }

  .actions {
    justify-content: space-between;
    padding-top: 6px;
  }

  .rule-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
    font-size: 14px;
    color: var(--muted);
  }

  .rule-list li {
    display: flex;
    gap: 10px;
    align-items: baseline;
  }

  .rule-list strong {
    color: var(--text);
  }

  .pip {
    flex: none;
    width: 22px;
    height: 22px;
    display: inline-grid;
    place-items: center;
    border-radius: 7px;
    background: var(--heart-soft);
    color: var(--heart);
    font-size: 12px;
    transform: translateY(5px);
  }

  .pip.gold {
    background: var(--gold-soft);
    color: var(--gold);
  }

  .small {
    font-size: 13px;
  }

  @media (max-width: 860px) {
    .grid {
      grid-template-columns: 1fr;
    }

    .seats,
    .invite,
    .rules {
      grid-column: 1;
      grid-row: auto;
    }
  }
</style>

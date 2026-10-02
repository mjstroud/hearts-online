<script lang="ts">
  import type { GameAction, GameView } from '../../lib/types';
  import { BOT_AVATAR, avatarColor, initials, ordinal } from '../../lib/ui';

  let { view, act, busy }: { view: GameView; act: (a: GameAction) => Promise<boolean>; busy: boolean } = $props();

  const ranked = $derived(
    view.players
      .map((p) => ({ ...p, rank: 1 + view.players.filter((o) => o.score < p.score).length }))
      .sort((a, b) => a.score - b.score),
  );
  const winners = $derived(ranked.filter((p) => p.rank === 1));
</script>

<div class="container page">
  <div class="hero panel">
    <span class="eyebrow">Final · {view.handsPlayed} hands played</span>
    <h1 class="display">{view.name}</h1>
    {#if view.handsPlayed > 0}
      <div class="crown" aria-hidden="true">♛</div>
      <p class="winner">
        {winners.map((w) => w.name).join(' & ')}
        {winners.length > 1 ? 'share the win' : 'wins'} with {winners[0].score} points
      </p>
    {:else}
      <p class="muted">This game ended before any hands were finished.</p>
    {/if}

    <ol class="podium">
      {#each ranked as p (p.userId)}
        <li class:first={p.rank === 1}>
          <span class="place">{ordinal(p.rank)}</span>
          <span class="avatar" style={`--size: 34px; --avatar: ${avatarColor(p.username)}`}>{p.isBot ? BOT_AVATAR : initials(p.name)}</span>
          <span class="name">{p.name}{p.userId === view.me.userId ? ' (you)' : ''}</span>
          <strong class="num">{p.score}</strong>
        </li>
      {/each}
    </ol>

    <div class="row center">
      <a class="btn btn-gold" href={`/games/${view.id}/scoreboard`}>Full scoreboard</a>
      <a class="btn" href={`/games/${view.id}/stats`}>Game stats</a>
      {#if view.dev}
        <button class="btn" disabled={busy || !view.dev.canUndo} onclick={() => act({ type: 'dev:undo' })}>↶ Undo last move</button>
        <a class="btn btn-ghost" href="/playtest">New playtest</a>
      {:else}
        <a class="btn btn-ghost" href="/games/new">Start a new game</a>
      {/if}
    </div>
  </div>
</div>

<style>
  .hero {
    max-width: 640px;
    margin: 0 auto;
    padding: 40px 32px;
    text-align: center;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    background:
      radial-gradient(400px 200px at 50% 0%, rgb(242 196 109 / 0.16), transparent 70%),
      linear-gradient(180deg, var(--surface-2), var(--surface));
  }

  h1 {
    font-size: clamp(30px, 5vw, 44px);
  }

  .crown {
    font-size: 44px;
    color: var(--gold);
    line-height: 1;
    margin-top: 8px;
    text-shadow: 0 6px 30px rgb(242 196 109 / 0.5);
  }

  .winner {
    font-size: 18px;
    font-weight: 600;
  }

  .podium {
    list-style: none;
    padding: 0;
    margin: 12px 0 8px;
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .podium li {
    display: grid;
    grid-template-columns: 44px 34px 1fr auto;
    gap: 12px;
    align-items: center;
    padding: 10px 14px;
    border-radius: 14px;
    background: rgb(255 255 255 / 0.03);
    border: 1px solid var(--border);
    text-align: left;
  }

  .podium li.first {
    border-color: rgb(242 196 109 / 0.4);
    background: rgb(242 196 109 / 0.08);
  }

  .place {
    font-weight: 700;
    color: var(--muted);
  }

  .first .place {
    color: var(--gold);
  }

  .name {
    font-weight: 600;
  }

  .center {
    justify-content: center;
  }
</style>

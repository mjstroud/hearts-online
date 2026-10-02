<script lang="ts">
  import type { HandSummary } from '../../lib/engine/view';
  import type { PlayerView } from '../../lib/types';
  import { BOT_AVATAR, avatarColor, initials, signed } from '../../lib/ui';

  interface Props {
    players: PlayerView[];
    lastHand: HandSummary | null;
    meId: number;
    scoreLimit: number | null;
  }
  let { players, lastHand, meId, scoreLimit }: Props = $props();

  const rows = $derived(
    players
      .map((p) => ({ ...p, rank: 1 + players.filter((o) => o.score < p.score).length }))
      .sort((a, b) => a.score - b.score || a.seat - b.seat),
  );
</script>

<ol class="standings">
  {#each rows as p (p.userId)}
    <li class:me={p.userId === meId} class:lead={p.rank === 1 && lastHand}>
      <span class="rank num">{p.rank}</span>
      <span class="avatar" style={`--size: 26px; --avatar: ${avatarColor(p.username)}`}>{p.isBot ? BOT_AVATAR : initials(p.name)}</span>
      <span class="name">
        <span class="name-text" title={p.name}>{p.name}</span>
        {#if scoreLimit}
          <span class="bar"><span style={`width: ${Math.max(0, Math.min(100, (100 * p.score) / scoreLimit))}%`}></span></span>
        {/if}
      </span>
      <span class="delta num" class:up={lastHand && lastHand.scores[p.seat] > 0} class:down={lastHand && lastHand.scores[p.seat] < 0}>
        {lastHand ? signed(lastHand.scores[p.seat]) : ''}
      </span>
      <strong class="total num">{p.score}</strong>
    </li>
  {/each}
</ol>
{#if scoreLimit}<p class="limit faint">Game ends after a hand where someone reaches {scoreLimit}</p>{/if}

<style>
  .standings {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  li {
    display: grid;
    grid-template-columns: 18px 26px 1fr auto 44px;
    align-items: center;
    gap: 10px;
    padding: 7px 8px;
    border-radius: 10px;
    font-size: 14px;
  }

  li.me {
    background: rgb(255 255 255 / 0.04);
  }

  .rank {
    color: var(--faint);
    font-weight: 700;
    font-size: 12px;
    text-align: center;
  }

  li.lead .rank {
    color: var(--gold);
  }

  .name {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .name-text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .bar {
    display: block;
    height: 3px;
    border-radius: 2px;
    background: rgb(255 255 255 / 0.07);
    overflow: hidden;
  }

  .bar span {
    display: block;
    height: 100%;
    background: linear-gradient(90deg, var(--mint), var(--gold), var(--heart));
    background-size: 300px 100%;
  }

  .delta {
    font-size: 12px;
    color: var(--faint);
  }

  .delta.up {
    color: #ff98a4;
  }

  .delta.down {
    color: var(--mint);
  }

  .total {
    text-align: right;
    font-size: 15px;
  }

  .limit {
    font-size: 12px;
    text-align: center;
  }
</style>

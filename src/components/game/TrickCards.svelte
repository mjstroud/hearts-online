<script lang="ts">
  import type { Card } from '../../lib/engine/cards';
  import PlayingCard from '../PlayingCard.svelte';

  interface Props {
    /** In play order. A card without a seat (the crib) gets no name. */
    plays: { seat?: number; card: Card }[];
    winner?: number | null;
    /** Display names by seat. */
    names?: string[];
  }
  let { plays, winner = null, names = [] }: Props = $props();
</script>

<!-- Small cards with who played each one underneath, cut short so five fit at 375px. -->
<div class="plays">
  {#each plays as p (p.card)}
    {@const who = p.seat === undefined ? '' : (names[p.seat] ?? `Seat ${p.seat + 1}`)}
    <figure class:win={p.seat !== undefined && p.seat === winner}>
      <PlayingCard card={p.card} width={40} showValue={false} />
      {#if who}<figcaption title={who}>{who}</figcaption>{/if}
    </figure>
  {/each}
</div>

<style>
  .plays {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  figure {
    margin: 0;
    width: 52px;
    display: grid;
    justify-items: center;
    gap: 3px;
  }

  figcaption {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 11.5px;
    color: var(--faint);
  }

  .win figcaption {
    color: var(--gold);
    font-weight: 700;
  }
</style>

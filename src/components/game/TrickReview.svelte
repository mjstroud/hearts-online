<script lang="ts">
  import type { HandReview } from '../../lib/engine/review';
  import { cardsPerPlayer } from '../../lib/engine/rules';
  import { playedOutNote } from '../../lib/moments';
  import { signed } from '../../lib/ui';
  import TrickCards from './TrickCards.svelte';

  // Loaded with import() only when someone asks to see the tricks, so the table never pays for it.
  interface Props {
    gameId: string;
    hand: number;
    /** Display names by seat, for a server too old to send the hand's own. */
    names: string[];
    /** Outside the hand result (the scoreboard): also show the pass, any Sun or Moon, and the crib. */
    standalone?: boolean;
  }
  let { gameId, hand, names, standalone = false }: Props = $props();

  // The hand's own players: a seat may have changed hands since (a host removing someone).
  const seatNames = (r: HandReview) => Array.from({ length: r.numPlayers }, (_, s) => r.names?.[s] ?? names[s] ?? `Seat ${s + 1}`);
  const pts = (n: number) => (n === 0 ? '·' : signed(n));

  // Never cached: a playtest undo can take a hand back.
  async function load(): Promise<HandReview> {
    const res = await fetch(`/api/games/${gameId}/hands/${hand}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(res.status === 404 ? 'This hand isn’t on record any more.' : 'Couldn’t load the tricks.');
    return res.json();
  }
  // svelte-ignore state_referenced_locally
  let review = $state(load());
</script>

{#await review}
  <p class="faint">Loading the tricks…</p>
{:then r}
  {@const who = seatNames(r)}
  {@const name = (seat: number) => who[seat]}
  {@const note = playedOutNote(r.autoFrom, cardsPerPlayer(r.numPlayers))}
  <div class="stack">
    {#if standalone}
      <p class="line">
        Passed {r.passLabel.toLowerCase()}
        {#if r.sun !== null || r.moon !== null}
          · {r.sun !== null ? '☀\uFE0E' : '☾'} <span class="nm">{name(r.sun ?? r.moon ?? 0)}</span> shot the {r.sun !== null ? 'Sun' : 'Moon'}
        {/if}
      </p>
    {/if}
    <!-- A flex column, not a grid, so a row can't grow past the dialog to fit a long name. -->
    <ol class="stack">
      {#each r.tricks as t (t.number)}
        <li>
          <p class="line">
            <b class="num">{t.number}</b><span class="nm">{name(t.leader)}</span> led ·
            <span class="nm">{name(t.winner)}</span> won
            <strong class="num" class:up={t.points > 0} class:down={t.points < 0}>{pts(t.points)}</strong>
          </p>
          <TrickCards plays={t.plays} winner={t.winner} names={who} />
        </li>
      {/each}
    </ol>
    {#if note}<p class="faint small">{note}</p>{/if}
    {#if standalone}
      <div>
        <p class="line">
          Crib · <span class="nm">{name(r.cribWinner)}</span> won
          <strong class="num" class:up={r.cribPoints > 0} class:down={r.cribPoints < 0}>{pts(r.cribPoints)}</strong>
        </p>
        <TrickCards plays={r.crib.map((card) => ({ card }))} />
      </div>
    {/if}
  </div>
{:catch e}
  <p class="faint">
    {e instanceof Error ? e.message : 'Couldn’t load the tricks.'}
    <button class="btn btn-ghost btn-sm" onclick={() => (review = load())}>Try again</button>
  </p>
{/await}

<style>
  ol {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  /* One line that never wraps: long names are cut short, and the points stay at the end. */
  .line {
    display: flex;
    align-items: baseline;
    gap: 5px;
    margin-bottom: 5px;
    font-size: 13px;
    color: var(--muted);
    white-space: nowrap;
  }

  .line b {
    min-width: 1.4em;
  }

  .line strong {
    margin-left: auto;
    padding-left: 8px;
  }

  .small {
    font-size: 13px;
  }

  /* Capped, so one long name gets cut short before a short one does. */
  .nm {
    min-width: 0;
    max-width: 40%;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--text);
  }

  .up {
    color: var(--heart-ink);
  }

  .down {
    color: var(--mint);
  }
</style>

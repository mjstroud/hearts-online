<script lang="ts">
  import type { GameAction, GameView } from '../../lib/types';

  // What happens after a finished game: the host can keep it going or set up a rematch, and everyone
  // gets a link to the rematch once there is one. FinalResults loads this on its own (import()).
  interface Props {
    view: GameView;
    act: (a: GameAction) => Promise<boolean>;
    busy: boolean;
  }
  let { view, act, busy }: Props = $props();

  const MAX_LIMIT = 1_000_000;
  const hostName = $derived(view.players.find((p) => p.userId === view.ownerId)?.name ?? 'The host');
  // Hearts ends on the highest total, so a new limit has to be above it (the server checks the same).
  const top = $derived(Math.max(...view.players.map((p) => p.score)));
  const min = $derived(Math.max(1, top + 1));

  // Where the picker starts: the current setting, unless it was reached. Then at least a hand's worth
  // of points above the highest total, on a round number.
  // svelte-ignore state_referenced_locally
  const current = view.settings.scoreLimit;
  let mode = $state<'limit' | 'none'>(current === null ? 'none' : 'limit');
  // svelte-ignore state_referenced_locally
  let target = $state<number | null>(current === null || top >= current ? Math.ceil((top + 26) / 50) * 50 : current);
  const valid = $derived(mode === 'none' || (Number.isInteger(target) && target! >= min && target! <= MAX_LIMIT));

  function keepPlaying() {
    act({ type: 'extend', scoreLimit: mode === 'none' ? null : target, handsPlayed: view.handsPlayed });
  }

  async function rematch() {
    // The answer is this game's view, now with the link: follow it.
    if ((await act({ type: 'rematch' })) && view.rematchId) location.href = `/games/${view.rematchId}`;
  }
</script>

<div class="choices">
  {#if view.rematchId}
    <p class="who">{view.me.isOwner ? 'You' : hostName} set up a rematch.</p>
    <a class="btn btn-primary btn-block" href={`/games/${view.rematchId}`}>Go to the rematch →</a>
    {#if view.me.isOwner}
      <p class="hint">To keep playing this game instead, <a href={`/games/${view.rematchId}/settings`}>delete the rematch</a>.</p>
    {/if}
  {:else if view.me.isOwner}
    <fieldset class="box stack" style="--gap: 6px">
      <legend class="label">Keep playing</legend>
      <div class="pick">
        <!-- Plain handlers rather than bind:group, whose code would land in the shared runtime every page loads. -->
        <label class="opt"><input type="radio" name="end-limit" checked={mode === 'limit'} onchange={() => (mode = 'limit')} /> Play to</label>
        <input
          class="input"
          type="number"
          inputmode="numeric"
          {min}
          max={MAX_LIMIT}
          step="1"
          aria-label="New score limit"
          aria-invalid={mode === 'limit' && !valid}
          bind:value={target}
          onfocus={() => (mode = 'limit')}
        />
      </div>
      <label class="opt"><input type="radio" name="end-limit" checked={mode === 'none'} onchange={() => (mode = 'none')} /> No limit</label>
      <p class="hint">Totals carry on. The highest is {top}, so a new limit has to be above it.</p>
      <button class="btn btn-primary btn-block" disabled={busy || !valid} onclick={keepPlaying}>Keep playing →</button>
    </fieldset>
    <fieldset class="box stack" style="--gap: 10px">
      <legend class="label">Rematch</legend>
      <p class="hint">
        {view.mode === 'playtest'
          ? 'Deals a fresh table with the same seats.'
          : 'Same players and house rules, scores back to zero. Everyone waits in the waiting room until you deal.'}
      </p>
      <button class="btn btn-block" disabled={busy} onclick={rematch}>Set up a rematch</button>
    </fieldset>
  {:else}
    <p class="who muted">{hostName} can keep this game going or set up a rematch.</p>
  {/if}
</div>

<style>
  .choices {
    width: 100%;
    max-width: 420px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  /* A host's name can be one 32-character word. */
  .who {
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .box {
    margin: 0;
    padding: 12px 16px 16px;
    min-width: 0;
    border: 1px solid var(--border);
    border-radius: 14px;
    text-align: left;
  }

  .pick,
  .opt {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 44px;
  }

  .pick .input {
    width: 7em;
  }

  .opt input {
    width: 18px;
    height: 18px;
    margin: 0;
    accent-color: var(--gold);
  }
</style>

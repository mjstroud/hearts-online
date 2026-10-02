<script lang="ts">
  import type { Card } from '../../lib/engine/cards';
  import { PRESETS, type PresetId } from '../../lib/engine/presets';
  import type { BotMode, BotSpeed, GameAction, GameView } from '../../lib/types';
  import { BOT_AVATAR, avatarColor, initials } from '../../lib/ui';
  import PlayingCard from '../PlayingCard.svelte';

  interface Props {
    view: GameView;
    act: (a: GameAction) => Promise<boolean>;
    busy: boolean;
    showHands: boolean;
    showCrib: boolean;
  }
  let { view, act, busy, showHands = $bindable(), showCrib = $bindable() }: Props = $props();

  const dev = $derived(view.dev!);
  const t = $derived(view.table!);
  const me = $derived(view.me.seat ?? 0);
  const manual = $derived(dev.botMode === 'manual');

  let open = $state(true);
  let passSel = $state<Record<number, Card[]>>({});
  let preset = $state<PresetId>('random');
  let presetSeat = $state(0);
  let passChoice = $state<'auto' | number>('auto');
  let customHands = $state<string[]>(['', '', '', '', '']);
  let customCrib = $state('');

  // Clear pass picks whenever a new hand is dealt or the phase changes.
  const handKey = $derived(`${t.handNumber}:${t.phase}:${dev.hands.map((h) => h.length).join()}`);
  $effect(() => {
    handKey;
    passSel = {};
  });

  const nameOf = (seat: number) => (seat === me ? 'You' : (view.players[seat]?.name ?? `Seat ${seat + 1}`));
  const presetInfo = $derived(PRESETS.find((p) => p.id === preset)!);
  const needsSeat = $derived(preset === 'moon' || preset === 'sun');

  function pickPreset(id: PresetId) {
    preset = id;
    // Stacked hands are only meaningful if nobody passes cards away.
    if (id === 'moon' || id === 'sun') {
      passChoice = 0;
      presetSeat = me;
    }
  }

  function status(seat: number): { text: string; tone: 'act' | 'done' | 'idle' } {
    if (t.phase === 'passing') return dev.passes[seat] ? { text: 'Passed', tone: 'done' } : { text: 'Choosing pass', tone: 'act' };
    if (t.turn === seat) return { text: 'To play', tone: 'act' };
    return { text: '', tone: 'idle' };
  }

  function clickCard(seat: number, card: Card) {
    if (busy) return;
    if (t.phase === 'passing' && !dev.passes[seat]) {
      const sel = passSel[seat] ?? [];
      passSel[seat] = sel.includes(card) ? sel.filter((c) => c !== card) : sel.length < t.passCount ? [...sel, card] : [...sel.slice(1), card];
      return;
    }
    if (t.phase === 'playing' && t.turn === seat && dev.legal[seat]?.includes(card)) {
      act({ type: 'dev:act', seat, move: { type: 'play', card } });
    }
  }

  async function passFor(seat: number) {
    const cards = passSel[seat] ?? [];
    if (cards.length !== t.passCount) return;
    if (await act({ type: 'dev:act', seat, move: { type: 'pass', cards } })) passSel[seat] = [];
  }

  const SPEEDS: BotSpeed[] = ['fast', 'normal', 'slow'];
  const setBots = (botMode: BotMode) => act({ type: 'dev:bots', botMode });
  const setSpeed = (speed: BotSpeed) => act({ type: 'dev:bots', speed });

  function deal() {
    act({
      type: 'dev:deal',
      preset,
      seat: presetSeat,
      passOffset: passChoice === 'auto' ? null : passChoice,
      custom: preset === 'custom' ? { hands: customHands.slice(0, view.players.length), crib: customCrib } : undefined,
    });
  }
</script>

<section class="panel dev" aria-label="Playtest controls">
  <header class="dev-head">
    <button class="collapse" onclick={() => (open = !open)} aria-expanded={open}>
      <span class="flask" aria-hidden="true">⚗</span>
      <strong>Playtest controls</strong>
      <span class="faint small">Only you are at this table, so everything can be shown.</span>
      <span class="chev" class:up={open} aria-hidden="true">⌄</span>
    </button>
  </header>

  {#if open}
    <div class="toolbar">
      <div class="group">
        <span class="label">Computer players</span>
        <div class="seg" role="group" aria-label="Computer players">
          <button class:on={!manual} disabled={busy} onclick={() => setBots('auto')}>Auto</button>
          <button class:on={manual} disabled={busy} onclick={() => setBots('manual')}>Manual</button>
        </div>
        <div class="seg" role="group" aria-label="Bot speed" class:muted-seg={manual}>
          {#each SPEEDS as sp}
            <button class:on={dev.speed === sp} disabled={busy || manual} onclick={() => setSpeed(sp)}>{sp[0].toUpperCase() + sp.slice(1)}</button>
          {/each}
        </div>
      </div>

      <div class="group">
        <span class="label">Step</span>
        <button class="btn btn-sm" disabled={busy} onclick={() => act({ type: 'dev:ai', scope: 'move' })} title="The computer makes the next move (bots first)">AI move</button>
        <button class="btn btn-sm" disabled={busy} onclick={() => act({ type: 'dev:ai', scope: 'trick' })} title="The computer plays every seat until this trick is done">Finish trick</button>
        <button class="btn btn-sm" disabled={busy} onclick={() => act({ type: 'dev:ai', scope: 'hand' })} title="The computer plays every seat until the hand is scored">Finish hand</button>
        <button class="btn btn-sm" disabled={busy || !dev.canUndo} onclick={() => act({ type: 'dev:undo' })} title="Take back your last move (and any bot moves after it)">↶ Undo</button>
      </div>

      <div class="group">
        <span class="label">Show</span>
        <label class="chip"><input type="checkbox" bind:checked={showHands} /> All hands</label>
        <label class="chip"><input type="checkbox" bind:checked={showCrib} /> Crib</label>
      </div>
    </div>

    <div class="rows">
      {#each view.players as p (p.userId)}
        {@const st = status(p.seat)}
        {@const visible = showHands || p.seat === me}
        {@const picking = t.phase === 'passing' && !dev.passes[p.seat]}
        {@const sel = passSel[p.seat] ?? []}
        <div class="seat-row" class:acting={st.tone === 'act'}>
          <div class="who">
            <span class="avatar" style={`--size: 26px; --avatar: ${avatarColor(p.username)}`}>{p.isBot ? BOT_AVATAR : initials(p.name)}</span>
            <span class="who-text">
              <strong>{nameOf(p.seat)}</strong>
              <small class:act={st.tone === 'act'} class:done={st.tone === 'done'}>
                {st.text || `${t.tricksWon[p.seat]} trick${t.tricksWon[p.seat] === 1 ? '' : 's'}`}
              </small>
            </span>
          </div>
          <div class="cards">
            {#each dev.hands[p.seat] ?? [] as card (card)}
              {@const playable = t.phase === 'playing' && t.turn === p.seat && dev.legal[p.seat]?.includes(card)}
              <PlayingCard
                card={visible ? card : null}
                width={40}
                showValue={false}
                selected={sel.includes(card)}
                dimmed={visible && t.phase === 'playing' && t.turn === p.seat && !playable}
                onclick={visible && (picking || playable) ? () => clickCard(p.seat, card) : undefined}
                disabled={busy}
              />
            {/each}
            {#if dev.passes[p.seat] && t.phase === 'passing'}
              <span class="passed-note faint">passing {visible ? dev.passes[p.seat]!.map((c) => c.replace('T', '10')).join(' ') : '3 cards'}</span>
            {/if}
          </div>
          <div class="row-actions">
            {#if picking && visible}
              <button class="btn btn-sm btn-primary" disabled={busy || sel.length !== t.passCount} onclick={() => passFor(p.seat)}>
                Pass {sel.length}/{t.passCount}
              </button>
            {/if}
            {#if st.tone === 'act'}
              <button class="btn btn-sm" disabled={busy} onclick={() => act({ type: 'dev:ai', scope: 'move', seat: p.seat })}>AI</button>
            {/if}
          </div>
        </div>
      {/each}

      <div class="seat-row crib-row">
        <div class="who">
          <span class="crib-icon" aria-hidden="true">▣</span>
          <span class="who-text">
            <strong>Crib</strong>
            <small>{t.cribWinner === null ? 'Goes to the first trick’s winner' : `Won by ${nameOf(t.cribWinner)}`}</small>
          </span>
        </div>
        <div class="cards">
          {#each dev.crib as card (card)}<PlayingCard card={showCrib ? card : null} width={40} showValue={false} />{/each}
        </div>
        <div class="row-actions"></div>
      </div>
    </div>

    <div class="deal">
      <div class="deal-controls">
        <label class="field">
          <span>Scenario</span>
          <select class="input" value={preset} onchange={(e) => pickPreset((e.currentTarget as HTMLSelectElement).value as PresetId)}>
            {#each PRESETS as p}<option value={p.id}>{p.label}</option>{/each}
          </select>
        </label>
        {#if needsSeat}
          <label class="field">
            <span>For</span>
            <select class="input" bind:value={presetSeat}>
              {#each view.players as p}<option value={p.seat}>{nameOf(p.seat)}</option>{/each}
            </select>
          </label>
        {/if}
        <label class="field">
          <span>Pass</span>
          <select class="input" bind:value={passChoice}>
            <option value="auto">As scheduled</option>
            {#each dev.passOptions as o}<option value={o.offset}>{o.label}</option>{/each}
          </select>
        </label>
        <button class="btn btn-gold" disabled={busy} onclick={deal}>Redeal hand {t.handNumber}</button>
      </div>
      <p class="hint">{presetInfo.hint}</p>
      {#if preset === 'custom'}
        <div class="custom">
          {#each view.players as p}
            <label class="field">
              <span>{nameOf(p.seat)}</span>
              <input class="input mono" bind:value={customHands[p.seat]} placeholder="e.g. QS AH 10H 2C" autocomplete="off" />
            </label>
          {/each}
          <label class="field">
            <span>Crib</span>
            <input class="input mono" bind:value={customCrib} placeholder="e.g. JD" autocomplete="off" />
          </label>
        </div>
      {/if}
    </div>
  {/if}
</section>

<style>
  .dev {
    margin-top: 18px;
    border-radius: 18px;
    border-color: rgb(124 180 255 / 0.25);
    background:
      linear-gradient(180deg, rgb(124 180 255 / 0.06), transparent 120px),
      linear-gradient(180deg, var(--surface-2), var(--surface));
    overflow: hidden;
  }

  .collapse {
    all: unset;
    box-sizing: border-box;
    width: 100%;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 14px 18px;
    cursor: pointer;
  }

  .collapse:focus-visible {
    outline: 2px solid var(--gold);
    outline-offset: -2px;
  }

  .flask {
    color: var(--sky);
    font-size: 16px;
  }

  .small {
    font-size: 12.5px;
  }

  .chev {
    margin-left: auto;
    color: var(--muted);
    transition: transform 0.2s;
  }

  .chev.up {
    transform: rotate(180deg);
  }

  .toolbar {
    display: flex;
    flex-wrap: wrap;
    gap: 10px 22px;
    padding: 4px 18px 14px;
    border-bottom: 1px solid var(--border);
  }

  .group {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }

  .label {
    font-size: 11.5px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--faint);
    margin-right: 2px;
  }

  .seg {
    display: inline-flex;
    padding: 2px;
    gap: 2px;
    border-radius: 9px;
    background: rgb(0 0 0 / 0.3);
    border: 1px solid var(--border);
  }

  .seg button {
    all: unset;
    padding: 4px 10px;
    border-radius: 7px;
    font-size: 12.5px;
    font-weight: 600;
    color: var(--muted);
    cursor: pointer;
  }

  .seg button.on {
    background: var(--surface-3);
    color: var(--text);
  }

  .seg button:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }

  .seg button:focus-visible {
    outline: 2px solid var(--gold);
  }

  .chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    border-radius: 99px;
    border: 1px solid var(--border-strong);
    font-size: 12.5px;
    font-weight: 600;
    cursor: pointer;
  }

  .chip input {
    accent-color: var(--sky);
  }

  .rows {
    display: flex;
    flex-direction: column;
    padding: 8px 10px;
  }

  .seat-row {
    display: grid;
    grid-template-columns: 150px minmax(0, 1fr) auto;
    align-items: center;
    gap: 12px;
    padding: 8px;
    border-radius: 12px;
  }

  .seat-row.acting {
    background: rgb(242 196 109 / 0.07);
    box-shadow: inset 0 0 0 1px rgb(242 196 109 / 0.22);
  }

  .who {
    display: flex;
    align-items: center;
    gap: 9px;
    min-width: 0;
  }

  .who-text {
    display: flex;
    flex-direction: column;
    line-height: 1.25;
    min-width: 0;
  }

  .who-text strong {
    font-size: 13.5px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .who-text small {
    font-size: 11.5px;
    color: var(--faint);
  }

  .who-text small.act {
    color: var(--gold);
  }

  .who-text small.done {
    color: var(--mint);
  }

  .crib-icon {
    width: 26px;
    text-align: center;
    color: var(--sky);
  }

  .cards {
    display: flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
    overflow-x: auto;
    padding: 10px 2px 4px;
    scrollbar-width: thin;
  }

  .passed-note {
    font-size: 12px;
    margin-left: 8px;
    white-space: nowrap;
  }

  .row-actions {
    display: flex;
    gap: 6px;
  }

  .deal {
    border-top: 1px solid var(--border);
    padding: 14px 18px 18px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .deal-controls {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: 10px;
  }

  .deal-controls .field {
    min-width: 150px;
  }

  .deal-controls .input {
    height: 38px;
    font-size: 14px;
  }

  .custom {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 10px;
  }

  .mono {
    font-family: var(--font-mono);
    font-size: 13px;
    height: 38px;
  }

  @media (max-width: 640px) {
    .seat-row {
      grid-template-columns: 1fr auto;
    }

    .cards {
      grid-column: 1 / -1;
      grid-row: 2;
    }
  }
</style>

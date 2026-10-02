<script lang="ts">
  import { SERIES_COLORS, niceTicks } from './chart';

  interface Series {
    name: string;
    /** Running total after each hand. */
    totals: number[];
  }
  let { series, height = 320 }: { series: Series[]; height?: number } = $props();

  let width = $state(760);
  let hover = $state<number | null>(null);

  const hands = $derived(series[0]?.totals.length ?? 0);
  const values = $derived(series.flatMap((s) => s.totals));
  const yTicks = $derived(niceTicks(Math.min(0, ...values), Math.max(10, ...values), 5));
  const yMin = $derived(yTicks[0]);
  const yMax = $derived(yTicks[yTicks.length - 1]);

  // Direct end-labels only when there are few series and they don't collide.
  const M = $derived({ top: 14, right: 20, bottom: 30, left: 44 });
  const plotW = $derived(Math.max(10, width - M.left - M.right));
  const plotH = $derived(height - M.top - M.bottom);
  const x = (i: number) => M.left + (hands === 0 ? 0 : (i / hands) * plotW);
  const y = (v: number) => M.top + plotH - ((v - yMin) / (yMax - yMin || 1)) * plotH;

  const xTicks = $derived.by(() => {
    if (hands === 0) return [];
    const target = Math.max(2, Math.floor(plotW / 90));
    return niceTicks(0, hands, target).filter((t) => Number.isInteger(t) && t >= 0 && t <= hands);
  });

  const paths = $derived(
    series.map((s) => {
      const pts = [`${x(0)},${y(0)}`, ...s.totals.map((v, i) => `${x(i + 1)},${y(v)}`)];
      return `M${pts.join('L')}`;
    }),
  );

  function onMove(e: PointerEvent) {
    const svg = e.currentTarget as SVGSVGElement;
    const rect = svg.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const idx = Math.round(((px - M.left) / plotW) * hands);
    hover = Math.max(1, Math.min(hands, idx));
  }

  function onKey(e: KeyboardEvent) {
    if (!hands) return;
    if (e.key === 'ArrowRight') hover = Math.min(hands, (hover ?? 0) + 1);
    else if (e.key === 'ArrowLeft') hover = Math.max(1, (hover ?? hands + 1) - 1);
    else if (e.key === 'Home') hover = 1;
    else if (e.key === 'End') hover = hands;
    else if (e.key === 'Escape') hover = null;
    else return;
    e.preventDefault();
  }

  const tip = $derived.by(() => {
    if (hover === null || !hands) return null;
    const rows = series
      .map((s, i) => ({ name: s.name, color: SERIES_COLORS[i % SERIES_COLORS.length], value: s.totals[hover! - 1], delta: s.totals[hover! - 1] - (s.totals[hover! - 2] ?? 0) }))
      .sort((a, b) => a.value - b.value);
    const left = x(hover);
    return { rows, left, flip: left > width - 200 };
  });
</script>

<div class="chart" bind:clientWidth={width}>
  <ul class="legend">
    {#each series as s, i}
      <li><span class="key" style={`background: ${SERIES_COLORS[i % SERIES_COLORS.length]}`}></span>{s.name}</li>
    {/each}
  </ul>

  {#if hands === 0}
    <div class="empty" style={`height: ${height}px`}>The chart fills in after the first hand is scored.</div>
  {:else}
    <div class="plot">
      <!-- Focusable with arrow-key navigation so keyboard users get the same readout as on hover. -->
      <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
      <svg
        {width}
        {height}
        role="img"
        aria-label="Running score totals by hand. Use arrow keys to inspect each hand."
        tabindex="0"
        onpointermove={onMove}
        onpointerleave={() => (hover = null)}
        onkeydown={onKey}
        onblur={() => (hover = null)}
      >
        {#each yTicks as t}
          <line class:zero={t === 0} class="grid" x1={M.left} x2={M.left + plotW} y1={y(t)} y2={y(t)} />
          <text class="tick" x={M.left - 8} y={y(t)} text-anchor="end" dominant-baseline="middle">{t}</text>
        {/each}
        {#each xTicks as t}
          <text class="tick" x={x(t)} y={height - 8} text-anchor="middle">{t === 0 ? 'Start' : t}</text>
        {/each}

        {#if hover !== null}
          <line class="crosshair" x1={x(hover)} x2={x(hover)} y1={M.top} y2={M.top + plotH} />
        {/if}

        {#each paths as d, i}
          <path {d} fill="none" stroke={SERIES_COLORS[i % SERIES_COLORS.length]} stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
        {/each}

        {#each series as s, i}
          {@const at = hover ?? hands}
          <circle
            cx={x(at)}
            cy={y(s.totals[at - 1])}
            r="4.5"
            fill={SERIES_COLORS[i % SERIES_COLORS.length]}
            stroke="var(--chart-surface)"
            stroke-width="2"
          />
        {/each}
      </svg>

      {#if tip}
        <div class="tooltip" class:flip={tip.flip} style={`left: ${tip.left}px`}>
          <div class="tip-title">After hand {hover}</div>
          {#each tip.rows as r}
            <div class="tip-row">
              <span class="line-key" style={`background: ${r.color}`}></span>
              <strong class="num">{r.value}</strong>
              <span class="tip-name">{r.name}</span>
              <span class="tip-delta num">{r.delta > 0 ? `+${r.delta}` : r.delta}</span>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .chart {
    --chart-surface: var(--surface);
    position: relative;
    width: 100%;
  }

  .legend {
    list-style: none;
    margin: 0 0 12px;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 6px 16px;
    font-size: 13px;
    color: var(--muted);
  }

  .legend li {
    display: inline-flex;
    align-items: center;
    gap: 7px;
  }

  .key {
    width: 14px;
    height: 2px;
    border-radius: 1px;
  }

  .plot {
    position: relative;
  }

  svg {
    display: block;
    overflow: visible;
    outline: none;
    touch-action: pan-y;
  }

  svg:focus-visible {
    outline: 2px solid var(--gold);
    outline-offset: 4px;
    border-radius: 6px;
  }

  .grid {
    stroke: rgb(var(--hi) / 0.08);
    stroke-width: 1;
    shape-rendering: crispEdges;
  }

  .grid.zero {
    stroke: rgb(var(--hi) / 0.2);
  }

  .tick {
    fill: var(--faint);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
  }

  .crosshair {
    stroke: rgb(var(--hi) / 0.3);
    stroke-width: 1;
    shape-rendering: crispEdges;
  }

  .tooltip {
    position: absolute;
    top: 6px;
    transform: translateX(12px);
    min-width: 170px;
    padding: 10px 12px;
    border-radius: 10px;
    background: color-mix(in srgb, var(--surface-2) 96%, transparent);
    border: 1px solid var(--border-strong);
    box-shadow: var(--shadow-lg);
    pointer-events: none;
    font-size: 13px;
    z-index: 2;
  }

  .tooltip.flip {
    transform: translateX(calc(-100% - 12px));
  }

  .tip-title {
    font-size: 11.5px;
    color: var(--faint);
    margin-bottom: 6px;
    font-weight: 600;
  }

  .tip-row {
    display: grid;
    grid-template-columns: 12px 36px 1fr auto;
    align-items: center;
    gap: 8px;
    padding: 2px 0;
  }

  .line-key {
    width: 12px;
    height: 2px;
    border-radius: 1px;
  }

  .tip-name {
    color: var(--muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .tip-delta {
    color: var(--faint);
    font-size: 12px;
  }

  .empty {
    display: grid;
    place-items: center;
    color: var(--faint);
    border: 1px dashed var(--border-strong);
    border-radius: 14px;
    font-size: 14px;
  }
</style>

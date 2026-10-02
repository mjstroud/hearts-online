<script lang="ts">
  import { BAR_COLOR } from './chart';

  interface Item {
    label: string;
    value: number;
    /** Text shown at the bar tip. */
    display: string;
    /** Extra context for the hover tooltip. */
    detail?: string;
  }
  let { items, max }: { items: Item[]; max?: number } = $props();

  const top = $derived(max ?? Math.max(1e-9, ...items.map((i) => Math.abs(i.value))));
  let hovered = $state<number | null>(null);
</script>

<ul class="bars">
  {#each items as item, i}
    <li
      class:hovered={hovered === i}
      onpointerenter={() => (hovered = i)}
      onpointerleave={() => (hovered = null)}
      onfocus={() => (hovered = i)}
      onblur={() => (hovered = null)}
      tabindex="0"
      aria-label={`${item.label}: ${item.display}${item.detail ? `, ${item.detail}` : ''}`}
    >
      <span class="label">{item.label}</span>
      <span class="track">
        <span class="bar" style={`width: ${Math.max(0, (100 * item.value) / top)}%; background: ${BAR_COLOR}`}></span>
        <span class="value num">{item.display}</span>
      </span>
      {#if hovered === i && item.detail}
        <span class="tip" role="tooltip"><strong>{item.display}</strong> <span>{item.detail}</span></span>
      {/if}
    </li>
  {/each}
</ul>

<style>
  .bars {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  li {
    position: relative;
    display: grid;
    grid-template-columns: minmax(70px, 34%) 1fr;
    align-items: center;
    gap: 12px;
    font-size: 13.5px;
    outline: none;
    border-radius: 6px;
  }

  li:focus-visible {
    outline: 2px solid var(--gold);
    outline-offset: 3px;
  }

  .label {
    color: var(--muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .track {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  .bar {
    display: block;
    height: 14px;
    min-width: 2px;
    border-radius: 0 4px 4px 0;
    transition: filter 0.15s;
  }

  .hovered .bar {
    filter: brightness(1.25);
  }

  .value {
    color: var(--text);
    font-weight: 600;
    white-space: nowrap;
  }

  .tip {
    position: absolute;
    left: 34%;
    bottom: calc(100% + 6px);
    padding: 6px 10px;
    border-radius: 8px;
    background: rgb(12 17 15 / 0.96);
    border: 1px solid var(--border-strong);
    box-shadow: var(--shadow-lg);
    font-size: 12.5px;
    white-space: nowrap;
    z-index: 3;
    pointer-events: none;
  }

  .tip span {
    color: var(--muted);
  }
</style>

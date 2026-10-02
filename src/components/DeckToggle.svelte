<script lang="ts">
  import { onMount } from 'svelte';
  import { setDeckPreference } from '../lib/ui';

  let { compact = false }: { compact?: boolean } = $props();
  let four = $state(false);

  onMount(() => {
    four = document.documentElement.dataset.deck === 'four';
  });

  function toggle() {
    four = !four;
    setDeckPreference(four);
  }
</script>

<button class="deck-toggle" class:compact role="switch" aria-checked={four} onclick={toggle} title="Diamonds blue, clubs green">
  <span class="suits" aria-hidden="true"><b class="s">♠</b><b class="h">♥</b><b class="d">♦</b><b class="c">♣</b></span>
  <span class="label">4-color deck</span>
  <span class="switch" aria-hidden="true"></span>
</button>

<style>
  .deck-toggle {
    all: unset;
    box-sizing: border-box;
    display: inline-flex;
    align-items: center;
    gap: 10px;
    padding: 8px 12px;
    border-radius: 12px;
    border: 1px solid var(--border);
    background: rgb(0 0 0 / 0.15);
    cursor: pointer;
    font-size: 13.5px;
    font-weight: 600;
    color: var(--muted);
  }

  .deck-toggle:hover {
    border-color: var(--border-strong);
    color: var(--text);
  }

  .deck-toggle:focus-visible {
    outline: 2px solid var(--gold);
  }

  .suits {
    display: inline-flex;
    gap: 2px;
    padding: 2px 6px;
    border-radius: 6px;
    background: var(--card-face);
    font-size: 13px;
    line-height: 1.2;
  }

  .s {
    color: var(--suit-s);
  }
  .h {
    color: var(--suit-h);
  }
  .d {
    color: var(--suit-d);
  }
  .c {
    color: var(--suit-c);
  }

  .switch {
    position: relative;
    width: 34px;
    height: 20px;
    border-radius: 99px;
    background: var(--surface-3);
    border: 1px solid var(--border-strong);
    transition: background 0.2s;
  }

  .switch::after {
    content: '';
    position: absolute;
    top: 2px;
    left: 2px;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: var(--muted);
    transition:
      transform 0.2s var(--ease),
      background 0.2s;
  }

  [aria-checked='true'] .switch {
    background: var(--mint);
    border-color: transparent;
  }

  [aria-checked='true'] .switch::after {
    transform: translateX(14px);
    background: #fff;
  }

  .compact {
    padding: 6px 10px;
    font-size: 12.5px;
  }
</style>

<script lang="ts">
  /** The way into the table's chat, with how many messages this device hasn't read. Waiting room, table and end screen. */
  interface Props {
    unread: number;
    /** The sheet is open. */
    open: boolean;
    onopen: () => void;
    /** Starts fetching the sheet's code on the first touch, before the tap lands. */
    onpreload?: () => void;
    /** Say "Chat" beside the icon (where there's room). */
    label?: boolean;
  }
  let { unread, open, onopen, onpreload, label = false }: Props = $props();
</script>

<!-- data-chat: a tap here never counts as skipping the end of a hand (Game.svelte). -->
<button
  class="chat-btn"
  class:label
  data-chat
  aria-expanded={open}
  aria-label={unread ? `Chat, ${unread} unread` : 'Chat'}
  onpointerdown={onpreload}
  onclick={onopen}
>
  <span class="icon" aria-hidden="true">💬</span>
  {#if label}<span class="word" aria-hidden="true">Chat</span>{/if}
  {#if unread}<span class="count num" aria-hidden="true">{unread > 9 ? '9+' : unread}</span>{/if}
</button>

<style>
  .chat-btn {
    position: relative;
    flex: none;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 30px;
    padding: 0 9px;
    border-radius: 99px;
    border: 1px solid var(--border-strong);
    background: var(--surface-3);
    color: var(--text);
    font: inherit;
    font-size: 13px;
    font-weight: 600;
    line-height: 1;
    cursor: pointer;
    touch-action: manipulation;
    pointer-events: auto;
  }

  /* Bigger to tap than it draws, mostly upwards: just below it, upright, a top seat's plaque begins. */
  .chat-btn::after {
    content: '';
    position: absolute;
    inset: -8px -4px -3px;
  }

  .chat-btn:hover {
    border-color: rgb(var(--hi) / 0.25);
  }

  .chat-btn:focus-visible {
    outline: 2px solid var(--gold);
    outline-offset: 2px;
  }

  .icon {
    font-size: 15px;
  }

  .count {
    min-width: 18px;
    height: 18px;
    padding: 0 5px;
    border-radius: 99px;
    background: var(--heart);
    color: #fff;
    font-size: 11px;
    font-weight: 700;
    display: grid;
    place-items: center;
  }
</style>

<!-- Only ever loaded with import(), the first time chat is opened, so its CSS comes in its own JS chunk
     rather than on every game page. -->
<svelte:options css="injected" />

<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { CHAT_MAX, CHAT_MAX_UNITS, type ChatMessage, chatError, cleanChat } from '../../lib/chat';
  import { type SendHooks, discardChat, outbox, retryChat, sendChat, settle } from '../../lib/chat-send.svelte';
  import { graphemes } from '../../lib/names';

  interface Props {
    gameId: string;
    /** The game's chat, oldest first (Game.svelte keeps it). */
    messages: readonly ChatMessage[];
    /** Your user id. */
    me: number;
    /** What's typed and not yet sent. Bound, so it outlasts the sheet being closed. */
    draft?: string;
    /** Over the table (phones, and screens up to 1080px), rather than beside it. */
    covers: boolean;
    muted: boolean;
    toggleMute: () => void;
    /** The server's copy of a message you sent. */
    received: (m: ChatMessage) => void;
    /** Everything up to this id has been in view. */
    markRead: (id: number) => void;
    close: () => void;
    /** Told when the box you type in gains or loses focus. */
    onfocus?: (focused: boolean) => void;
    /** The live stream is up. */
    connected: boolean;
    /** The table is waiting on you, which the sheet may be covering. */
    yourTurn: boolean;
    /** When the move timer runs out, on this device's clock. */
    clockEndsAt: number | null;
  }
  let {
    gameId,
    messages,
    me,
    draft = $bindable(''),
    covers,
    muted,
    toggleMute,
    received,
    markRead,
    close,
    onfocus,
    connected,
    yourTurn,
    clockEndsAt,
  }: Props = $props();

  // ----- The on-screen keyboard. The sheet sits in a frame that follows the part of the page you can see,
  // so the box you type in stays above the keyboard (iOS Safari doesn't shrink the page for it, and Android
  // Chrome by default doesn't either), without changing the site's viewport settings. Everything inside is
  // sized from the frame, never the screen.
  let frame = $state<{ top: number; height: number; keyboard: boolean } | null>(null);
  /** So little room (a phone held sideways with the keyboard up) that the header makes way. */
  const tiny = $derived(!!frame && frame.height < 200);

  let sheet: HTMLDivElement;
  let list: HTMLDivElement;
  let input: HTMLInputElement;
  /** Whether the list was scrolled to its newest message, as of the last scroll. */
  let atBottom = true;
  let newBelow = $state(false);
  /** Why your last message couldn't go, said here rather than in a toast (which the keyboard would hide). */
  let notice = $state('');
  let composing = false;

  onMount(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const vv = window.visualViewport;
    let raf = 0;
    const track = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        if (!vv) return;
        const keyboard = vv.offsetTop + vv.height < document.documentElement.clientHeight - 80;
        frame = { top: vv.offsetTop, height: vv.height, keyboard };
      });
    };
    track();
    vv?.addEventListener('resize', track);
    vv?.addEventListener('scroll', track);
    const onVisible = () => readIfSeen();
    document.addEventListener('visibilitychange', onVisible);
    list.scrollTop = list.scrollHeight;
    readIfSeen();
    // A keyboard and mouse can type at once. On a touch screen, opening chat to read shouldn't throw up the keyboard.
    if (matchMedia('(pointer: fine)').matches) input.focus({ preventScroll: true });
    else sheet.focus({ preventScroll: true });
    return () => {
      cancelAnimationFrame(raf);
      vv?.removeEventListener('resize', track);
      vv?.removeEventListener('scroll', track);
      document.removeEventListener('visibilitychange', onVisible);
      onfocus?.(false);
      // Back to a chat button, without scrolling, unless focus has already gone somewhere on purpose (the hand
      // result, say). The one that opened it may be gone: the table turns into the end screen.
      const lost = !document.activeElement || document.activeElement === document.body || sheet.contains(document.activeElement);
      const back = opener?.isConnected && opener !== document.body ? opener : document.querySelector<HTMLElement>('.chat-btn');
      if (lost) back?.focus({ preventScroll: true });
    };
  });

  // ----- Sending. Your messages show at once, and stay (outbox) until the server's copy arrives.
  const hooks: SendHooks = {
    received: (m) => received(m),
    refused: (error, text) => {
      notice = error;
      if (!draft.trim()) draft = text;
    },
  };
  $effect(() => settle(messages, me));

  // ----- The list: consecutive messages from one person within five minutes share a name line. Your
  // message keeps its place (and key) from sending to sent, so a screen reader hears it once.
  interface Row {
    key: string;
    from: number;
    name: string;
    text: string;
    at: number;
    cid?: string;
    state?: 'sending' | 'failed';
    error?: string;
  }
  const rows = $derived.by(() => {
    const all: Row[] = messages.map((m) => ({
      key: m.cid && m.from === me ? `c${m.cid}` : `m${m.id}`,
      from: m.from,
      name: m.name,
      text: m.text,
      at: m.at,
    }));
    const shown = new Set(all.map((r) => r.key));
    for (const p of outbox.pending) {
      if (!shown.has(`c${p.cid}`)) all.push({ key: `c${p.cid}`, from: me, name: '', text: p.text, at: p.at, cid: p.cid, state: p.state, error: p.error });
    }
    return all.map((r, i) => ({ ...r, first: i === 0 || all[i - 1].from !== r.from || r.at - all[i - 1].at > 5 * 60_000 }));
  });

  const clock = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
  const dayClock = new Intl.DateTimeFormat(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
  const when = (at: number) => (new Date(at).toDateString() === new Date().toDateString() ? clock : dayClock).format(at);
  const who = (r: Row) => (r.from === me ? 'You' : r.name);

  /** What's on screen counts as read: everything, once you're at the newest message and the tab is in view. */
  function readIfSeen() {
    if (!atBottom || document.visibilityState !== 'visible') return;
    newBelow = false;
    const last = messages.at(-1)?.id;
    if (last) markRead(last);
  }

  // New messages scroll the list down only if you were already at the bottom, so reading back isn't
  // interrupted; otherwise a pill says there's more below.
  let count = 0;
  $effect(() => {
    const n = rows.length;
    const grew = n > count;
    count = n;
    if (!grew) return;
    if (atBottom) tick().then(() => list && (list.scrollTop = list.scrollHeight));
    else newBelow = true;
    readIfSeen();
  });
  const onScroll = () => {
    atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 48;
    readIfSeen();
  };
  function toBottom() {
    list.scrollTop = list.scrollHeight;
    atBottom = true;
    readIfSeen();
  }

  // ----- Typing. Counted the way the server counts, after cleaning (line breaks become spaces, and so on).
  const length = $derived(graphemes(cleanChat(draft)).length);
  const left = $derived(CHAT_MAX - length);

  function submit(e: SubmitEvent) {
    e.preventDefault();
    // Enter while a word is still being put together (some phone keyboards, Japanese input) isn't a send.
    if (composing) return;
    const text = cleanChat(draft);
    const problem = chatError(text);
    if (problem) {
      if (text) notice = problem;
      return;
    }
    notice = '';
    sendChat(gameId, text, hooks);
    draft = '';
    toBottom();
  }

  // ----- Your turn, which the sheet may be covering, with the move timer if there is one.
  let now = $state(Date.now());
  $effect(() => {
    if (clockEndsAt === null) return;
    now = Date.now();
    const timer = setInterval(() => (now = Date.now()), 1000);
    return () => clearInterval(timer);
  });
  const secondsLeft = $derived(clockEndsAt === null ? null : Math.max(0, Math.ceil((clockEndsAt - now) / 1000)));
  const clockText = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

  function onKey(e: KeyboardEvent) {
    // Escape closes chat and goes no further: not the hand result's, the table's or the tray's Escape.
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
      return;
    }
    // While it covers the screen, Tab stays inside it.
    if (e.key !== 'Tab' || !covers) return;
    const stops = [...sheet.querySelectorAll<HTMLElement>('button:not(:disabled), input')];
    if (!stops.length) return;
    const [first, last] = [stops[0], stops[stops.length - 1]];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === sheet)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
</script>

<!-- data-chat: nothing in here counts as a tap or key that skips the end of a hand (Game.svelte). -->
{#if covers}
  <div class="backdrop" data-chat onclick={close} role="presentation"></div>
{/if}
<div
  class="frame"
  class:beside={!covers}
  class:keyboard={frame?.keyboard}
  data-chat
  style={frame ? `top: ${frame.top}px; height: ${frame.height}px` : undefined}
>
  <div class="sheet" role="dialog" aria-modal={covers} aria-labelledby="chat-title" tabindex="-1" bind:this={sheet} onkeydown={onKey}>
    {#if !tiny}
      <header class="head">
        <h2 id="chat-title">Chat</h2>
        {#if yourTurn}
          <!-- The time first, so on a narrow screen it's the words that get cut short. -->
          <span class="turn num" class:low={secondsLeft !== null && secondsLeft <= 10}>
            {#if secondsLeft !== null}⏱ {clockText(secondsLeft)} ·{/if} Your turn
          </span>
        {/if}
        <!-- The previews of new messages (on avatars, or a note off the table), on this device. The count and everything here stay. -->
        <button class="mute" aria-pressed={!muted} onclick={toggleMute} title="Show new messages on avatars at the table, on this device">
          Bubbles {muted ? 'off' : 'on'}
        </button>
        <button class="x" aria-label="Close chat" onclick={close}>×</button>
      </header>
    {:else}
      <h2 id="chat-title" class="sr">Chat</h2>
    {/if}

    {#if !connected}<p class="status">Reconnecting… new messages will show once it’s back.</p>{/if}

    <div class="list" role="log" aria-label="Messages" bind:this={list} onscroll={onScroll}>
      {#if !rows.length}
        <p class="empty">No messages yet. Only the players at this table can read them, and each one goes after 24 hours.</p>
      {/if}
      {#each rows as r (r.key)}
        {@const cid = r.cid}
        <div class="msg" class:first={r.first} class:mine={r.from === me} class:sending={r.state === 'sending'}>
          {#if r.first}
            <p class="who">
              <span class="nm" title={r.from === me ? undefined : r.name}>{who(r)}</span>
              <span class="when num">{when(r.at)}</span>
            </p>
          {/if}
          <!-- Plain text, never HTML: a link stays words. Each line says who to a screen reader. -->
          <p class="text">{#if !r.first}<span class="sr">{who(r)}: </span>{/if}{r.text}</p>
          {#if r.state === 'sending'}
            <p class="state" aria-hidden="true">Sending…</p>
          {:else if r.state === 'failed' && cid}
            <p class="state bad">
              {r.error}
              <button class="link" onclick={() => retryChat(gameId, cid, hooks)}>Retry</button>
              <button class="link" onclick={() => discardChat(cid)}>Remove</button>
            </p>
          {/if}
        </div>
      {/each}
    </div>
    {#if newBelow}
      <button class="below" onclick={toBottom}>New messages ↓</button>
    {/if}

    {#if notice}<p class="notice" role="alert">{notice}</p>{/if}
    <form class="compose" onsubmit={submit}>
      <input
        class="input"
        type="text"
        bind:value={draft}
        bind:this={input}
        maxlength={CHAT_MAX_UNITS}
        enterkeyhint="send"
        autocomplete="off"
        placeholder="Message the table"
        aria-label="Message"
        onfocus={() => onfocus?.(true)}
        onblur={() => onfocus?.(false)}
        oninput={() => (notice = '')}
        oncompositionstart={() => (composing = true)}
        oncompositionend={() => (composing = false)}
      />
      {#if left <= 30}
        <span class="left num" class:over={left < 0} aria-live="polite">{left < 0 ? `${-left} over` : left}</span>
      {/if}
      <!-- Pressing it doesn't take focus from the box, so a phone's keyboard stays up for the next message. -->
      <button class="btn btn-primary send" disabled={length === 0 || left < 0} onpointerdown={(e) => e.preventDefault()}>Send</button>
    </form>
  </div>
</div>

<style>
  /* Over everything but the toast (100): the hand result (80, 81), the Sun or Moon banner (70), the header. */
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 89;
    background: rgb(0 0 0 / 0.45);
    touch-action: none;
  }

  /* The part of the page you can see, above any on-screen keyboard. Taps outside the sheet go through it. */
  .frame {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    height: 100%;
    z-index: 90;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    pointer-events: none;
  }

  /* Beside the table on a wide screen: under the hand result and the Sun or Moon, which are a tap to close. */
  .frame.beside {
    z-index: 65;
  }

  /* Upright phones: a sheet from the bottom, most of the way up, and all of the room above the keyboard. */
  .sheet {
    position: relative;
    pointer-events: auto;
    display: flex;
    flex-direction: column;
    height: 75svh;
    max-height: calc(100% - 8px);
    padding-bottom: env(safe-area-inset-bottom, 0px);
    background: linear-gradient(180deg, var(--surface-2), var(--surface));
    border: 1px solid var(--border-strong);
    border-bottom: none;
    border-radius: var(--radius-lg) var(--radius-lg) 0 0;
    box-shadow: var(--shadow-lg);
    overflow: hidden;
    overscroll-behavior: contain;
    outline: none;
    animation: up 0.2s var(--ease);
  }

  /* The keyboard covers the home bar, so no room for it. */
  .keyboard .sheet {
    height: 100%;
    max-height: none;
    padding-bottom: 0;
  }

  @keyframes up {
    from {
      transform: translateY(40px);
      opacity: 0;
    }
  }

  @keyframes in {
    from {
      transform: translateX(40px);
      opacity: 0;
    }
  }

  .head {
    flex: none;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 10px 10px 18px;
    border-bottom: 1px solid var(--border);
    touch-action: none;
  }

  h2 {
    margin-right: auto;
    font-family: var(--font-display);
    font-size: 19px;
    font-weight: 560;
  }

  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }

  .turn {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    padding: 4px 10px;
    border-radius: 99px;
    background: var(--gold-soft);
    color: var(--gold);
    font-size: 12.5px;
    font-weight: 650;
  }

  .turn.low {
    background: var(--heart-soft);
    color: var(--heart-ink);
  }

  .mute,
  .x {
    flex: none;
    height: 34px;
    border: 1px solid var(--border);
    border-radius: 99px;
    background: none;
    color: var(--muted);
    font: inherit;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    touch-action: manipulation;
  }

  .mute {
    padding: 0 12px;
  }

  .mute[aria-pressed='true'] {
    color: var(--text);
  }

  .x {
    width: 34px;
    font-size: 20px;
    line-height: 1;
  }

  .mute:focus-visible,
  .x:focus-visible,
  .link:focus-visible,
  .below:focus-visible {
    outline: 2px solid var(--gold);
    outline-offset: 2px;
  }

  .status {
    flex: none;
    padding: 6px 18px;
    background: var(--gold-soft);
    color: var(--gold);
    font-size: 12.5px;
    font-weight: 600;
  }

  .list {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 6px 18px 12px;
  }

  .empty {
    padding: 28px 8px;
    text-align: center;
    color: var(--muted);
    font-size: 14px;
  }

  .msg {
    font-size: 15px;
    line-height: 1.4;
  }

  .msg.first {
    margin-top: 12px;
  }

  .msg.sending {
    opacity: 0.6;
  }

  /* A 32-character name is cut short; the time never is. */
  .who {
    display: flex;
    align-items: baseline;
    gap: 8px;
    font-size: 13px;
  }

  .nm {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 650;
    color: var(--muted);
  }

  .mine .nm {
    color: var(--gold);
  }

  .when {
    flex: none;
    margin-left: auto;
    color: var(--faint);
    font-size: 12px;
  }

  /* A long word, or a pasted link, wraps rather than widening the sheet. */
  .text {
    overflow-wrap: anywhere;
  }

  .state {
    font-size: 12.5px;
    color: var(--faint);
  }

  .state.bad {
    color: var(--heart-ink);
  }

  .link {
    margin-left: 8px;
    padding: 6px 0;
    border: none;
    background: none;
    color: var(--text);
    font: inherit;
    font-weight: 650;
    text-decoration: underline;
    cursor: pointer;
    touch-action: manipulation;
  }

  .below {
    position: absolute;
    left: 50%;
    bottom: 76px;
    transform: translateX(-50%);
    padding: 6px 14px;
    border: 1px solid var(--border-strong);
    border-radius: 99px;
    background: var(--surface-3);
    color: var(--text);
    font: inherit;
    font-size: 13px;
    font-weight: 600;
    box-shadow: var(--shadow);
    cursor: pointer;
    touch-action: manipulation;
  }

  .notice {
    flex: none;
    padding: 6px 18px 0;
    color: var(--heart-ink);
    font-size: 13px;
  }

  .compose {
    flex: none;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 12px 12px;
    border-top: 1px solid var(--border);
  }

  .notice + .compose {
    border-top: none;
  }

  .compose .input {
    flex: 1;
    min-width: 0;
  }

  .send {
    flex: none;
  }

  /* How many characters are left, from 30, in the row itself so it never pushes the box off a short screen. */
  .left {
    flex: none;
    font-size: 12px;
    color: var(--faint);
  }

  .left.over {
    color: var(--heart-ink);
    font-weight: 650;
  }

  /* Anything wider than an upright phone: a panel down the right-hand side. */
  @media (min-width: 641px) {
    .frame {
      flex-direction: row;
      justify-content: flex-end;
    }

    .sheet,
    .keyboard .sheet {
      width: min(360px, 100%);
      height: 100%;
      max-height: none;
      padding-right: env(safe-area-inset-right, 0px);
      border-bottom: 1px solid var(--border-strong);
      border-right: none;
      border-radius: var(--radius-lg) 0 0 var(--radius-lg);
      animation-name: in;
    }
  }

  /* A phone on its side: a bottom sheet would cover the hand, so a panel from the right, half the screen at
     most, or all of it while the keyboard leaves only a strip. Keep in step with SIDEWAYS in
     src/lib/phones.ts; src/lib/phones.test.ts checks. */
  @media (orientation: landscape) and (max-height: 500px) and (min-width: 540px) {
    .frame {
      flex-direction: row;
      justify-content: flex-end;
    }

    .sheet {
      width: min(340px, 50%);
      height: 100%;
      max-height: none;
      padding-bottom: 0;
      padding-right: env(safe-area-inset-right, 0px);
      border-bottom: 1px solid var(--border-strong);
      border-right: none;
      border-radius: var(--radius-lg) 0 0 var(--radius-lg);
      animation-name: in;
    }

    .keyboard .sheet {
      width: 100%;
      border-radius: 0;
      padding-left: env(safe-area-inset-left, 0px);
    }

    .compose {
      padding-top: 6px;
      padding-bottom: calc(6px + env(safe-area-inset-bottom, 0px));
    }

    .keyboard .compose {
      padding-bottom: 6px;
    }

    .head {
      padding-top: 6px;
      padding-bottom: 6px;
    }

    .list {
      padding-top: 2px;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .sheet {
      animation: none;
    }
  }
</style>

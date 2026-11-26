<script lang="ts">
  import { onMount } from 'svelte';
  import { fly } from '../../lib/motion';
  import { isPenaltyCard } from '../../lib/engine/cards';
  import { type MoveTiming, timeMove } from '../../lib/latency.svelte';
  import type { GameAction, GameView } from '../../lib/types';
  import { SITE_NAME } from '../../lib/ui';
  import FinalResults from './FinalResults.svelte';
  import HandResult from './HandResult.svelte';
  import Lobby from './Lobby.svelte';
  import Table from './Table.svelte';

  let { initial }: { initial: GameView } = $props();

  // svelte-ignore state_referenced_locally
  let view = $state<GameView>(initial);
  let busy = $state(false);
  let connected = $state(true);
  let toast = $state<{ id: number; text: string } | null>(null);
  let resultOpen = $state(false);
  let notify = $state(false);

  // Tabs stay open for days and keep running old code after a deploy, so offer a refresh.
  // Never reload on our own, and if a move is on its way, wait for it to land first.
  let newVersion = $state(false);
  let reloadAsked = $state(false);
  $effect(() => {
    if (reloadAsked && !busy) location.reload();
  });

  const seenKey = $derived(`hearts:seen-hand:${view.id}`);
  // "Your turn" (tab title, alerts) means the table is waiting on you. While a cat plays your
  // seat and someone else is still at the table, it isn't, so don't nag.
  const myTurn = $derived.by(() => {
    const seat = view.me.seat;
    if (seat === null || !view.toAct.includes(seat)) return false;
    const mine = view.players.find((p) => p.seat === seat);
    return !(mine?.autopilot && view.players.some((p) => !p.isBot && !p.autopilot));
  });

  // The move timer's deadline on this device's clock. Set only when a server view arrives, so a
  // locally predicted view can't re-anchor it with a stale "time left".
  const deadlineOf = (v: GameView) => (v.moveClock ? Date.now() + v.moveClock.endsIn : null);
  // svelte-ignore state_referenced_locally
  let clockEndsAt = $state<number | null>(deadlineOf(initial));

  function showToast(text: string) {
    const id = Date.now();
    toast = { id, text };
    setTimeout(() => {
      if (toast?.id === id) toast = null;
    }, 3800);
  }

  /**
   * While your own move is on its way, the version the guess was built on. Live updates at that
   * version (e.g. someone's online dot changing) would put your card back in your hand, so skip them.
   */
  let pendingBase: number | null = null;

  function apply(next: GameView | null) {
    if (!next) return;
    if (pendingBase !== null && next.version <= pendingBase) return;
    if (next.version >= view.version) {
      view = next;
      clockEndsAt = deadlineOf(next);
    }
  }

  /**
   * Predict the result of your own pass or play so the table reacts instantly.
   * The server's response (or the next live update) replaces the guess.
   */
  function predict(action: GameAction): GameView | null {
    const t = view.table;
    const seat = view.me.seat;
    if (!t || seat === null) return null;
    const n = view.players.length;
    if (action.type === 'play' && t.phase === 'playing' && t.turn === seat && t.current && t.legal.includes(action.card)) {
      const plays = [...t.current.plays, { seat, card: action.card }];
      const next = plays.length === n ? null : (seat + 1) % n;
      return {
        ...view,
        table: {
          ...t,
          myHand: t.myHand.filter((c) => c !== action.card),
          legal: [],
          current: { ...t.current, plays },
          turn: next,
          handSizes: t.handSizes.map((count, s) => (s === seat ? count - 1 : count)),
          heartsBroken: t.heartsBroken || isPenaltyCard(action.card),
        },
        toAct: next === null ? [] : [next],
        // The next player's clock starts on the server; wait for its real deadline.
        moveClock: null,
      };
    }
    if (action.type === 'pass' && t.phase === 'passing' && !t.myPass) {
      return {
        ...view,
        table: { ...t, myPass: action.cards, passed: t.passed.map((p, s) => p || s === seat) },
        toAct: view.toAct.filter((s) => s !== seat),
      };
    }
    return null;
  }

  /** Your latest play or pass, timed for the playtest panel's latency readout (playtest tables only). */
  let timing: MoveTiming | null = null;

  async function act(action: GameAction): Promise<boolean> {
    const timer = view.dev && (action.type === 'play' || action.type === 'pass') ? timeMove(action.type) : null;
    if (timer) timing = timer;
    busy = true;
    const guess = predict(action);
    if (guess) {
      pendingBase = view.version;
      view = guess;
      // After your card, the next player's clock starts on the server; wait for its real deadline.
      // (A pass doesn't move anyone's deadline, so the countdown keeps running.)
      if (action.type === 'play') clockEndsAt = null;
    }
    timer?.applied(!!guess);
    try {
      const res = await fetch(`/api/games/${view.id}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(action),
        // Don't leave the hand locked if a request hangs (say, a phone hopping from wifi to cellular).
        signal: AbortSignal.timeout?.(15_000),
      });
      const data = await res.json().catch(() => ({}));
      timer?.answered(res.ok && typeof data?.version === 'number' ? data.version : null);
      pendingBase = null;
      if (!res.ok) {
        showToast(data.error ?? 'Something went wrong.');
        if (guess) refresh();
        return false;
      }
      apply(data);
      return true;
    } catch {
      // Timed out or offline. The move may or may not have landed, so ask the server.
      timer?.answered(null);
      pendingBase = null;
      showToast('Network hiccup — please try again.');
      refresh();
      return false;
    } finally {
      busy = false;
    }
  }

  let leaving = false;
  async function leave() {
    leaving = true;
    if (await act({ type: 'leave' })) location.href = '/games?notice=left';
    else leaving = false;
  }

  async function refresh() {
    try {
      const res = await fetch(`/api/games/${view.id}/state`, { cache: 'no-store' });
      if (res.ok) apply(await res.json());
      else if (res.status === 404 || res.status === 401) location.href = '/games';
    } catch {
      /* offline; SSE will retry */
    }
  }

  // Show the end-of-hand summary once per hand (remembered in memory even if storage is blocked).
  let seenInMemory = 0;
  $effect(() => {
    const n = view.lastHand?.number ?? 0;
    if (!n) return;
    let seen = seenInMemory;
    try {
      seen = Math.max(seen, Number(localStorage.getItem(seenKey) ?? 0));
    } catch {}
    if (n > seen) resultOpen = true;
  });

  function closeResult() {
    resultOpen = false;
    seenInMemory = view.lastHand?.number ?? 0;
    try {
      localStorage.setItem(seenKey, String(seenInMemory));
    } catch {}
  }

  // Alerts go through a service worker (public/sw.js), because Android Chrome won't let a page
  // construct a Notification. Registered only once alerts are on, which implies permission.
  let alertWorker: Promise<ServiceWorkerRegistration | null> | null = null;
  function registerAlertWorker(): Promise<ServiceWorkerRegistration | null> {
    try {
      if (!('serviceWorker' in navigator)) return Promise.resolve(null);
      return (alertWorker ??= navigator.serviceWorker.register('/sw.js').catch(() => {
        alertWorker = null; // try again next time
        return null;
      }));
    } catch {
      // Some privacy modes throw here instead of rejecting, and this runs inside an effect.
      return Promise.resolve(null);
    }
  }
  $effect(() => {
    if (notify) registerAlertWorker();
  });

  async function showTurnAlert() {
    const title = `Your turn in ${view.name}`;
    // renotify: buzz again even if the last alert for this game is still in the tray.
    const options = {
      body: 'The table is waiting on you ♥',
      icon: '/icons/icon-192.png',
      tag: view.id,
      renotify: true,
      data: { url: `/games/${view.id}` },
    };
    try {
      // The worker activates moments after registering, long before your turn comes round.
      const reg = await registerAlertWorker();
      if (reg?.active) return await reg.showNotification(title, options);
    } catch {
      /* fall back to a page notification */
    }
    try {
      const n = new Notification(title, options);
      n.onclick = () => {
        window.focus();
        n.close();
      };
    } catch {
      /* no way to alert on this browser */
    }
  }

  // Tab title + optional notification when it becomes your turn.
  let wasMyTurn = false;
  $effect(() => {
    document.title = `${myTurn ? '● Your turn · ' : ''}${view.name} · ${SITE_NAME}`;
    try {
      if (myTurn && !wasMyTurn && notify && document.hidden && 'Notification' in window && Notification.permission === 'granted') {
        showTurnAlert();
      }
    } catch {
      /* an alert is never worth breaking the page over */
    }
    wasMyTurn = myTurn;
  });

  async function toggleNotify() {
    if (!('Notification' in window)) return showToast('This browser does not support notifications.');
    if (!notify && Notification.permission !== 'granted') {
      const p = await Notification.requestPermission();
      if (p !== 'granted') return showToast('Notifications are blocked for this site.');
    }
    notify = !notify;
    try {
      localStorage.setItem('hearts:notify', notify ? '1' : '0');
    } catch {}
  }

  onMount(() => {
    try {
      notify = localStorage.getItem('hearts:notify') === '1' && Notification.permission === 'granted';
    } catch {}

    let es: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let retries = 0;
    const connect = () => {
      clearTimeout(retryTimer);
      es?.close();
      const source = new EventSource(`/api/games/${view.id}/events`);
      es = source;
      source.addEventListener('open', () => {
        connected = true;
        retries = 0;
      });
      source.addEventListener('error', () => {
        connected = false;
        // Browsers retry a dropped stream on their own, but give up for good after an error
        // response (like a 502 while the server restarts for a deploy). Keep trying ourselves.
        if (source.readyState === EventSource.CLOSED && es === source) {
          const delay = Math.min(30_000, 1000 * 2 ** retries++);
          retryTimer = setTimeout(() => {
            refresh();
            connect();
          }, delay);
        }
      });
      source.addEventListener('state', (e) => {
        connected = true;
        const next = JSON.parse((e as MessageEvent).data);
        timing?.live(next?.version);
        apply(next);
      });
      // Each new stream says which build the server is running; a deploy shows up here on reconnect.
      source.addEventListener('build', (e) => {
        try {
          newVersion = JSON.parse((e as MessageEvent).data) !== __BUILD_ID__;
        } catch {}
      });
      source.addEventListener('removed', () => {
        if (!leaving) location.href = '/games?notice=removed';
      });
      source.addEventListener('deleted', () => (location.href = '/games?notice=deleted'));
    };
    connect();

    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      if (!es || es.readyState === EventSource.CLOSED) connect();
      refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearTimeout(retryTimer);
      es?.close();
      document.removeEventListener('visibilitychange', onVisible);
    };
  });
</script>

{#if !connected}
  <div class="conn" transition:fly={{ y: -10, duration: 200 }}>Reconnecting…</div>
{/if}

{#if newVersion && connected}
  <button class="new-version" disabled={reloadAsked} onclick={() => (reloadAsked = true)}>
    {reloadAsked ? 'Refreshing…' : 'New version · tap to refresh'}
  </button>
{/if}

{#if view.status === 'lobby'}
  <Lobby {view} {act} {leave} {busy} />
{:else if view.status === 'active' && view.table}
  <Table {view} {act} {busy} {notify} {toggleNotify} {clockEndsAt} onShowResult={() => (resultOpen = true)} />
{:else}
  <FinalResults {view} {act} {busy} />
{/if}

{#if resultOpen && view.lastHand}
  <HandResult summary={view.lastHand} players={view.players} onclose={closeResult} />
{/if}

{#if toast}
  {#key toast.id}
    <div class="toast" role="status" transition:fly={{ y: 16, duration: 220 }}>{toast.text}</div>
  {/key}
{/if}

<style>
  .toast {
    position: fixed;
    left: 50%;
    bottom: calc(28px + env(safe-area-inset-bottom, 0px));
    transform: translateX(-50%);
    z-index: 100;
    max-width: calc(100vw - 32px);
    padding: 12px 18px;
    border-radius: 12px;
    background: #2a1218;
    border: 1px solid rgb(240 71 91 / 0.4);
    color: #ffd0d6;
    font-size: 14px;
    font-weight: 500;
    box-shadow: var(--shadow-lg);
  }

  /* The sticky header grows by the top safe-area inset in a home-screen app, so these pills move down with it. */
  .conn {
    position: fixed;
    top: calc(72px + env(safe-area-inset-top, 0px));
    left: 50%;
    transform: translateX(-50%);
    z-index: 60;
    padding: 6px 14px;
    border-radius: 99px;
    font-size: 13px;
    font-weight: 600;
    background: var(--gold-soft);
    color: var(--gold);
    border: 1px solid rgb(242 196 109 / 0.3);
  }

  /* Takes the reconnecting pill's spot, which is free whenever we're connected. No animation. */
  .new-version {
    position: fixed;
    top: calc(72px + env(safe-area-inset-top, 0px));
    left: 50%;
    transform: translateX(-50%);
    z-index: 60;
    max-width: calc(100vw - 32px);
    padding: 7px 14px;
    border-radius: 99px;
    border: 1px solid var(--border-strong);
    background: var(--surface-3);
    color: var(--text);
    font: inherit;
    font-size: 13px;
    font-weight: 600;
    line-height: 1.3;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    cursor: pointer;
    touch-action: manipulation;
    box-shadow: var(--shadow);
  }

  .new-version:hover:not(:disabled) {
    border-color: rgb(var(--hi) / 0.25);
  }

  .new-version:disabled {
    cursor: progress;
    color: var(--muted);
  }

  .new-version:focus-visible {
    outline: 2px solid var(--gold);
    outline-offset: 2px;
  }
</style>

<script lang="ts">
  import { onMount } from 'svelte';
  import { fly } from 'svelte/transition';
  import type { GameAction, GameView } from '../../lib/types';
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

  const seenKey = $derived(`hearts:seen-hand:${view.id}`);
  const myTurn = $derived(view.me.seat !== null && view.toAct.includes(view.me.seat));

  function showToast(text: string) {
    const id = Date.now();
    toast = { id, text };
    setTimeout(() => {
      if (toast?.id === id) toast = null;
    }, 3800);
  }

  function apply(next: GameView | null) {
    if (next && next.version >= view.version) view = next;
  }

  async function act(action: GameAction): Promise<boolean> {
    busy = true;
    try {
      const res = await fetch(`/api/games/${view.id}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(action),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast(data.error ?? 'Something went wrong.');
        return false;
      }
      apply(data);
      return true;
    } catch {
      showToast('Network hiccup — please try again.');
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

  // Tab title + optional desktop notification when it becomes your turn.
  let wasMyTurn = false;
  $effect(() => {
    document.title = `${myTurn ? '● Your turn · ' : ''}${view.name} · Hearts Table`;
    if (myTurn && !wasMyTurn && notify && document.hidden && 'Notification' in window && Notification.permission === 'granted') {
      new Notification(`Your turn in ${view.name}`, { body: 'The table is waiting on you ♥', icon: '/favicon.svg', tag: view.id });
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
    const connect = () => {
      es?.close();
      es = new EventSource(`/api/games/${view.id}/events`);
      es.addEventListener('open', () => (connected = true));
      es.addEventListener('error', () => (connected = false));
      es.addEventListener('state', (e) => {
        connected = true;
        apply(JSON.parse((e as MessageEvent).data));
      });
      es.addEventListener('removed', () => {
        if (!leaving) location.href = '/games?notice=removed';
      });
      es.addEventListener('deleted', () => (location.href = '/games?notice=deleted'));
    };
    connect();

    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      if (!es || es.readyState === EventSource.CLOSED) connect();
      refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      es?.close();
      document.removeEventListener('visibilitychange', onVisible);
    };
  });
</script>

{#if !connected}
  <div class="conn" transition:fly={{ y: -10, duration: 200 }}>Reconnecting…</div>
{/if}

{#if view.status === 'lobby'}
  <Lobby {view} {act} {leave} {busy} />
{:else if view.status === 'active' && view.table}
  <Table {view} {act} {busy} {notify} {toggleNotify} onShowResult={() => (resultOpen = true)} />
{:else}
  <FinalResults {view} />
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
    bottom: 28px;
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

  .conn {
    position: fixed;
    top: 72px;
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
    backdrop-filter: blur(8px);
  }
</style>

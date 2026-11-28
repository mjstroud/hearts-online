<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { prefersReducedMotion } from 'svelte/motion';
  import { fly } from '../../lib/motion';
  import { type Card, cardLabel, isPenaltyCard } from '../../lib/engine/cards';
  import type { HandSummary } from '../../lib/engine/view';
  import type { MoveTiming, TimedMove } from '../../lib/latency.svelte';
  import { SHOT_MS, endedLive, finalTrickHoldMs } from '../../lib/moments';
  import { postJson } from '../../lib/post-json';
  import type { TauntShow } from '../../lib/taunt-client';
  import { dueHeld, routeTaunt, sendOutcome } from '../../lib/taunt-route';
  import { TAUNT_COOLDOWN_MS, type TauntEvent, type TauntRequest, tauntById } from '../../lib/taunts';
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
  // "Your turn" (tab title, alerts) means the table is waiting on you. The server says so, leaving out
  // seats it's about to play (a cat sitting in for you, or the last trick playing itself). A view from
  // a server older than this page has no yourTurn, so fall back to working it out.
  const myTurn = $derived.by(() => {
    if (typeof view.yourTurn === 'boolean') return view.yourTurn;
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
      const before = view;
      const shown = withPremove(next);
      view = shown;
      // A queued card shown played is a guess, like your own play: wait for the next player's real deadline.
      clockEndsAt = shown.moveClock ? deadlineOf(next) : null;
      const hand = next.lastHand;
      if (hand && hand.number > (before.lastHand?.number ?? 0)) handEnded(hand, endedLive(before.table, hand) ? before : null);
    }
  }

  /**
   * Predict the result of your own pass or play so the table reacts instantly.
   * The server's response (or the next live update) replaces the guess.
   */
  function predict(action: GameAction, base: GameView = view): GameView | null {
    const t = base.table;
    const seat = base.me.seat;
    if (!t || seat === null) return null;
    const n = base.players.length;
    if (action.type === 'play' && t.phase === 'playing' && t.turn === seat && t.current && t.legal.includes(action.card)) {
      const plays = [...t.current.plays, { seat, card: action.card }];
      const next = plays.length === n ? null : (seat + 1) % n;
      return {
        ...base,
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
        yourTurn: false,
        premove: null,
        // The next player's clock starts on the server; wait for its real deadline.
        moveClock: null,
      };
    }
    if (action.type === 'pass' && t.phase === 'passing' && !t.myPass) {
      return {
        ...base,
        table: { ...t, myPass: action.cards, passed: t.passed.map((p, s) => p || s === seat) },
        toAct: base.toAct.filter((s) => s !== seat),
        yourTurn: false,
      };
    }
    return null;
  }

  // ----- Queued cards. Queuing (or cancelling) shows at once: while the request is out, the card
  // is laid over every view that arrives, and if one of them puts you on turn, it's shown played,
  // as the server will play it the moment the request lands.
  let pendingPremove: { hand: number; trick: number; card: Card | null; id: number } | null = null;
  let premoveId = 0;

  function withPremove(next: GameView): GameView {
    const p = pendingPremove;
    const t = next.table;
    const seat = next.me.seat;
    if (!p || !t || seat === null || t.phase !== 'playing' || t.handNumber !== p.hand || t.trickNumber !== p.trick) return next;
    if (!t.current || t.current.plays.some((x) => x.seat === seat)) return next;
    if (p.card === null) return { ...next, premove: null };
    if (!t.myHand.includes(p.card)) return next;
    if (t.turn === seat) return (t.current.plays.length > 0 && predict({ type: 'play', card: p.card }, next)) || next;
    return { ...next, premove: p.card };
  }

  /** Whether `card`, from hand number `hand`, has been played by the time of `v`. */
  function playedBy(v: GameView, hand: number, card: Card): boolean {
    const t = v.table;
    if (t && t.handNumber === hand) return !t.myHand.includes(card);
    return (v.lastHand?.number ?? 0) >= hand;
  }

  async function premove(action: Extract<GameAction, { type: 'premove' }>): Promise<boolean> {
    const t = view.table;
    if (!t) return false;
    const id = ++premoveId;
    const hand = action.hand ?? t.handNumber;
    // The card a cancel is for, to say so if it was played before the cancel landed.
    const was = view.premove;
    pendingPremove = { hand, trick: action.trick ?? t.trickNumber, card: action.card, id };
    view = withPremove(view);
    const { ok, status, data } = await postJson(`/api/games/${view.id}/action`, action);
    // A newer queue or cancel may be on its way; it keeps its own overlay.
    if (pendingPremove?.id === id) pendingPremove = null;
    if (!ok) {
      showToast(status ? (data.error ?? 'Something went wrong.') : 'Network hiccup — please try again.');
      refresh();
      return false;
    }
    if (action.card === null && was && typeof data?.version === 'number' && playedBy(data, hand, was)) {
      showToast(`Too late: your ${cardLabel(was)} was already played.`);
    }
    apply(data);
    return true;
  }

  /** Your latest play or pass, timed for the playtest panel's latency readout (playtest tables only). */
  let timing: MoveTiming | null = null;
  /** The timer itself, loaded along with the playtest tools (onMount) rather than for every player. */
  let timeMove: ((action: TimedMove) => MoveTiming) | null = null;

  async function act(action: GameAction): Promise<boolean> {
    // Quiet, and never blocks the table: you can change your mind straight away.
    if (action.type === 'premove') return premove(action);
    const timer = view.dev && timeMove && (action.type === 'play' || action.type === 'pass') ? timeMove(action.type) : null;
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
      const { ok, status, data } = await postJson(`/api/games/${view.id}/action`, action);
      timer?.answered(ok && typeof data?.version === 'number' ? data.version : null);
      pendingBase = null;
      if (!status) {
        // Timed out or offline. The move may or may not have landed, so ask the server.
        showToast('Network hiccup — please try again.');
        refresh();
        return false;
      }
      if (!ok) {
        showToast(data.error ?? 'Something went wrong.');
        if (guess) refresh();
        return false;
      }
      apply(data);
      return true;
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

  // ----- The end of a hand
  // Watched live: the final trick stays on the felt for a moment, then any Sun or Moon, then the result.
  // On a page load or reconnect it goes straight to the result, after a Sun or Moon this device hasn't
  // celebrated yet. A tap anywhere skips ahead. Both are remembered per device (in memory too, in case
  // storage is blocked), so each result opens once and each Sun or Moon plays once.
  const shotKey = $derived(`hearts:seen-shot:${view.id}`);
  let seenInMemory = 0;
  let shotInMemory = 0;
  function seen(key: string, inMemory: number): number {
    try {
      return Math.max(inMemory, Number(localStorage.getItem(key) ?? 0));
    } catch {
      return inMemory;
    }
  }
  /** Save something for this device. Storage can be blocked or full, which is never worth an error. */
  function remember(key: string, value: number | string) {
    try {
      localStorage.setItem(key, String(value));
    } catch {}
  }

  /**
   * How far the hand end has got. `held` is the view from before the last card, when we watched it
   * land: after a game's last hand the server sends no table, so the felt stays up from that.
   */
  let ending = $state.raw<{ hand: HandSummary; stage: 'trick' | 'shot'; held: GameView | null } | null>(null);
  let endingTimer: ReturnType<typeof setTimeout> | undefined;
  /** A hand ended while the tab was hidden; it plays as a page load when the tab is back. */
  let endedHidden = false;

  // A Sun or Moon is rare, so its banner's code is fetched only when one is coming, during the final
  // trick's pause. If it can't load (say, an old tab after a deploy), the hand end skips to the result.
  type CelebrationModule = typeof import('./HandEndCelebration.svelte');
  let celebration: Promise<CelebrationModule> | undefined;
  const loadCelebration = () => (celebration ??= import('./HandEndCelebration.svelte'));
  let Celebration = $state.raw<CelebrationModule['default'] | null>(null);

  function handEnded(hand: HandSummary, before: GameView | null) {
    if (document.visibilityState === 'hidden') {
      endedHidden = true;
      return;
    }
    clearTimeout(endingTimer);
    resultOpen = false;
    const shot = hand.number > seen(seenKey, seenInMemory) && (hand.sun ?? hand.moon) !== null && hand.number > seen(shotKey, shotInMemory);
    if (shot) loadCelebration().catch(() => {});
    ending = { hand, stage: 'trick', held: before };
    if (before && hand.finalTrick) {
      // Long enough for each of the final trick's messages (auto-finished, the Queen, the Jack) to show.
      const who = { names: view.players.map((p) => p.name), me: view.me.seat, jack: view.settings.jackOfDiamonds };
      const hold = finalTrickHoldMs(before.table, hand.finalTrick, hand, who);
      endingTimer = setTimeout(() => (shot ? showShot() : endHand()), hold);
    }
    else if (shot) showShot();
    else endHand();
  }

  function showShot() {
    const current = ending;
    if (!current) return;
    // A download that stalls (a phone between networks) mustn't hold the hand end up: go on without the banner.
    const giveUp = setTimeout(() => ending === current && endHand(), 3000);
    loadCelebration().then(
      (module) => {
        clearTimeout(giveUp);
        // Skipped, or another hand ended, while it loaded.
        if (ending !== current) return;
        Celebration = module.default;
        ending = { ...current, stage: 'shot' };
        shotInMemory = current.hand.number;
        remember(shotKey, shotInMemory);
        // Reduced motion gets a still banner, so it needn't stay as long.
        // SHOT_MS is shared with the server, whose cats wait for the result before they react.
        endingTimer = setTimeout(endHand, prefersReducedMotion.current ? 1500 : SHOT_MS);
      },
      () => {
        clearTimeout(giveUp);
        if (ending === current) endHand();
      },
    );
  }

  /** The last step (or a skip straight to it): the result, unless this device has already seen it. */
  function endHand() {
    if (!ending) return;
    clearTimeout(endingTimer);
    const { hand } = ending;
    ending = null;
    // A skipped Sun or Moon doesn't come back on the next page load.
    if ((hand.sun ?? hand.moon) !== null && hand.number > shotInMemory) {
      shotInMemory = hand.number;
      remember(shotKey, shotInMemory);
    }
    if (hand.number > seen(seenKey, seenInMemory)) resultOpen = true;
  }

  // The tap that skips does nothing else, so it can't also pick a card or land on the result's backdrop.
  function skipEnding(e: Event) {
    if (!ending) return;
    e.preventDefault();
    e.stopPropagation();
    endHand();
  }

  // After a game's last hand, the felt (and its final trick) stays up until the hand end has played.
  const tableView = $derived(view.status === 'active' && view.table ? view : ending?.held?.table ? ending.held : null);
  const shooter = $derived(ending?.stage === 'shot' ? (ending.hand.sun ?? ending.hand.moon) : null);

  function closeResult() {
    resultOpen = false;
    seenInMemory = view.lastHand?.number ?? 0;
    remember(seenKey, seenInMemory);
  }

  // ----- Taunts: emotes and throws (src/lib/taunts.ts), during play only. They come over the live stream as
  // their own event, never as a game update, and the table draws them (TauntLayer.svelte).
  let tauntFeed = $state.raw<TauntShow[]>([]);
  /** When you may taunt again, on this device's clock. The server keeps the real cooldown. */
  let tauntCooldown = $state(0);
  let tauntsShown = 0;
  /** Taunts that arrived during the end of a hand or its result: they play afterwards, if still fresh. */
  let heldTaunts: { ev: TauntEvent; at: number }[] = [];
  /** This tab's own sends, by client id, so their echoes are skipped (they played when tapped). */
  const sentTaunts = new Set<string>();
  let tabId = '';
  let sends = 0;
  let tipped = false;

  function showTaunt(ev: TauntEvent) {
    const at = Date.now();
    tauntFeed = [...tauntFeed.filter((s) => at - s.at < 5000), { ...ev, id: ++tauntsShown, at }].slice(-6);
  }

  /** Once per device, the first time the table actually draws someone else's taunt. */
  function tauntShown(from: number) {
    if (from === view.me.userId || tipped) return;
    tipped = true;
    try {
      if (localStorage.getItem('hearts:taunt-tip')) return;
    } catch {}
    remember('hearts:taunt-tip', 1);
    showToast('Tap any avatar to send one back.');
  }

  function onTaunt(ev: TauntEvent) {
    const { route, cooldown } = routeTaunt(ev, {
      status: view.status,
      players: view.players,
      me: view.me.userId,
      hidden: document.hidden,
      holding: !!ending || resultOpen,
      sent: sentTaunts,
    });
    if (cooldown) tauntCooldown = Math.max(tauntCooldown, Date.now() + TAUNT_COOLDOWN_MS);
    if (route === 'hold') heldTaunts.push({ ev, at: Date.now() });
    else if (route === 'show') showTaunt(ev);
  }

  $effect(() => {
    if (ending || resultOpen) return;
    untrack(() => {
      const due = dueHeld(heldTaunts, Date.now(), { status: view.status, hidden: document.hidden });
      heldTaunts = [];
      due.forEach((h) => showTaunt(h.ev));
    });
  });

  /** Shows at once (ground rule 1) and never holds up the cards: it doesn't go through act(). */
  function sendTaunt(taunt: string, to: number | null) {
    const sentAt = Date.now();
    if (!tauntById(taunt) || sentAt < tauntCooldown) return;
    // Not crypto.randomUUID, which plain http (a phone on the LAN) doesn't have.
    tabId ||= crypto.getRandomValues(new Uint32Array(1))[0].toString(36);
    const cid = `${tabId}.${++sends}`;
    sentTaunts.add(cid);
    tauntCooldown = sentAt + TAUNT_COOLDOWN_MS;
    showTaunt({ taunt, from: view.me.userId, to, cid });
    const body: TauntRequest = { taunt, to, cid };
    postJson(`/api/games/${view.id}/taunt`, body).then((res) => {
      const { until, forget, toast } = sendOutcome(res, sentAt, Date.now());
      if (until !== null) tauntCooldown = until;
      if (forget) sentTaunts.delete(cid);
      if (toast) showToast(toast);
    });
  }

  // Alerts go through a service worker (public/sw.js), because Android Chrome won't let a page
  // construct a Notification. Every page also registers it (Layout.astro) so the site can be installed;
  // registering again here is harmless and gives us the registration to show alerts with.
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
    remember('hearts:notify', notify ? '1' : '0');
  }

  onMount(() => {
    try {
      notify = localStorage.getItem('hearts:notify') === '1' && Notification.permission === 'granted';
    } catch {}
    if (view.dev) import('../../lib/latency.svelte').then((m) => (timeMove = m.timeMove), () => {});

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
      source.addEventListener('taunt', (e) => {
        try {
          onTaunt(JSON.parse((e as MessageEvent).data));
        } catch {}
      });
    };
    connect();

    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      if (endedHidden && view.lastHand) {
        endedHidden = false;
        handEnded(view.lastHand, null);
      }
      if (!es || es.readyState === EventSource.CLOSED) connect();
      refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    // Opening the page, the last hand's result shows once (and its Sun or Moon) as before.
    if (view.lastHand) handEnded(view.lastHand, null);
    return () => {
      clearTimeout(endingTimer);
      clearTimeout(retryTimer);
      es?.close();
      document.removeEventListener('visibilitychange', onVisible);
    };
  });
</script>

{#if !connected}
  <div class="conn" class:at-table={!!tableView} transition:fly={{ y: -10, duration: 200 }}>Reconnecting…</div>
{/if}

{#if newVersion && connected}
  <button class="new-version" class:at-table={!!tableView} disabled={reloadAsked} onclick={() => (reloadAsked = true)}>
    {reloadAsked ? 'Refreshing…' : 'New version · tap to refresh'}
  </button>
{/if}

<svelte:window onclickcapture={skipEnding} onkeydowncapture={(e) => (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') && skipEnding(e)} />

{#if view.status === 'lobby'}
  <Lobby {view} {act} {leave} {busy} />
{:else if tableView}
  <!-- A held table is a picture of the past: nothing on it can be played. -->
  <Table
    view={tableView}
    {act}
    busy={busy || tableView !== view}
    {notify}
    {toggleNotify}
    {clockEndsAt}
    finalTrick={ending?.held ? ending.hand.finalTrick : null}
    finalBefore={ending?.held?.table ?? null}
    finalHand={ending?.held ? ending.hand : null}
    onShowResult={() => (resultOpen = true)}
    {tauntFeed}
    {tauntCooldown}
    {sendTaunt}
    {tauntShown}
  />
{:else}
  <FinalResults {view} {act} {busy} onShowResult={() => (resultOpen = true)} />
{/if}

{#if ending && shooter !== null && Celebration}
  <Celebration
    kind={ending.hand.sun !== null ? 'sun' : 'moon'}
    name={shooter === view.me.seat ? 'You' : (ending.hand.names?.[shooter] ?? view.players[shooter]?.name ?? `Seat ${shooter + 1}`)}
  />
{/if}

{#if resultOpen && view.lastHand}
  <HandResult gameId={view.id} summary={view.lastHand} players={view.players} onclose={closeResult} />
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

  /* A phone on its side at the table (Table.svelte): the header has scrolled away and the table fills the
     screen, so the pills sit in its top-right corner, over the chips rather than the trick, and narrow
     enough to clear the top seats. A toast sits above the hand, and taps go through it to the felt. Keep in
     step with SIDEWAYS in src/lib/phones.ts; src/lib/phones.test.ts checks. */
  @media (orientation: landscape) and (max-height: 500px) and (min-width: 540px) {
    .conn.at-table,
    .new-version.at-table {
      top: calc(6px + env(safe-area-inset-top, 0px));
      left: auto;
      right: max(20px, env(safe-area-inset-right, 0px));
      max-width: calc(50% - 184px);
      transform: none;
    }

    .toast {
      bottom: calc(84px + env(safe-area-inset-bottom, 0px));
      pointer-events: none;
    }
  }
</style>

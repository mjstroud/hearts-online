<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { prefersReducedMotion } from 'svelte/motion';
  import { type Card, QUEEN_OF_SPADES, SUIT_SYMBOL, cardLabel, isPenaltyCard, suitOf } from '../../lib/engine/cards';
  import { type Trick, followPlays, queueSuit, trickWinner } from '../../lib/engine/hand';
  import type { HandSummary, TableView } from '../../lib/engine/view';
  import { type Glow, WATCH_LEVEL, glowOf } from '../../lib/engine/watch';
  import {
    ARRIVE_MS,
    MIN_SHOW_MS,
    type Message,
    type Queued,
    type Wash,
    type Who,
    arrivalDelays,
    detectMoments,
    enqueue,
    finalMoments,
    restingMessage,
    takeNext,
  } from '../../lib/moments';
  import { fade, fly, scale } from '../../lib/motion';
  import { SIDEWAYS } from '../../lib/phones';
  import type { TauntShow } from '../../lib/taunt-client';
  import type { GameAction, GameView } from '../../lib/types';
  import { signed } from '../../lib/ui';
  import Avatar from '../Avatar.svelte';
  import PlayingCard from '../PlayingCard.svelte';
  import DeckToggle from '../DeckToggle.svelte';
  import Standings from './Standings.svelte';
  import WatchGlow from './WatchGlow.svelte';

  // The playtest panel loads only on playtest tables, so players never download it.
  // One shared promise, so live updates never restart the load (or reset the panel).
  let devPanel: Promise<typeof import('./DevPanel.svelte')> | undefined;
  const loadDevPanel = () => (devPanel ??= import('./DevPanel.svelte'));

  // Taunts' tray and overlay load on the first taunt, or the first touch on an avatar. If that fails (an
  // old tab after a deploy, its chunks gone), taunts simply don't show and the avatars stop being buttons.
  let Taunts = $state.raw<(typeof import('./TauntLayer.svelte'))['default'] | null>(null);
  let tauntsGone = $state(false);
  let tauntLayer: Promise<unknown> | undefined;
  const loadTaunts = () =>
    (tauntLayer ??= import('./TauntLayer.svelte').then(
      (m) => (Taunts = m.default),
      () => (tauntsGone = true),
    ));

  interface Props {
    view: GameView;
    act: (a: GameAction) => Promise<boolean>;
    busy: boolean;
    notify: boolean;
    toggleNotify: () => void;
    /** When the move timer runs out, on this device's clock (null = no timer running). */
    clockEndsAt: number | null;
    onShowResult: () => void;
    /**
     * The hand's final trick (the last one the table saw played), while the hand-end sequence holds
     * it on the felt in place of the usual centre.
     */
    finalTrick?: Trick | null;
    /** With finalTrick: the last view of that hand this tab saw, from before its final trick finished. */
    finalBefore?: TableView | null;
    /** With finalTrick: that hand's summary. */
    finalHand?: HandSummary | null;
    /** Taunts to draw, newest last (Game.svelte keeps them). */
    tauntFeed?: TauntShow[];
    /** When you may taunt again, on this device's clock. */
    tauntCooldown?: number;
    /** Sends an emote (`to` null) or a throw. Without it, the avatars aren't buttons. */
    sendTaunt?: (taunt: string, to: number | null) => void;
  }
  let {
    view,
    act,
    busy,
    notify,
    toggleNotify,
    clockEndsAt,
    onShowResult,
    finalTrick = null,
    finalBefore = null,
    finalHand = null,
    tauntFeed = [],
    tauntCooldown = 0,
    sendTaunt,
  }: Props = $props();

  type Pos = 'bottom' | 'left' | 'top' | 'right' | 'top-left' | 'top-right';
  const POS4: Pos[] = ['bottom', 'left', 'top', 'right'];
  const POS5: Pos[] = ['bottom', 'left', 'top-left', 'top-right', 'right'];
  // Direction a card flies in from, per seat position.
  const FROM: Record<Pos, { x: number; y: number }> = {
    bottom: { x: 0, y: 140 },
    top: { x: 0, y: -140 },
    left: { x: -160, y: 0 },
    right: { x: 160, y: 0 },
    'top-left': { x: -110, y: -110 },
    'top-right': { x: 110, y: -110 },
  };

  const t = $derived(view.table!);
  const n = $derived(view.players.length);
  const me = $derived(view.me.seat);
  const anchor = $derived(me ?? 0);
  const posOf = (seat: number): Pos => (n === 5 ? POS5 : POS4)[(seat - anchor + n) % n];
  const nameOf = (seat: number | null) => (seat === null ? '' : seat === me ? 'You' : (view.players[seat]?.name ?? ''));
  const list = (names: string[]) =>
    names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;

  const myTurn = $derived(t.phase === 'playing' && me !== null && t.turn === me);
  /** Your card is down in the trick in progress. */
  const iPlayed = $derived(me !== null && !!t.current?.plays.some((p) => p.seat === me));
  const needPass = $derived(t.phase === 'passing' && me !== null && !t.myPass);
  const leading = $derived(!!t.current && t.current.plays.length === 0);
  const leadSuit = $derived(t.current && t.current.plays.length ? suitOf(t.current.plays[0].card) : null);

  // ----- Move timer and autopilot
  let nowMs = $state(Date.now());
  $effect(() => {
    if (clockEndsAt === null) return;
    nowMs = Date.now();
    const tick = setInterval(() => (nowMs = Date.now()), 250);
    return () => clearInterval(tick);
  });
  const secondsLeft = $derived(clockEndsAt === null ? null : Math.max(0, Math.ceil((clockEndsAt - nowMs) / 1000)));
  const clockText = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  const seatOf = (seat: number | null) => (seat === null ? undefined : view.players.find((p) => p.seat === seat));
  const onAutopilot = $derived(!!seatOf(me)?.autopilot);
  const everyoneAway = $derived(view.players.every((p) => p.isBot || p.autopilot));
  /** Seats whose own clock is running (people on turn, not cats or autopilot). */
  const timed = (seat: number) => {
    const p = seatOf(seat);
    return secondsLeft !== null && view.toAct.includes(seat) && !!p && !p.isBot && !p.autopilot;
  };

  // ----- Selection (pass picks, or a tap-to-confirm play or queue on touch screens)
  let selected = $state<Card[]>([]);
  const selKey = $derived(`${t.handNumber}:${t.phase}:${t.trickNumber}:${iPlayed}`);
  $effect(() => {
    selKey;
    selected = [];
  });
  // When your turn arrives, a card you'd picked to queue stays picked if you may play it ("Play 7♣").
  $effect(() => {
    if (!myTurn) return;
    untrack(() => {
      if (selected.some((c) => !t.legal.includes(c))) selected = [];
    });
  });

  const finePointer = typeof window !== 'undefined' && window.matchMedia('(hover: hover) and (pointer: fine)').matches;

  async function pass() {
    if (selected.length !== t.passCount) return;
    await act({ type: 'pass', cards: selected });
  }

  async function play(card: Card) {
    selected = [];
    await act({ type: 'play', card });
  }

  async function queueCard(card: Card) {
    const ok = await act({ type: 'premove', card, hand: t.handNumber, trick: t.trickNumber });
    if (ok && selected[0] === card) selected = [];
  }

  function cancelQueue() {
    selected = [];
    act({ type: 'premove', card: null, hand: t.handNumber, trick: t.trickNumber });
  }

  function clickCard(card: Card) {
    if (busy) return;
    if (needPass) {
      if (selected.includes(card)) selected = selected.filter((c) => c !== card);
      else if (selected.length < t.passCount) selected = [...selected, card];
      else selected = [...selected.slice(1), card];
      return;
    }
    if (myTurn) {
      if (!t.legal.includes(card)) return;
      if (finePointer || selected[0] === card) play(card);
      else selected = [card];
      return;
    }
    if (!canQueue) return;
    // Tap the queued card to cancel it; queuing another one replaces it.
    if (card === queuedCard) cancelQueue();
    else if (!queueable.includes(card)) return;
    else if (finePointer || selected[0] === card) queueCard(card);
    else selected = [card];
  }

  // ----- The felt: the trick in progress, else the last finished one until the next lead (on a
  // cold open too), or the hand's final trick while the hand-end sequence holds it.
  const lastOfHand = $derived(t.phase === 'playing' && t.cribWinner !== null ? t.lastTrick : null);
  const shown = $derived(finalTrick ?? (t.current && t.current.plays.length > 0 ? t.current : lastOfHand));
  const finished = $derived(!!shown && shown.winner !== null);
  /** Who takes the trick on the felt, or is winning it once two cards are down. */
  const topSeat = $derived(shown ? (shown.winner ?? (shown.plays.length > 1 ? trickWinner(shown) : null)) : null);
  const led = $derived(shown?.plays[0] ?? null);
  // Your own break shows at once (the prediction sets heartsBroken); the server then names the card.
  const breaker = $derived(t.heartsBrokenBy?.card ?? t.current?.plays.find((p) => isPenaltyCard(p.card))?.card);
  const trickKey = (tr: Trick | null) => tr?.plays.map((p) => p.card).join('') ?? '';

  // ----- Whether the latest update is one the table watched: not the first view (a page load), not
  // across a gap in versions (a reconnect or refresh catching up: every game change is one version),
  // and not while the page is hidden or just after it comes back into view. Worked out before the
  // felt redraws, so its cards know whether to slide in.
  let watched = false;
  let seenVersion: number | null = null;
  let quietUntil = 0;
  $effect.pre(() => {
    const v = view.version;
    untrack(() => {
      watched = seenVersion !== null && v - seenVersion <= 1 && !document.hidden && Date.now() >= quietUntil;
      seenVersion = v;
    });
  });

  // ----- Cards that land in one update (queued cards firing together)
  // slide in one after another, in play order, so the order still reads; on trick 1 too, as the crib
  // gives way. Cards already on the felt don't wait. An update the table didn't watch shows the felt
  // as it is, and reduced motion has the cards appear together.
  let onFelt: Card[] = [];
  const feltKey = $derived(trickKey(shown));
  const arrival = $derived.by(() => {
    feltKey;
    return untrack(() => {
      const cards = shown?.plays.map((p) => p.card) ?? [];
      const delays = arrivalDelays(prefersReducedMotion.current || !watched ? cards : onFelt, shown);
      onFelt = cards;
      return { delays, slide: watched };
    });
  });
  const waitFor = (card: Card | undefined) => (card && arrival.delays.get(card)) || 0;
  const landed = $derived(Math.max(0, ...arrival.delays.values()));
  // The winner's glow, the losers' fade and "takes it" wait until every card has landed.
  let settledKey = $state('');
  const settled = $derived(landed === 0 || settledKey === feltKey);
  $effect(() => {
    const key = feltKey;
    if (!landed) return;
    const timer = setTimeout(() => (settledKey = key), landed + ARRIVE_MS);
    return () => clearTimeout(timer);
  });

  // ----- Trick inspector: the cards in play order, who played each, the led card and the winner
  let inspect = $state<'shown' | 'last' | null>(null);
  let inspectLead: Card | undefined;
  const inspected = $derived(inspect === 'last' ? lastOfHand : inspect ? shown : null);
  const inspNo = $derived(inspected === t.current ? t.trickNumber : t.trickNumber - 1);
  const inspTop = $derived(inspected?.plays.length ? (inspected.winner ?? trickWinner(inspected)) : null);
  function toggleInspect(which: 'shown' | 'last') {
    const tr = which === 'last' ? lastOfHand : shown;
    inspectLead = tr?.plays[0]?.card;
    inspect = inspect === which || !inspectLead || finalTrick ? null : which;
    tray = null;
  }
  // Close it once its trick leaves the felt (the next lead, or another trick finishing).
  $effect(() => {
    if (inspect && inspected?.plays[0]?.card !== inspectLead) inspect = null;
  });
  const closeOutside = (e: PointerEvent) => {
    const at = e.target as Element;
    if (inspect && !at.closest?.('[data-insp]')) inspect = null;
    if (tray !== null && !at.closest?.('[data-tray]')) tray = null;
  };

  // ----- Taunts, during play: tap your own avatar for emotes, or someone else's to throw at them. The tray
  // opens where the inspector does, so opening one closes the other.
  const canTaunt = $derived(view.status === 'active' && me !== null && !!sendTaunt && !tauntsGone);
  /** Whose avatar the tray is open for (yours for emotes), by user id. */
  let tray = $state<number | null>(null);
  const trayFor = $derived.by(() => {
    const p = view.players.find((x) => x.userId === tray);
    return p ? { to: p.seat === me ? null : p.userId, name: p.name } : null;
  });
  function openTray(userId: number) {
    if (!canTaunt) return;
    loadTaunts();
    inspect = null;
    tray = tray === userId ? null : userId;
  }
  $effect(() => {
    if (tauntFeed.length) loadTaunts();
  });

  // ----- One message slot. Moments queue by priority and each stays up at least MIN_SHOW_MS;
  // with nothing queued it says who took the trick on the felt (and "your lead").
  // For a finished hand, the names of who played it: after the host removes someone, their hands stay theirs.
  const handName = (s: HandSummary | null, seat: number) => s?.names?.[seat] ?? view.players[seat]?.name ?? '';
  const who = (s: HandSummary | null = null): Who => ({ names: view.players.map((p) => handName(s, p.seat)), me, jack: view.settings.jackOfDiamonds });
  let queue: Queued[] = [];
  let queued = $state<Message | null>(null);
  let slotTimer: ReturnType<typeof setTimeout> | undefined;
  function pump() {
    clearTimeout(slotTimer);
    const { next, rest, wait } = takeNext(queue, Date.now());
    queue = rest;
    queued = next;
    if (next?.wash) flash(next.wash);
    if (next || wait !== null) slotTimer = setTimeout(pump, next ? MIN_SHOW_MS : wait!);
  }
  function say(messages: Message[]) {
    if (!messages.length) return;
    queue = enqueue(queue, messages, Date.now());
    if (!queued) pump();
  }
  function hush() {
    clearTimeout(slotTimer);
    queue = [];
    queued = null;
  }
  // One-shot effects, all on the one fx keyframe below; each sets its own colours and path.
  // A warm band across the felt for hearts, and a dark ring from the Q♠. (A Sun or Moon shot is Game.svelte's
  // full-screen celebration, not a felt effect.)
  const FX: Record<Wash | 'ripple', [string, number]> = {
    hearts: ['--fx:linear-gradient(100deg,#0000 25%,#ff6b4a4d,#0000 75%);--t0:translateX(-70%);--t1:translateX(70%);--d:.9s', 900],
    ripple: ['inset:-25%;border-radius:50%;--fx:radial-gradient(#0000 38%,#14121073 52%,#0000 68%);--t0:scale(.3);--t1:scale(1.3);--d:.6s', 600],
  };
  let washFx = $state<{ kind: Wash; id: number } | null>(null);
  let rippleFx = $state<{ card: Card; id: number } | null>(null);
  let fxId = 0;
  function flash(kind: Wash) {
    const id = ++fxId;
    washFx = { kind, id };
    setTimeout(() => washFx?.id === id && (washFx = null), FX[kind][1]);
  }
  function ripple(card: Card) {
    const id = ++fxId;
    rippleFx = { card, id };
    setTimeout(() => rippleFx?.id === id && (rippleFx = null), FX.ripple[1]);
  }

  // ----- Table moments, from consecutive views, so only changes the table watched happen (see
  // `watched` above). Each waits for the card it's about to land: hearts breaking for that card,
  // the rest for the card that closed the trick.
  let prevT: TableView | null = null;
  let finalKey = '';
  const later = (ms: number, fn: () => void) => (ms ? setTimeout(fn, ms) : fn());
  $effect(() => {
    const next = t;
    const ft = finalTrick;
    untrack(() => {
      const prev = prevT;
      const live = !!prev && watched;
      if (next !== prev) {
        prevT = next;
        if (prev && prev.handNumber !== next.handNumber) {
          hush();
          inspect = null;
        }
        if (live) {
          const m = detectMoments(prev, next, who());
          const q = m.ripple;
          if (q) later(waitFor(q), () => ripple(q));
          const closing = waitFor(next.lastTrick?.plays.at(-1)?.card);
          say(m.messages.map((x) => ({ ...x, delay: x.kind === 'hearts' ? waitFor(next.heartsBrokenBy?.card) : closing })));
        }
      }
      if (trickKey(ft) !== finalKey) {
        finalKey = trickKey(ft);
        hush();
        inspect = null;
        // The end of a hand takes over the table (and swallows taps), so the taunt tray makes way.
        tray = null;
        if (ft && live) {
          // The next hand is dealt with the last card, so a Q♠ landing in the final trick gets its ripple here.
          if (ft.plays.some((p) => p.card === QUEEN_OF_SPADES) && !finalBefore?.current?.plays.some((p) => p.card === QUEEN_OF_SPADES)) {
            later(waitFor(QUEEN_OF_SPADES), () => ripple(QUEEN_OF_SPADES));
          }
          const closing = waitFor(ft.plays.at(-1)?.card);
          say(finalMoments(ft, finalHand, who(finalHand)).map((x) => ({ ...x, delay: closing })));
        }
      }
    });
  });
  onMount(() => {
    const quiet = () => {
      if (!document.hidden) quietUntil = Date.now() + 2500;
    };
    document.addEventListener('visibilitychange', quiet);
    return () => {
      document.removeEventListener('visibilitychange', quiet);
      clearTimeout(slotTimer);
    };
  });

  // ----- The Sun or Moon glow behind a watcher's avatar, from public facts only (see engine/watch.ts).
  // While the hand-end sequence holds the final trick, `t` is already the next hand: a shot keeps its
  // glow, blazing, until the celebration, and a run that ended on the last trick goes out.
  const glowNow = $derived.by((): Glow | null => {
    if (!finalTrick) return glowOf(t);
    const s = view.settings.showWatches ? finalHand : null;
    if (s?.sun != null) return { seat: s.sun, kind: 'sun', level: 3 };
    if (s?.moon != null) return { seat: s.moon, kind: 'moon', level: 3 };
    return null;
  });
  type Lit = Glow & { ignite: boolean; flare: number };
  /** The glow on show, and one going out while a new one lights (on another seat, or a Moon after the Sun). */
  let glow = $state<Lit | null>(null);
  let fading = $state<Glow | null>(null);
  let glowTarget: Glow | null = null;
  /** The glow came from the held final trick: when the hand-end sequence lets go, it simply goes. */
  let glowHeld = false;
  let glowTimer: ReturnType<typeof setTimeout> | undefined;
  let fadeTimer: ReturnType<typeof setTimeout> | undefined;
  /** Long enough for the slowest way out (WatchGlow's sink). */
  const FADE_MS = 1200;
  // It changes once the card that closed the trick has landed, so it never gets ahead of the felt.
  // Only changes the table watched light up, flare or go out; a page load or a reconnect just shows it.
  $effect(() => {
    const next = glowNow;
    // Read here, so the hand-end sequence letting go always runs this, even when no glow changes.
    const held = !!finalTrick;
    untrack(() => {
      const was = glowTarget;
      const released = glowHeld && !held;
      glowHeld = held;
      if (next?.seat === was?.seat && next?.kind === was?.kind && next?.level === was?.level) return;
      glowTarget = next;
      const live = watched && !released;
      const apply = () => {
        const cur = glow;
        if (cur && next && cur.seat === next.seat && cur.kind === next.kind) {
          glow = { ...next, ignite: cur.ignite, flare: cur.flare + (live && next.level > cur.level ? 1 : 0) };
          return;
        }
        // Anything else means the old run is over: another seat's run, or the Sun broken with the Moon left.
        if (cur && live) {
          clearTimeout(fadeTimer);
          fading = cur;
          fadeTimer = setTimeout(() => (fading = null), FADE_MS);
        }
        glow = next && { ...next, ignite: live, flare: 0 };
      };
      clearTimeout(glowTimer);
      const closing = (finalTrick ?? t.lastTrick)?.plays.at(-1)?.card;
      const wait = live && !prefersReducedMotion.current ? waitFor(closing) + ARRIVE_MS : 0;
      if (wait) glowTimer = setTimeout(apply, wait);
      else apply();
    });
  });
  /** The corner names the watcher once the glow is a real watch. */
  const watch = $derived(!finalTrick && glow && glow.level >= WATCH_LEVEL ? glow : null);
  onMount(() => () => {
    clearTimeout(glowTimer);
    clearTimeout(fadeTimer);
  });

  // ----- Responsive sizing
  // Card sizes and the fan's spacing come from container queries in the CSS, not measured widths, so the
  // server-rendered page is already laid out for the phone it's on: nothing overflows or jumps on load.
  const handCount = $derived(t.myHand.length);
  const mid = $derived((handCount - 1) / 2);
  // A gentle fan: a little rotation and a shallow arc (the CSS curves it by 0.3px per card from the middle, squared).
  const spread = $derived(Math.min(1.5, 15 / Math.max(handCount, 1)));
  const arcDrop = $derived(mid ** 2 * 0.3);
  /** Playtest only: the face-up crib's height, measured to pick the small-card style. */
  let cribH = $state(0);

  // A phone on its side: the table fits the screen, so scroll past the site header and centre it, with the
  // room the CSS leaves above and below. Back to the top when it turns upright again, or the pinned header
  // would cover the top seats. Only when the table appears or the layout flips (the phone turns, or a window
  // is resized across the line), never on a game update. SIDEWAYS is the same query as the CSS at the end.
  let layoutEl: HTMLDivElement | undefined;
  let arenaEl: HTMLDivElement | undefined;
  onMount(() => {
    const sideways = window.matchMedia(SIDEWAYS);
    let again: ReturnType<typeof setTimeout> | undefined;
    const place = () => {
      let top = 0;
      if (sideways.matches && layoutEl && arenaEl) {
        const from = layoutEl.getBoundingClientRect().top + window.scrollY;
        const pad = parseFloat(getComputedStyle(layoutEl).paddingTop) || 0;
        const to = arenaEl.getBoundingClientRect().bottom + window.scrollY + pad;
        // Centred; on a screen taller than the table, never so high that the header's edge shows.
        top = Math.max(from, from - (window.innerHeight - (to - from)) / 2);
      }
      // Plain numbers: some phone browsers reject a scroll `behavior` they don't know.
      window.scrollTo(0, top);
    };
    const fit = (turned: boolean) => {
      if (!sideways.matches && !turned) return;
      // Measuring lays the page out for its new shape. Once more when a turning phone (or a late font) has
      // settled its size and scroll position.
      place();
      clearTimeout(again);
      again = setTimeout(place, 400);
    };
    const turn = () => fit(true);
    fit(false);
    sideways.addEventListener('change', turn);
    return () => {
      sideways.removeEventListener('change', turn);
      clearTimeout(again);
    };
  });

  // Everyone holds the same number of cards, so one counter covers the whole table.
  const tricksLeft = $derived(t.phase === 'playing' ? t.totalTricks - t.trickNumber + 1 : t.totalTricks);

  // You sit at the bottom, so "left" is screen-left.
  function passArrow(label: string): string {
    if (label === 'Left') return '←';
    if (label === 'Right') return '→';
    if (label === 'Across') return '↑';
    if (label === 'Left across') return '↖';
    if (label === 'Right across') return '↗';
    return '·';
  }

  // Playtest-only visibility toggles (the dev panel owns the switches).
  let showHands = $state(true);
  let showCrib = $state(true);
  const manualBots = $derived(view.dev?.botMode === 'manual');

  /** The last trick plays itself: every card in it is forced, so the server plays them one at a time after the usual pause. */
  const lastAuto = $derived(
    t.phase === 'playing' && t.trickNumber === t.totalTricks && !!view.settings.autoPlayLast && !manualBots && me !== null && !onAutopilot,
  );
  /** The message slot: a queued moment, else who took the trick on the felt (and "your lead" when it's yours to lead). */
  const slot = $derived(queued ?? restingMessage(finished && settled ? shown : null, who(), myTurn && leading && !finalTrick && !lastAuto));

  // ----- Queuing a card to play the moment your turn arrives: once the lead suit is known (trick 1's
  // is always clubs), and never in the last trick, which plays itself. Only cards you could play
  // against that suit can be queued.
  const qSuit = $derived(t.phase === 'playing' && me !== null ? queueSuit(t.current, t.trickNumber === 1, me, t.turn) : null);
  const canQueue = $derived(qSuit !== null && !myTurn && !onAutopilot && !lastAuto && !finalTrick);
  const queueable = $derived(canQueue && qSuit ? followPlays(t.myHand, qSuit, t.trickNumber === 1, view.settings) : []);
  /** Your queued card, while it waits for your turn. */
  const queuedCard = $derived(canQueue && view.premove && t.myHand.includes(view.premove) ? view.premove : null);
  /** "{Name} is up. Tap a card…": the name is cut short rather than wrapping the hint. */
  const queueHint = $derived(canQueue && !queuedCard && !manualBots && t.turn !== null);

  const fresh = (card: Card) => t.received.includes(card) && t.myHand.length === t.totalTricks;

  const hint = $derived.by(() => {
    if (me === null) return 'You are watching this game.';
    if (onAutopilot) {
      if (everyoneAway) return 'Everyone stepped away, so the table is paused until someone is back.';
      return 'You ran out of time, so a cat is playing for you until you’re back.';
    }
    if (t.phase === 'passing') {
      if (needPass) {
        const dir = t.passLabel.toLowerCase();
        return `Pick ${t.passCount} cards to pass ${dir} to ${nameOf(t.passTarget)}.`;
      }
      const waiting = t.passed.flatMap((p, s) => (p ? [] : [nameOf(s)]));
      if (manualBots) return `Waiting for ${list(waiting)} to pass. Pass for them in the playtest panel, or press AI move.`;
      return `Waiting for ${list(waiting)} to pass…`;
    }
    // A tap on your last card still plays it, but there's no need.
    if (lastAuto) return iPlayed ? 'Last trick · the cards play themselves' : 'Last trick · your card plays itself';
    if (myTurn) {
      if (leading) {
        if (t.trickNumber === 1) return `Lead the ${cardLabel(t.legal[0])} to open the hand.`;
        if (!t.heartsBroken && t.myHand.some(isPenaltyCard) && t.legal.some((c) => !isPenaltyCard(c)))
          return 'Your lead. Hearts haven’t been broken yet.';
        return 'Your lead.';
      }
      if (leadSuit && t.myHand.some((c) => suitOf(c) === leadSuit)) return `Your turn. Follow suit with a ${SUIT_SYMBOL[leadSuit]}.`;
      if (leadSuit && t.trickNumber === 1 && view.settings.noPointsOnFirstTrick)
        return `You’re out of ${SUIT_SYMBOL[leadSuit]}. No points on the first trick.`;
      return `You’re out of ${leadSuit ? SUIT_SYMBOL[leadSuit] : 'that suit'}. Play anything.`;
    }
    if (queuedCard) return `${cardLabel(queuedCard)} plays when it’s your turn`;
    if (manualBots) return `${nameOf(t.turn)} is up. Play a card for them in the playtest panel, or press AI move.`;
    // When you can queue a card, the template shows queueHint's line instead of this one.
    return `Waiting for ${nameOf(t.turn)} to play…`;
  });
</script>

<svelte:window
  onpointerdown={closeOutside}
  onkeydown={(e) => {
    if (e.key !== 'Escape') return;
    inspect = null;
    tray = null;
  }}
/>

<div class="container wide layout" bind:this={layoutEl}>
  <div class="main">
    <div class="statusbar">
      <h1 class="game-name">{view.name}</h1>
      <div class="chips">
        {#if view.mode === 'playtest'}<span class="badge sky">⚗ Playtest</span>{/if}
        {#if view.endAfterHand}<span class="badge gold" title="The host is ending the game when this hand is finished">⚑ Final hand</span>{/if}
        <span class="badge num">Hand {t.handNumber}</span>
        <span class="badge" class:gold={t.phase === 'passing'}>⇄ {t.passLabel}</span>
      </div>
    </div>

    <div class="arena" class:five={n === 5} bind:this={arenaEl}>
      <div class="felt">
        {#if washFx}{#key washFx.id}<div class="fx" style={FX[washFx.kind][0]}></div>{/key}{/if}

        <div class="center">
          {#if shown}
            <!-- Tap (or click) the trick for who played what. -->
            <div
              class="trick"
              data-insp
              role="button"
              tabindex="0"
              aria-label="Who played each card"
              onclick={() => toggleInspect('shown')}
              onkeydown={(e) => {
                if (e.key !== 'Enter' && e.key !== ' ') return;
                e.preventDefault(); // Space would scroll the page
                toggleInspect('shown');
              }}
            >
              {#each shown.plays as p, i (p.card)}
                {@const pos = posOf(p.seat)}
                {@const wait = waitFor(p.card)}
                <!-- A card waiting its turn to slide in stays out of sight until then. Global, so trick 1's
                     cards slide in too, though the trick appears along with them. -->
                <div
                  class={`played at-${pos}`}
                  class:led={i === 0}
                  class:winner={settled && topSeat === p.seat}
                  class:loser={settled && finished && topSeat !== p.seat}
                  in:fly|global={{ ...FROM[pos], duration: arrival.slide ? ARRIVE_MS : 0, opacity: wait ? 0 : 0.2, delay: wait }}
                  out:fade={{ duration: 160 }}
                >
                  <PlayingCard card={p.card} width="var(--tw)" jackScored={view.settings.jackOfDiamonds} />
                  {#if rippleFx?.card === p.card}{#key rippleFx.id}<span class="fx" style={FX.ripple[0]}></span>{/key}{/if}
                </div>
              {/each}
            </div>
          {:else if t.phase === 'passing'}
            <div class="center-note" in:fade>
              <span class="big-arrow" aria-hidden="true">{passArrow(t.passLabel)}</span>
              <strong>Pass {t.passLabel.toLowerCase()}</strong>
              <span>{t.passed.filter(Boolean).length} of {n} ready</span>
            </div>
          {:else if t.cribWinner === null}
            <div class="crib" in:fade title="The crib goes to whoever wins the first trick">
              {#if view.dev && showCrib}
                <!-- The row is one card tall, so its height says whether the cards are under 56px wide (78.4px tall). -->
                <div class="crib-open" bind:clientHeight={cribH}>
                  {#each view.dev.crib as c (c)}<PlayingCard
                      card={c}
                      width="calc(var(--tw) * 0.62)"
                      compact={cribH ? cribH < 78.4 : undefined}
                      jackScored={view.settings.jackOfDiamonds}
                    />{/each}
                </div>
              {:else}
                <div class="crib-stack">
                  {#each Array(Math.min(t.cribSize, 4)) as _, i}
                    <span style={`--i: ${i}`}><PlayingCard width="calc(var(--tw) * 0.72)" /></span>
                  {/each}
                </div>
              {/if}
              <span class="crib-label">Crib · {t.cribSize} cards</span>
            </div>
          {/if}
          {#if slot}
            {#key slot.pre + slot.name + slot.post}
              <div class="msg" role="status" in:scale={{ start: 0.9, duration: 180 }}>{slot.pre}<span class="nm">{slot.name}</span>{slot.post}</div>
            {/key}
          {/if}
        </div>
      </div>

      <!-- The status cluster: tricks left, whether hearts are broken (and by the Q♠), and any watch. -->
      <div class="counter" title={t.phase === 'passing' ? 'Cards in each hand' : 'Tricks left in this hand, including this one'}>
        <strong class="num">{tricksLeft}</strong>
        <span class="counter-text">
          <span>{t.phase === 'passing' ? 'cards each' : tricksLeft === 1 ? 'trick left' : 'tricks left'}</span>
          <span class="dots" aria-hidden="true">
            {#each Array(t.totalTricks) as _, i (i)}<i class:on={i < tricksLeft}></i>{/each}
          </span>
        </span>
        {#if t.phase === 'playing'}
          <span class="facts">
            <span
              class="heart"
              class:red={!t.heartsBroken || breaker !== 'QS'}
              class:q={t.heartsBroken && breaker === 'QS'}
              title={t.heartsBroken ? 'Hearts are broken' : 'Hearts aren’t broken yet'}
              >{t.heartsBroken ? (breaker === 'QS' ? 'Q♠\uFE0E' : '♥\uFE0E') : '♡'}</span
            >
            {#if watch}
              <span class="watch" title={watch.kind === 'sun' ? 'Sun watch: has won every trick so far' : 'Moon watch: has taken every point card so far'}
                >{watch.kind === 'sun' ? '☀\uFE0E' : '☾'}&nbsp;<span class="nm">{nameOf(watch.seat)}</span></span
              >
            {/if}
          </span>
        {/if}
      </div>

      {#if lastOfHand && !finalTrick}
        <button class="counter last" data-insp aria-expanded={inspect === 'last'} onclick={() => toggleInspect('last')}>
          <span class="counter-text"><span>Last trick</span></span>
        </button>
      {/if}

      {#each view.players as p (p.userId)}
        {@const pos = posOf(p.seat)}
        {@const acting = view.toAct.includes(p.seat)}
        <div
          class={`seat at-${pos}`}
          class:acting
          class:me={p.seat === me}
          class:glowing={glow?.seat === p.seat || fading?.seat === p.seat}
          data-user={p.userId}
        >
          <div class="plaque">
            <!-- During play, a tap on an avatar opens the taunt tray: emotes on yours, throws at anyone else.
                 It's a button whenever it can be focused. -->
            <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
            <span
              class="seat-avatar"
              role={canTaunt ? 'button' : undefined}
              tabindex={canTaunt ? 0 : undefined}
              aria-label={canTaunt ? (p.seat === me ? 'Send an emote' : `Throw something at ${p.name}`) : undefined}
              data-tray={canTaunt || undefined}
              onpointerdown={() => canTaunt && loadTaunts()}
              onclick={() => openTray(p.userId)}
              onkeydown={(e) => {
                if (e.key !== 'Enter' && e.key !== ' ') return;
                e.preventDefault(); // Space would scroll the page
                openTray(p.userId);
              }}
            >
              {#if fading?.seat === p.seat}{#key fading}<WatchGlow kind={fading.kind} level={fading.level} out />{/key}{/if}
              {#if glow?.seat === p.seat}{#key glow.kind}<WatchGlow kind={glow.kind} level={glow.level} ignite={glow.ignite} flare={glow.flare} />{/key}{/if}
              <Avatar name={p.name} seed={p.username} isBot={p.isBot} src={p.avatar} size="var(--av)" />
              {#if !p.isBot}<span class="presence" class:on={p.online}></span>{/if}
              {#if led && led.seat === p.seat}
                {@const s = suitOf(led.card)}
                <span class="dot" style={`color: var(--suit-${s.toLowerCase()})`} title="Led this trick">{SUIT_SYMBOL[s]}&#xFE0E;</span>
              {/if}
            </span>
            <span class="plaque-text">
              <span class="seat-name" title={p.name}>{p.seat === me ? 'You' : p.name}</span>
              <span class="seat-score num">
                <strong>{p.score}</strong>
                {#if t.phase === 'playing'}
                  <span class:pos={t.pointsTaken[p.seat] > 0} class:neg={t.pointsTaken[p.seat] < 0}>
                    {t.pointsTaken[p.seat] === 0 ? '·' : signed(t.pointsTaken[p.seat])}
                  </span>
                {/if}
              </span>
            </span>
          </div>
          <div class="seat-tags">
            {#if p.autopilot}<span class="tag auto" title="A cat is playing for them until they’re back">🐾 Away</span>{/if}
            {#if timed(p.seat) && secondsLeft !== null}
              <span class="tag clock num" class:low={secondsLeft <= 10} title="Time left for this move">⏱ {clockText(secondsLeft)}</span>
            {/if}
            {#if t.phase === 'passing'}
              <span class="tag" class:done={t.passed[p.seat]}>{t.passed[p.seat] ? '✓ Passed' : 'Choosing'}</span>
            {/if}
            {#if t.cribWinner === p.seat}<span class="tag crib-tag" title="Won the crib">Crib</span>{/if}
            {#if t.queenTakenBy === p.seat}<span class="tag q" title="Took the Queen of Spades">Q♠</span>{/if}
            {#if t.jackTakenBy === p.seat && view.settings.jackOfDiamonds}<span class="tag j" title="Took the Jack of Diamonds">J♦</span>{/if}
          </div>
        </div>
      {/each}

      <!-- Bubbles and throws over the seats and the message, and the tray where the inspector opens. -->
      {#if Taunts && canTaunt && sendTaunt}
        <Taunts feed={tauntFeed} tray={trayFor} cooldownUntil={tauntCooldown} send={sendTaunt} close={() => (tray = null)} />
      {/if}

      {#if inspected}
        {@const done = inspected.winner !== null}
        <div class="insp panel" data-insp role="dialog" aria-label={`Trick ${inspNo}`} transition:fade={{ duration: 120 }}>
          <p class="head">
            Trick {inspNo} ·&nbsp;<span class="nm">{nameOf(inspTop)}</span>&nbsp;{inspTop === me
              ? done
                ? 'take it'
                : 'are winning'
              : done
                ? 'takes it'
                : 'is winning'}
          </p>
          <div class="plays">
            {#each inspected.plays as p, i (p.card)}
              <div class:led={i === 0} class:winner={p.seat === inspTop}>
                <PlayingCard card={p.card} width={40} jackScored={view.settings.jackOfDiamonds} />
                <span class="nm">{nameOf(p.seat)}</span>
                {#if i === 0}<span class="eyebrow">Led</span>{/if}
              </div>
            {/each}
          </div>
        </div>
      {/if}
    </div>

    <div class="hand-zone">
      <!-- A hint and one slot in a fixed-height row: it never wraps, so the hand stays put between the select and confirm taps. -->
      <div class="action-bar">
        <p class="hint" class:mine={(myTurn || needPass || onAutopilot) && !lastAuto} aria-live="polite">
          {#if queueHint}<span class="hint-nm">{nameOf(t.turn)}</span> is up. Tap a card to play it when it’s your turn.{:else}{hint}{/if}
        </p>
        {#if onAutopilot}
          <button class="btn btn-primary act" disabled={busy} onclick={() => act({ type: 'resume' })}>
            I’m back<span class="act-long">, give me my seat</span>
          </button>
        {:else if needPass}
          <button class="btn btn-primary act" disabled={busy || selected.length !== t.passCount} onclick={pass}>
            Pass {selected.length}/{t.passCount} →&nbsp;<span class="btn-name">{nameOf(t.passTarget)}</span>
          </button>
        {:else if myTurn && !finePointer && selected.length === 1}
          <button class="btn btn-primary act" disabled={busy} onclick={() => play(selected[0])}>Play {cardLabel(selected[0])}</button>
        {:else if canQueue && !finePointer && selected.length === 1 && selected[0] !== queuedCard}
          <button class="btn act" disabled={busy} onclick={() => queueCard(selected[0])}>
            Queue {cardLabel(selected[0])}{queuedCard ? ' instead' : ''}
          </button>
        {:else if queuedCard}
          <button class="btn btn-ghost act" disabled={busy} onclick={cancelQueue}>Cancel</button>
        {:else if me !== null && timed(me) && secondsLeft !== null}
          <!-- While a button holds the slot, your plaque's clock tag still counts down. -->
          <span class="my-clock num act" class:low={secondsLeft <= 10} title="Time left before a cat sits in for you">⏱ {clockText(secondsLeft)}</span>
        {/if}
      </div>

      <div class="hand" style={`--gaps: ${Math.max(1, handCount - 1)}; --spread: ${spread}deg; --arc: ${arcDrop}px`}>
        {#each t.myHand as card, i (card)}
          {@const canPick = (myTurn && t.legal.includes(card)) || (canQueue && queueable.includes(card))}
          <div class="slot" style={`--i: ${i - mid}; z-index: ${i}`} out:fly={{ y: -60, duration: 200 }}>
            <PlayingCard
              {card}
              width="var(--cw)"
              selected={selected.includes(card) && card !== queuedCard}
              queued={card === queuedCard}
              dimmed={(myTurn || canQueue) && !canPick}
              fresh={fresh(card)}
              jackScored={view.settings.jackOfDiamonds}
              onclick={needPass || myTurn || canQueue ? () => clickCard(card) : undefined}
              disabled={busy || !(needPass || canPick || card === queuedCard)}
            />
          </div>
        {/each}
      </div>
    </div>

    {#if view.dev}
      {#await loadDevPanel() then { default: DevPanel }}
        <DevPanel {view} {act} {busy} bind:showHands bind:showCrib />
      {/await}
    {/if}
  </div>

  <aside class="side">
    <section class="panel side-panel">
      <div class="spread">
        <h2 class="panel-title">Standings</h2>
        <span class="faint num small">{view.handsPlayed} hand{view.handsPlayed === 1 ? '' : 's'} played</span>
      </div>
      <Standings players={view.players} lastHand={view.lastHand} meId={view.me.userId} scoreLimit={view.settings.scoreLimit} />
      <div class="side-links">
        <a href={`/games/${view.id}/scoreboard`}>Scoreboard</a>
        <a href={`/games/${view.id}/stats`}>Stats</a>
        {#if view.me.isOwner}<a href={`/games/${view.id}/settings`}>Settings</a>{/if}
      </div>
    </section>

    {#if t.myCrib}
      <section class="panel side-panel" in:fly={{ y: 12 }}>
        <h2 class="panel-title">Your crib</h2>
        <p class="faint small">You won the first trick, so these are yours. Only you can see them.</p>
        <div class="mini-cards">
          {#each t.myCrib as c}<PlayingCard card={c} width={46} jackScored={view.settings.jackOfDiamonds} />{/each}
        </div>
      </section>
    {/if}

    {#if t.phase === 'playing' && (t.received.length || t.myPass)}
      <section class="panel side-panel">
        <h2 class="panel-title">This hand’s pass</h2>
        {#if t.myPass}
          <div class="pass-row">
            <span class="faint small">To {nameOf(t.passTarget)}</span>
            <div class="mini-cards">{#each t.myPass as c}<PlayingCard card={c} width={36} showValue={false} />{/each}</div>
          </div>
        {/if}
        {#if t.received.length}
          <div class="pass-row">
            <span class="faint small">From {nameOf(t.passSource)}</span>
            <div class="mini-cards">{#each t.received as c}<PlayingCard card={c} width={36} showValue={false} />{/each}</div>
          </div>
        {/if}
      </section>
    {/if}

    {#if view.lastHand}
      <section class="panel side-panel">
        <div class="spread">
          <h2 class="panel-title">Last hand <span class="faint num">#{view.lastHand.number}</span></h2>
          <button class="btn btn-ghost btn-sm" onclick={onShowResult}>Details</button>
        </div>
        <div class="last-hand">
          {#each view.players as p}
            {@const nm = handName(view.lastHand, p.seat)}
            <div class="lh-row">
              <span class="lh-name" title={nm}>{p.seat === me ? 'You' : nm}</span>
              <span class="lh-tags">
                {#if view.lastHand.sun === p.seat}<span title="Shot the Sun">☀&#xFE0E;</span>{/if}
                {#if view.lastHand.moon === p.seat}<span title="Shot the Moon">☾</span>{/if}
                {#if view.lastHand.queen === p.seat}<span title="Queen of Spades">Q♠</span>{/if}
                {#if view.lastHand.jack === p.seat && view.lastHand.jackScored}<span class="j" title="Jack of Diamonds">J♦</span>{/if}
                {#if view.lastHand.cribWinner === p.seat}<span title="Won the crib">▣</span>{/if}
              </span>
              <strong class="num">{signed(view.lastHand.scores[p.seat])}</strong>
            </div>
          {/each}
        </div>
      </section>
    {/if}

    <div class="prefs">
      <DeckToggle compact />
      <!-- The wording says what a tap does; aria-pressed carries the on/off state. -->
      <button class="btn btn-ghost btn-sm" aria-pressed={notify} onclick={toggleNotify}>
        {#if notify}
          <span aria-hidden="true">🔔</span> Alerts on · Turn off
        {:else}
          <span aria-hidden="true">🔕</span> Alert me when it’s my turn
        {/if}
      </button>
    </div>
  </aside>
</div>

<style>
  /* The container keeps the sides clear of a notch; the bottom clears the home indicator. */
  .layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 300px;
    gap: 24px;
    padding-top: 18px;
    padding-bottom: calc(28px + env(safe-area-inset-bottom, 0px));
  }

  .main {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  /* Above the seats, so a top seat's Sun or Moon glow goes behind the game's name and chips. */
  .statusbar {
    position: relative;
    z-index: 4;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    flex-wrap: wrap;
  }

  .game-name {
    font-family: var(--font-display);
    font-size: 22px;
    font-weight: 560;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 100%;
  }

  .chips {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }

  /* ---------- Arena ---------- */
  /* A container, so the cards and avatars inside are sized from the arena in CSS. */
  .arena {
    container: arena / size;
    position: relative;
    height: clamp(340px, calc(100dvh - 420px), 580px);
  }

  .felt {
    /* Trick cards grow with the table so the middle of the felt doesn't feel empty. */
    --tw: max(56px, min(124px, 11cqw, 24cqh));
    position: absolute;
    inset: 34px 64px 30px;
    border-radius: 34px;
    background: var(--felt-bg);
    box-shadow: var(--felt-shadow);
    overflow: hidden;
  }

  /* Nudged down a touch: the top seat's plaque takes more room than yours. */
  .center {
    position: absolute;
    inset: 16px 0 0;
    display: grid;
    place-items: center;
  }

  /* Isolated, so the cards' z-indexes stay inside the trick and never paint over the plaques or "takes it". */
  .trick {
    position: relative;
    isolation: isolate;
    width: var(--tw);
    height: calc(var(--tw) * 1.4);
    cursor: pointer;
  }

  .played {
    position: absolute;
    inset: 0;
    transition:
      transform 0.3s var(--ease),
      opacity 0.3s;
  }

  /* Stacked by seat, not play order, so every card's rank corner stays in view. */
  .played.at-top,
  .played.at-left,
  .played.at-top-left,
  .played.at-top-right {
    z-index: 1;
  }
  .played.at-right {
    z-index: 2;
  }
  .played.at-bottom {
    z-index: 3;
  }

  .played.at-bottom {
    transform: translate(0, 40%) rotate(-2deg);
  }
  .played.at-top {
    transform: translate(0, -40%) rotate(3deg);
  }
  .played.at-left {
    transform: translate(-72%, 0) rotate(-6deg);
  }
  .played.at-right {
    transform: translate(72%, 0) rotate(5deg);
  }
  .played.at-top-left {
    transform: translate(-50%, -32%) rotate(-4deg);
  }
  .played.at-top-right {
    transform: translate(50%, -32%) rotate(4deg);
  }
  .five .played.at-left {
    transform: translate(-118%, 10%) rotate(-6deg);
  }
  .five .played.at-right {
    transform: translate(118%, 10%) rotate(6deg);
  }
  .five .played.at-top-left {
    transform: translate(-62%, -40%) rotate(-4deg);
  }
  .five .played.at-top-right {
    transform: translate(62%, -40%) rotate(4deg);
  }
  .five .played.at-bottom {
    transform: translate(0, 46%) rotate(-2deg);
  }

  /* Glow and fade with box-shadow/opacity rather than CSS filters, which are costly to repaint.
     The winning card (so far, or for good) isn't raised: lifting it would cover the others' ranks again. */
  .winner :global(.pc) {
    box-shadow:
      0 0 0 2px var(--gold),
      0 0 22px rgb(242 196 109 / 0.6);
  }

  /* The led card, here and in the inspector. A grey that reads on the paper and on the dark strip. */
  .led :global(.pc) {
    outline: 2px solid var(--faint);
    outline-offset: 2px;
  }

  .played.loser {
    opacity: 0.75;
  }

  /* The message slot: above the trick and the plaques. Narrow enough to clear the corner cluster and button. */
  .msg {
    position: absolute;
    z-index: 4;
    bottom: 17%;
    display: flex;
    max-width: min(240px, calc(100% - 24px));
    white-space: nowrap;
    padding: 5px 12px;
    border-radius: 99px;
    background: rgb(0 0 0 / 0.6);
    color: var(--gold);
    font-size: 13px;
    font-weight: 600;
  }

  /* A name that gives way first when a line runs out of room. */
  .nm {
    min-width: 0;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* One overlay keyframe for every effect: a wash across the felt, a sunrise or moonrise, a ripple. */
  .fx {
    position: absolute;
    inset: 0;
    pointer-events: none;
    background: var(--fx);
    animation: fx var(--d) ease-out both;
  }

  @keyframes fx {
    from {
      opacity: 0;
      transform: var(--t0);
    }
    30% {
      opacity: 1;
    }
    to {
      opacity: 0;
      transform: var(--t1);
    }
  }

  /* The trick inspector: a strip over the middle of the table (it's a panel, so it may cover plaques), and
     over the taunts' layer (5). The taunt tray opens in the same spot, at the same height. */
  .insp {
    position: absolute;
    z-index: 6;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: min(400px, calc(100% - 16px));
    padding: 10px;
    font-size: 12px;
  }

  .head {
    display: flex;
    white-space: nowrap;
    color: var(--muted);
  }

  .plays {
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: minmax(0, 1fr);
    gap: 6px;
    margin-top: 8px;
  }

  .plays > div {
    display: grid;
    align-content: start;
    justify-items: center;
    gap: 4px;
  }

  .plays .winner {
    color: var(--gold);
    font-weight: 700;
  }

  .center-note {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    color: var(--felt-ink);
    text-align: center;
    font-size: 13px;
  }

  .center-note strong {
    font-family: var(--font-display);
    font-size: 22px;
    font-weight: 560;
    color: var(--felt-strong);
  }

  .big-arrow {
    font-size: 30px;
    line-height: 1;
    color: var(--gold);
  }

  .crib {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
  }

  .crib-stack {
    position: relative;
    width: calc(var(--tw) * 0.72 + 18px);
    height: calc(var(--tw) * 0.72 * 1.4 + 8px);
  }

  .crib-stack span {
    position: absolute;
    left: calc(var(--i) * 6px);
    top: calc(var(--i) * -2px + 6px);
    transform: rotate(calc((var(--i) - 1.5) * 4deg));
  }

  .crib-open {
    display: flex;
    gap: 4px;
  }

  .crib-label {
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--felt-ink);
  }

  /* ---------- Seats ---------- */
  .seat {
    position: absolute;
    z-index: 3;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
  }

  /* Each plaque centres on the felt's edge; tags hang off the far side. */
  .seat.at-top {
    top: 12px;
    left: 50%;
    transform: translateX(-50%);
  }
  .seat.at-bottom {
    top: calc(100% - 54px);
    left: 50%;
    transform: translateX(-50%);
  }
  .seat.at-left {
    left: 0;
    top: calc(50% - 23px);
    align-items: flex-start;
  }
  .seat.at-right {
    right: 0;
    top: calc(50% - 23px);
    align-items: flex-end;
  }
  .seat.at-top-left {
    top: 12px;
    left: 24%;
    transform: translateX(-50%);
  }
  .seat.at-top-right {
    top: 12px;
    right: 24%;
    transform: translateX(50%);
  }

  .plaque {
    position: relative;
    z-index: 1;
    display: flex;
    align-items: center;
    gap: 9px;
    max-width: 190px;
    padding: 3px 14px 3px 3px;
    border-radius: 99px;
    background: var(--plaque-bg);
    border: 1px solid transparent;
    color: var(--text);
    box-shadow: var(--plaque-shadow);
    transition:
      border-color 0.2s,
      box-shadow 0.2s;
  }

  .acting .plaque {
    border-color: var(--gold);
    box-shadow:
      0 0 0 1px var(--gold),
      0 0 22px -4px var(--gold),
      var(--plaque-shadow);
  }

  .plaque-text {
    display: flex;
    flex-direction: column;
    min-width: 0;
    line-height: 1.2;
  }

  /* ----- The status cluster: tricks left this hand (or cards each while passing), with the hearts
     and watch facts on a row of their own underneath. "Last trick" mirrors it in the other corner. ----- */
  .counter {
    position: absolute;
    z-index: 2;
    left: 12%;
    bottom: 22%;
    display: grid;
    grid-template-columns: auto auto;
    align-items: center;
    gap: 4px 9px;
    padding: 6px 12px 6px 10px;
    border-radius: 12px;
    background: var(--counter-bg);
    color: var(--counter-ink);
    pointer-events: auto;
  }

  .counter strong {
    font-size: 26px;
    font-weight: 700;
    line-height: 1;
    letter-spacing: -0.02em;
  }

  .counter-text {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    line-height: 1;
    opacity: 0.9;
  }

  .dots {
    display: flex;
    gap: 3px;
  }

  .dots i {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: color-mix(in srgb, currentColor 22%, transparent);
  }

  .dots i.on {
    background: var(--gold);
  }

  .facts {
    grid-column: 1 / -1;
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    font-weight: 700;
  }

  /* Whether hearts are broken, big enough to read at a glance: ♡, then ♥ (or the Q♠ that broke them). */
  .heart {
    font-size: 20px;
    line-height: 20px;
  }

  .heart.q {
    font-size: 15px;
  }

  .watch {
    display: flex;
    min-width: 0;
    color: var(--gold);
  }

  .watch .nm {
    max-width: 5em;
  }

  .last {
    left: auto;
    right: 12%;
    min-height: 34px;
    border: 0;
    font: inherit;
    cursor: pointer;
  }

  /* On the avatar: the led suit (top left). */
  .dot {
    position: absolute;
    top: -3px;
    left: -3px;
    width: 17px;
    height: 17px;
    border-radius: 50%;
    background: #fff;
    font-size: 11px;
    line-height: 17px;
    text-align: center;
  }

  /* A Sun or Moon glow (WatchGlow) sits behind this avatar: the name and the suit dot keep a dark edge over it. */
  .glowing .plaque-text {
    text-shadow:
      0 0 3px var(--plaque-bg),
      0 0 1px var(--plaque-bg);
  }

  .glowing .dot {
    box-shadow: 0 0 0 2px var(--plaque-bg);
  }

  .seat-avatar {
    --av: 38px;
    position: relative;
    flex: none;
    border-radius: 50%;
    padding: 2px;
  }

  /* A taunt target during play (the focus ring is the site's own, round with the avatar). */
  .seat-avatar[role='button'] {
    cursor: pointer;
  }

  @container arena (width < 520px) {
    .seat-avatar {
      --av: 34px;
    }
  }

  /* Spinning ring on a pseudo-element so the badges on the avatar stay upright. The avatar (position: relative) sits on top. */
  .acting .seat-avatar::before {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: 50%;
    background: conic-gradient(from 0deg, var(--gold), var(--heart), var(--gold));
    animation: spin 2.6s linear infinite;
    will-change: transform;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  /* Reduced motion: no spin, just a solid gold ring to match the gold plaque. Effects hold still
     for their moment (the global rule would finish them at once, invisible). */
  @media (prefers-reduced-motion: reduce) {
    .acting .seat-avatar::before {
      animation: none;
      will-change: auto;
      background: var(--gold);
    }

    .fx {
      animation: none;
      opacity: 0.6;
    }
  }

  .presence {
    position: absolute;
    right: 1px;
    bottom: 1px;
    width: 11px;
    height: 11px;
    border-radius: 50%;
    background: var(--faint);
    border: 2px solid var(--bg);
  }

  .presence.on {
    background: var(--mint);
  }

  .seat-name {
    max-width: 130px;
    font-size: 13.5px;
    font-weight: 650;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .acting .seat-name {
    color: var(--gold);
  }

  .seat-score {
    display: flex;
    gap: 6px;
    align-items: baseline;
    font-size: 12px;
  }

  .seat-score strong {
    font-size: 13.5px;
  }

  .seat-score span {
    color: var(--faint);
  }

  .seat-score .pos {
    color: var(--heart-ink);
  }

  .seat-score .neg {
    color: var(--mint);
  }

  .seat-tags {
    position: relative;
    z-index: 2;
    display: flex;
    gap: 3px;
    flex-wrap: wrap;
    justify-content: center;
  }

  .tag {
    font-size: 10.5px;
    font-weight: 700;
    padding: 1px 6px;
    border-radius: 5px;
    background: rgb(var(--lo) / 0.5);
    color: var(--muted);
    white-space: nowrap;
  }

  .tag.done {
    color: var(--mint);
  }

  .tag.q {
    background: #1a1d22;
    color: #fff;
  }

  .tag.j {
    background: var(--gold);
    color: #3b2604;
  }

  .tag.crib-tag {
    background: rgb(124 180 255 / 0.18);
    color: var(--sky);
  }

  .tag.auto {
    background: rgb(var(--lo) / 0.75);
    color: var(--gold);
  }

  .tag.clock,
  .my-clock {
    color: var(--text);
  }

  .tag.clock.low,
  .my-clock.low {
    background: rgb(240 71 91 / 0.2);
    color: #ffd0d6;
  }

  .my-clock {
    font-size: 14px;
    font-weight: 700;
    padding: 4px 10px;
    border-radius: 99px;
    background: rgb(var(--lo) / 0.5);
  }

  /* ---------- Hand ---------- */
  /* Quick taps on the cards and the action button never count as a double-tap zoom. */
  .hand-zone {
    container: hand / inline-size;
    margin-top: 22px;
    touch-action: manipulation;
  }

  /* One row, never wrapped: two lines of hint (2 × 18.9px) or a 40px button both fit in 44px. */
  .action-bar {
    min-height: 44px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 14px;
    text-align: center;
  }

  .hint {
    min-width: 0;
    color: var(--muted);
    font-size: 14.5px;
    line-height: 1.3;
    overflow-wrap: anywhere;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    overflow: hidden;
  }

  /* The one slot: Pass, Play, I'm back, or your clock. It keeps its width (up to 60%); the hint gives way. */
  .act {
    flex: none;
    max-width: 60%;
  }

  /* "Pass 0/3 → name": past 60% the name is cut short. No gap, so "I'm back" and its tail read as one phrase. */
  .act.btn {
    gap: 0;
  }

  .btn-name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .hint.mine {
    color: var(--text);
    font-weight: 600;
  }

  /* A long name in the hint is cut short, so the instruction after it still fits in its two lines. */
  .hint-nm {
    display: inline-block;
    max-width: 9em;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    vertical-align: bottom;
  }

  /* Card width (--cw) steps down with the zone's width. The cards overlap just enough to fit, at most
     74% of a card apart and at least 14px. 100cqi is the zone's width. */
  .hand {
    --cw: 96px;
    --step: max(14px, min(var(--cw) * 0.74, (100cqi - var(--cw) - 8px) / var(--gaps)));
    position: relative;
    margin-top: 10px;
    height: calc(var(--cw) * 1.4 + 34px + var(--arc));
  }

  @container hand (width < 760px) {
    .hand {
      --cw: 78px;
    }
  }

  @container hand (width < 520px) {
    .hand {
      --cw: 62px;
    }
  }

  /* --i is the card's place counted from the middle of the hand. */
  .slot {
    position: absolute;
    top: 26px;
    left: 0;
    transform: translate(calc(50cqi - var(--cw) / 2 + var(--i) * var(--step)), calc(var(--i) * var(--i) * 0.3px))
      rotate(calc(var(--i) * var(--spread)));
    transform-origin: 50% 120%;
    /* Positioned with transform only, so re-fanning the hand never triggers layout. */
    transition: transform 0.25s var(--ease);
    will-change: transform;
  }

  /* ---------- Side ---------- */
  .side {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding-top: 44px;
  }

  .side-panel {
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    border-radius: 18px;
  }

  .side-links {
    display: flex;
    gap: 4px;
    border-top: 1px solid var(--border);
    padding-top: 10px;
    margin-top: 2px;
  }

  .side-links a {
    flex: 1;
    text-align: center;
    padding: 6px 4px;
    border-radius: 8px;
    font-size: 13px;
    font-weight: 600;
    color: var(--muted);
    text-decoration: none;
  }

  .side-links a:hover {
    color: var(--text);
    background: rgb(var(--hi) / 0.05);
  }

  .small {
    font-size: 12.5px;
  }

  .mini-cards {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }

  .pass-row {
    display: flex;
    flex-direction: column;
    gap: 6px;
    overflow-wrap: anywhere;
  }

  .last-hand {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 13.5px;
  }

  .lh-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto 44px;
    gap: 8px;
    align-items: center;
  }

  .lh-row strong {
    text-align: right;
  }

  .lh-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .lh-tags {
    display: flex;
    gap: 4px;
    font-size: 11px;
    font-weight: 700;
    color: var(--muted);
  }

  .lh-tags .j {
    color: var(--gold);
  }

  .prefs {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    align-items: center;
    gap: 8px;
  }

  @media (max-width: 1080px) {
    .layout {
      grid-template-columns: minmax(0, 1fr);
    }

    .side {
      padding-top: 0;
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
      align-items: start;
    }
  }

  @media (max-width: 640px) {
    .layout {
      padding-top: 10px;
      gap: 16px;
    }

    .arena {
      height: 330px;
    }

    .felt {
      inset: 30px 34px 26px;
    }

    /* Bottom-left corner, as on desktop: the top-left one sat under the 5-player top-left plaque. */
    .counter {
      left: -2px;
      bottom: -2px;
      padding: 5px 9px 5px 8px;
    }

    .counter strong {
      font-size: 20px;
    }

    .last {
      left: auto;
      right: -2px;
    }

    /* Keeps the cluster under 106px wide, clear of a long-name bottom plaque at 360px. */
    .watch .nm {
      max-width: 3.5em;
    }

    /* "Tricks / left" on two short lines keeps the counter clear of a long name in the bottom seat. */
    .counter-text > span:first-child {
      width: min-content;
    }

    .dots {
      display: none;
    }

    /* Pull the 5-player side cards in so their ranks clear a long-name side plaque. Pulled in, the left
       card's rank would sit under the top-left card, so it stacks above it (it only covers that card's pip). */
    .five .played.at-left {
      z-index: 2;
      transform: translate(-96%, 10%) rotate(-6deg);
    }
    .five .played.at-right {
      transform: translate(96%, 10%) rotate(6deg);
    }

    .act-long {
      display: none;
    }

    /* Room for your seat's tags, which hang below the table, above the button. */
    .hand-zone {
      margin-top: 28px;
    }

    /* Narrow tables stack each plaque: avatar over name and score. */
    .plaque {
      flex-direction: column;
      gap: 1px;
      padding: 3px 8px 4px;
      max-width: 92px;
      border-radius: 16px;
    }

    .plaque-text {
      align-items: center;
    }

    .seat-name {
      max-width: 76px;
      font-size: 12px;
    }

    .seat.at-top,
    .seat.at-top-left,
    .seat.at-top-right {
      top: -6px;
    }

    .seat.at-bottom {
      top: calc(100% - 64px);
    }

    .seat.at-left,
    .seat.at-right {
      top: calc(50% - 40px);
    }

    .seat.at-left {
      left: -4px;
    }

    .seat.at-right {
      right: -4px;
    }

    .seat.at-top-left {
      left: 22%;
    }

    .seat.at-top-right {
      right: 22%;
    }

    .game-name {
      font-size: 18px;
    }
  }

  /* 360px phones: a little further in still, or a long-name left plaque reaches the left card's rank. */
  @media (max-width: 374px) {
    .five .played.at-left {
      transform: translate(-84%, 10%) rotate(-6deg);
    }
    .five .played.at-right {
      transform: translate(84%, 10%) rotate(6deg);
    }
  }

  /* A phone on its side (short and wide): the table fits the screen with a little room around it, and the
     page opens scrolled to it, past the site header. The game's name and chips sit in its top corners. The hand runs along its bottom
     edge with only the tops of the cards showing, your plaque to its left and the hint and button to its
     right. After the 640px rules, which it overrides where both apply. Keep in step with SIDEWAYS in
     src/lib/phones.ts; src/lib/phones.test.ts checks. */
  @media (orientation: landscape) and (max-height: 500px) and (min-width: 540px) {
    /* --pad: room above and below the table, so it doesn't run into the screen's edges and you can see where
       it ends. Less on the shortest screens, where every pixel counts. */
    .layout {
      --pad: clamp(8px, 5svh - 6px, 16px);
      padding-top: var(--pad);
    }

    /* --hc: the hand's card width, from the screen's size. --band: how much of the hand shows. */
    .main {
      --hc: clamp(52px, min(19svh, 8vw), 80px);
      --band: calc(var(--hc) * 0.7 + 18px);
      gap: 0;
    }

    /* Over the table's top corners, clear of the top seats. Taps go through it to the seats. */
    .statusbar {
      height: 36px;
      margin-bottom: -36px;
      padding-top: 6px;
      align-items: flex-start;
      flex-wrap: nowrap;
      pointer-events: none;
    }

    .game-name {
      font-size: 16px;
      max-width: calc(50% - 164px);
    }

    .chips {
      max-width: calc(50% - 164px);
      justify-content: flex-end;
      gap: 4px;
    }

    /* On dark ground, since they run onto the felt. A playtest table says so in the panel under it. */
    .chips .badge {
      height: 20px;
      background: var(--counter-bg);
    }

    /* The hand number makes way too (the standings count the hands), so the chips take at most two rows. */
    .chips .sky,
    .chips .num {
      display: none;
    }

    /* The whole screen while the browser's bars show (svh), less the room around it and an iPhone's home bar. */
    .arena {
      height: calc(100svh - 2 * var(--pad) - env(safe-area-inset-bottom, 0px));
    }

    /* The felt runs under the hand, starting below the name, and its bottom edge is where your cards tuck
       away. The trick centres in the part above the hand. */
    .felt {
      --tw: min(124px, (100cqh - 64px - var(--band)) / 2.75);
      inset: 26px 52px 0;
    }

    .center {
      inset: 22px 0 var(--band);
    }

    /* Clear of the status cluster and "Last trick" in the corners, even with a long name on the watch. */
    .msg {
      bottom: 6%;
      max-width: min(240px, 100% - 264px);
    }

    /* The status cluster on one row, above your plaque, and "Last trick" above the button. */
    .counter {
      left: 0;
      bottom: calc(var(--band) + 35px);
      display: flex;
      padding: 4px 9px;
    }

    .counter-text > span:first-child {
      width: min-content;
    }

    .dots {
      display: none;
    }

    .watch .nm {
      max-width: 3.5em;
    }

    .last {
      left: auto;
      right: 0;
      bottom: calc(var(--band) + 44px);
    }

    /* Plaques lie flat: avatar, then name and score. */
    .plaque {
      flex-direction: row;
      gap: 6px;
      padding: 2px 10px 2px 2px;
      max-width: 150px;
      border-radius: 99px;
    }

    .plaque-text {
      align-items: flex-start;
    }

    .seat-name {
      max-width: 96px;
    }

    .seat-avatar {
      --av: 30px;
    }

    /* Top seats near the top edge, with a little room for a Sun or Moon glow above the avatar (its tips may
       still be cut). Five players' two top seats meet in the middle (a plaque is at most 150px). */
    .seat.at-top,
    .seat.at-top-left,
    .seat.at-top-right {
      top: 6px;
    }

    .seat.at-top-left {
      left: calc(50% - 79px);
    }

    .seat.at-top-right {
      right: calc(50% - 79px);
    }

    /* Low enough to clear two rows of chips. */
    .seat.at-left,
    .seat.at-right {
      top: max(56px, (100% - var(--band)) / 2 - 50px);
    }

    /* Yours: the bottom-left corner beside your hand, with its tags stacked above it. */
    .seat.at-bottom {
      top: auto;
      bottom: 4px;
      left: 0;
      transform: none;
      flex-direction: column-reverse;
      align-items: flex-start;
    }

    .seat.at-bottom .seat-tags {
      max-width: 112px;
      flex-wrap: wrap-reverse;
      justify-content: flex-start;
    }

    /* The hand lies over the bottom of the felt, clear of the button and of your plaque, even with a
       four-figure score and the end card of a full hand tilted towards it. */
    .hand-zone {
      position: relative;
      height: var(--band);
      margin-top: calc(-1 * var(--band));
      /* What comes next (the standings) starts below the room under the table, and below an iPhone's home bar. */
      margin-bottom: calc(var(--pad) + env(safe-area-inset-bottom, 0px));
      padding: 0 calc(27% + 12px) 0 126px;
    }

    .action-bar {
      position: absolute;
      right: 0;
      bottom: 4px;
      max-width: 27%;
      flex-direction: column;
      align-items: flex-end;
      gap: 4px;
      padding: 5px;
      border-radius: 14px;
      background: var(--counter-bg);
    }

    .hint {
      font-size: 12.5px;
    }

    .act {
      max-width: 100%;
    }

    .act-long {
      display: none;
    }

    /* Cut off at the felt's bottom edge, so only the tops of the cards show. A picked card still rises over the felt. */
    .hand {
      --cw: var(--hc);
      height: var(--band);
      margin: 0;
      clip-path: inset(-99px -99px 0);
    }

    .slot {
      top: 6px;
    }
  }

  /* The one raise allowed on the felt: a hovered trick card comes to the front, so all of it shows.
     Last, so it beats the stacking-by-seat rules above. */
  @media (hover: hover) {
    .trick .played:hover {
      z-index: 5;
    }
  }
</style>

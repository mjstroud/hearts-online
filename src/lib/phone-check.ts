/**
 * The checks /dev/phones runs on the game page inside its frame (same origin, so it can look in): a page
 * wider than the screen, the wrong layout for the way the phone is held, table pieces on top of each other,
 * a rank corner that's covered, and, sideways, anything you need to play that's off the screen. Browser
 * only; nothing here runs for players.
 */

/** 'skip': there was nothing to check, so the size gets no tick. */
export interface Finding {
  level: 'bad' | 'note' | 'skip';
  text: string;
}

interface Piece {
  el: Element;
  label: string;
  rect: DOMRect;
}

const OVERLAP_SLACK = 1;

function visible(el: Element, win: Window): boolean {
  const r = el.getBoundingClientRect();
  if (r.width < 1 || r.height < 1) return false;
  const style = win.getComputedStyle(el);
  return style.visibility !== 'hidden' && Number(style.opacity) > 0.05;
}

function overlaps(a: DOMRect, b: DOMRect): boolean {
  const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  return w > OVERLAP_SLACK && h > OVERLAP_SLACK;
}

const quote = (s: string) => (s.length > 14 ? `${s.slice(0, 12)}…` : s);

/** A seat's name for messages: "You", or the start of the name on its plaque. */
function seatName(seat: Element): string {
  const name = seat.querySelector('.seat-name');
  return quote(name?.textContent?.trim() || name?.getAttribute('title') || 'a seat');
}

const posOf = (el: Element) => [...el.classList].find((c) => c.startsWith('at-'))?.slice(3) ?? '';

/** The solid pieces of the table: none of these may sit on another. */
function solidPieces(doc: Document, win: Window): Piece[] {
  const pieces: Piece[] = [];
  const add = (el: Element, label: string) => {
    if (visible(el, win)) pieces.push({ el, label, rect: el.getBoundingClientRect() });
  };
  for (const seat of doc.querySelectorAll('.seat')) {
    const who = seatName(seat);
    const plaque = seat.querySelector('.plaque');
    if (plaque) add(plaque, `${who}’s plaque`);
    seat.querySelectorAll('.seat-tags .tag').forEach((t) => add(t, `${who}’s “${t.textContent?.trim()}” tag`));
  }
  doc.querySelectorAll('.counter').forEach((c) => add(c, c.classList.contains('last') ? 'the Last trick button' : 'the status cluster'));
  doc.querySelectorAll('.statusbar .game-name, .statusbar .badge').forEach((b) => add(b, `the “${quote(b.textContent?.trim() ?? '')}” heading`));
  doc.querySelectorAll('.statusbar .chat-btn').forEach((b) => add(b, 'the Chat button'));
  doc.querySelectorAll('.action-bar .hint, .action-bar .act').forEach((b) =>
    add(b, b.classList.contains('hint') ? 'the hint' : `the “${quote(b.textContent?.trim() ?? '')}” button`),
  );
  return pieces;
}

/** What's drawn on top at a point, unless it's part of `own` or an overlay allowed over everything. */
function coveredBy(doc: Document, own: Element, x: number, y: number): Element | null | 'offscreen' {
  const top = doc.elementFromPoint(x, y);
  if (!top) return 'offscreen';
  if (own.contains(top)) return null;
  // The trick inspector and the taunt tray open over the table on purpose, and a moment's message sits on
  // top for a moment. (Bubbles and throws let taps through, so they're never what's found here.) Astro's own
  // toolbar only exists under npm run dev.
  // The chat sheet too, once it's opened: it covers the table on purpose (its button doesn't count).
  if (top.closest('.insp, .taunt-tray, .msg, [data-chat]:not(.chat-btn), astro-dev-toolbar')) return null;
  return top;
}

function describe(el: Element): string {
  const seat = el.closest('.seat');
  if (seat) return `${seatName(seat)}’s plaque`;
  if (el.closest('.trick')) return `the ${posOf(el.closest('.played') ?? el) || ''} trick card`.replace('  ', ' ');
  if (el.closest('.hand')) return 'another card in your hand';
  if (el.closest('.counter')) return el.closest('.last') ? 'the Last trick button' : 'the status cluster';
  if (el.closest('.action-bar')) return 'the action bar';
  if (el.closest('.statusbar')) return 'the heading';
  return `<${el.tagName.toLowerCase()}${el.classList[0] ? `.${el.classList[0]}` : ''}>`;
}

/**
 * `query` is SIDEWAYS from phones.ts, handed in by the page rather than imported here: the game island
 * imports phones.ts too, and sharing it with this dev-only script would split it into a chunk of its own
 * that every game page then fetches.
 */
export function checkFrame(frame: HTMLIFrameElement, sideways: boolean, query: string): Finding[] {
  const win = frame.contentWindow;
  const doc = frame.contentDocument;
  if (!win || !doc) return [{ level: 'bad', text: 'The frame didn’t load.' }];
  const findings: Finding[] = [];
  const bad = (text: string) => findings.push({ level: 'bad', text });
  const note = (text: string) => findings.push({ level: 'note', text });

  const wide = doc.documentElement.scrollWidth - win.innerWidth;
  if (wide > 1) bad(`The page is ${Math.round(wide)}px wider than the screen.`);

  if (!doc.querySelector('.arena')) {
    findings.push({ level: 'skip', text: 'No table on this page (the waiting room, final results, or not your game), so nothing was checked.' });
    return findings;
  }

  const trickCards = [...doc.querySelectorAll('.trick .played')].filter((c) => visible(c, win));
  const passing = !!doc.querySelector('.center-note');
  note(passing ? 'Passing.' : `Playing, ${trickCards.length} card${trickCards.length === 1 ? '' : 's'} on the trick.`);

  // Asked of the frame's own window, so it's the query as the page inside sees it.
  if (win.matchMedia(query).matches !== sideways) {
    const got = sideways ? 'didn’t get' : 'got';
    bad(`Held ${sideways ? 'sideways' : 'upright'}, the page ${got} the sideways layout (SIDEWAYS in src/lib/phones.ts).`);
  }

  // A renamed class would otherwise leave nothing to check, and every size would quietly pass.
  const missing = (what: string, selector: string) => bad(`Found no ${what} (${selector}) to check. Was a class renamed?`);
  if (!doc.querySelector('.seat .plaque')) missing('plaques', '.seat .plaque');
  if (!doc.querySelector('.counter')) missing('status cluster', '.counter');
  if (!doc.querySelector('.action-bar')) missing('action bar', '.action-bar');
  const hand = doc.querySelector('.hand');
  if (!hand) missing('hand', '.hand');
  else if (!hand.children.length) note('Your hand is empty, so it wasn’t checked.');
  else if (!hand.querySelector('.pc')) missing('cards in your hand', '.hand .pc');
  else if (!hand.querySelector('.pc .index > *')) missing('rank corners in your hand', '.hand .pc .index > *');

  // Solid pieces on each other.
  const pieces = solidPieces(doc, win);
  for (let i = 0; i < pieces.length; i++) {
    for (let j = i + 1; j < pieces.length; j++) {
      const a = pieces[i];
      const b = pieces[j];
      if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
      if (overlaps(a.rect, b.rect)) bad(`${a.label} overlaps ${b.label}.`);
    }
  }

  // Solid pieces on your hand.
  const handCards = [...doc.querySelectorAll('.hand .pc')].filter((c) => visible(c, win));
  for (const p of pieces) {
    if (p.el.closest('.action-bar')) continue;
    const hit = handCards.find((c) => overlaps(p.rect, c.getBoundingClientRect()));
    if (hit) bad(`${p.label} overlaps your hand.`);
  }

  // The message may sit over the trick and the plaques for its moment, but never on the corner pieces.
  const msg = doc.querySelector('.center .msg');
  if (msg && visible(msg, win)) {
    for (const c of doc.querySelectorAll('.counter')) {
      if (visible(c, win) && overlaps(msg.getBoundingClientRect(), c.getBoundingClientRect()))
        bad(`The message overlaps ${c.classList.contains('last') ? 'the Last trick button' : 'the status cluster'}.`);
    }
  }

  // Rank corners: the middle of each rank (and in your hand, each suit) must show the card itself. Trick
  // cards overlap by design, so the suit under a rank may be partly covered; each card is its suit's colour.
  const corners = (card: Element) => [...card.querySelectorAll('.index > *')];
  for (const card of trickCards) {
    for (const part of card.querySelectorAll('.index > :first-child')) {
      const r = part.getBoundingClientRect();
      const top = coveredBy(doc, card, r.left + r.width / 2, r.top + r.height / 2);
      if (top === 'offscreen') {
        if (sideways) bad(`The ${posOf(card)} trick card’s rank is off the screen.`);
      } else if (top) bad(`The ${posOf(card)} trick card’s rank is covered by ${describe(top)}.`);
    }
  }
  let handOff = 0;
  handCards.forEach((card, i) => {
    for (const part of corners(card)) {
      const r = part.getBoundingClientRect();
      const top = coveredBy(doc, card, r.left + r.width / 2, r.top + r.height / 2);
      if (top === 'offscreen') handOff++;
      else if (top) bad(`Card ${i + 1} in your hand has its rank covered by ${describe(top)}.`);
    }
  });

  // Within reach: sideways, everything you need to play must be on the screen without scrolling.
  const offscreen: string[] = [];
  const check = (el: Element | null, label: string) => {
    if (!el || !visible(el, win)) return;
    const r = el.getBoundingClientRect();
    if (r.bottom > win.innerHeight + 1) offscreen.push(`${label} is ${Math.round(r.bottom - win.innerHeight)}px below the screen`);
    else if (r.top < -1) offscreen.push(`${label} is ${Math.round(-r.top)}px above the screen`);
    else if (r.left < -1 || r.right > win.innerWidth + 1) offscreen.push(`${label} is partly off the side of the screen`);
  };
  doc.querySelectorAll('.seat').forEach((s) => check(s.querySelector('.plaque'), `${seatName(s)}’s plaque`));
  check(doc.querySelector('.counter'), 'The status cluster');
  check(doc.querySelector('.action-bar .act'), 'The action button');
  check(doc.querySelector('.statusbar .chat-btn'), 'The Chat button');
  // With chat open, the box to type in and its Send button.
  check(doc.querySelector('[data-chat] .compose .input'), 'The chat’s message box');
  check(doc.querySelector('[data-chat] .compose .send'), 'The chat’s Send button');
  const lowest = handCards
    .flatMap((c) => corners(c))
    .reduce<Element | null>((low, el) => (!low || el.getBoundingClientRect().bottom > low.getBoundingClientRect().bottom ? el : low), null);
  check(lowest, 'The lowest rank corner in your hand');
  if (handOff && !offscreen.length) offscreen.push(`${handOff} rank corner${handOff === 1 ? '' : 's'} in your hand are off the screen`);
  for (const o of offscreen) (sideways ? bad : note)(`${o}${sideways ? '' : ' (upright, the page scrolls; that’s expected)'}.`);

  const cut = [...doc.querySelectorAll('.seat-name')].filter((n) => n.scrollWidth > n.clientWidth + 1).length;
  if (cut) note(`${cut} name${cut === 1 ? '' : 's'} cut short with “…”.`);
  return findings;
}

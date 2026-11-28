/**
 * The starter taunts (Phase 4a): emotes pop up on the sender's own avatar, throws arc to someone else's.
 * Only the id ever goes over the wire, so Phase 5's cartoon art can replace an emoji without touching
 * anything else. The list is the owner's (2026-11-27); nothing here is newer than 2017, so old phones
 * draw them all.
 */

export type TauntKind = 'emote' | 'throw';

export interface Taunt {
  id: string;
  kind: TauntKind;
  emoji: string;
  /** For screen readers and tooltips. */
  label: string;
}

export const TAUNTS: readonly Taunt[] = [
  { id: 'laugh', kind: 'emote', emoji: '😂', label: 'Laugh' },
  { id: 'cool', kind: 'emote', emoji: '😎', label: 'Cool' },
  { id: 'shock', kind: 'emote', emoji: '😱', label: 'Shock' },
  { id: 'sob', kind: 'emote', emoji: '😭', label: 'Sob' },
  { id: 'devil', kind: 'emote', emoji: '😈', label: 'Devil' },
  { id: 'sleepy', kind: 'emote', emoji: '😴', label: 'Sleepy' },
  { id: 'clap', kind: 'emote', emoji: '👏', label: 'Clap' },
  // ❤ has a plain text form too; the variation selector asks every phone for the colour one.
  { id: 'heart', kind: 'emote', emoji: '❤️', label: 'Heart' },
  { id: 'tomato', kind: 'throw', emoji: '🍅', label: 'Tomato' },
  { id: 'rose', kind: 'throw', emoji: '🌹', label: 'Rose' },
  { id: 'fish', kind: 'throw', emoji: '🐟', label: 'Fish' },
  { id: 'pie', kind: 'throw', emoji: '🥧', label: 'Pie' },
];

export const EMOTES = TAUNTS.filter((t) => t.kind === 'emote');
export const THROWS = TAUNTS.filter((t) => t.kind === 'throw');

/** One cooldown per player, shared by emotes and throws. The server enforces it; the tray counts it down. */
export const TAUNT_COOLDOWN_MS = 15_000;

export const tauntById = (id: unknown): Taunt | null => TAUNTS.find((t) => t.id === id) ?? null;

/** A client's own id for one send, echoed back so the tab that sent it can skip its own echo. */
export const TAUNT_CID = /^[\w.-]{1,32}$/;

/** What POST /api/games/:id/taunt takes. */
export interface TauntRequest {
  taunt: string;
  /** Whoever a throw is aimed at (a user id). Left out, or null, for an emote. */
  to?: number | null;
  cid?: string;
}

/** What the live stream's `taunt` event carries, to every seated player alike. */
export interface TauntEvent {
  taunt: string;
  /** User ids, never seats or screen positions: each tab turns the table to its own seat. */
  from: number;
  to: number | null;
  /** Echoed from the request, if it had one. Cats' taunts have none. */
  cid?: string;
}

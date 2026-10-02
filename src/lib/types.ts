import type { Card } from './engine/cards';
import type { PresetId } from './engine/presets';
import type { GameSettings } from './engine/rules';
import type { HandSummary, TableView } from './engine/view';

export type GameStatus = 'lobby' | 'active' | 'finished';
/** `playtest` tables are solo sandboxes: just the owner and computer players, with dev tools. */
export type GameMode = 'normal' | 'playtest';
export type BotMode = 'auto' | 'manual';
export type BotSpeed = 'fast' | 'normal' | 'slow';

export interface DevSettings {
  botMode: BotMode;
  speed: BotSpeed;
}

export interface PlayerView {
  seat: number;
  userId: number;
  name: string;
  username: string;
  isBot: boolean;
  score: number;
  online: boolean;
}

/** Everything about the hand, revealed to the owner of a playtest table. */
export interface DevView extends DevSettings {
  hands: Card[][];
  crib: Card[];
  passes: (Card[] | null)[];
  /** Legal plays for every seat (only the seat on turn has any). */
  legal: Card[][];
  canUndo: boolean;
  passOptions: { offset: number; label: string }[];
}

/** Everything one user's browser knows about a game. */
export interface GameView {
  id: string;
  name: string;
  status: GameStatus;
  mode: GameMode;
  ownerId: number;
  joinCode: string;
  settings: GameSettings;
  handsPlayed: number;
  players: PlayerView[];
  me: { userId: number; seat: number | null; isOwner: boolean };
  table: TableView | null;
  lastHand: HandSummary | null;
  /** Seats the game is waiting on. */
  toAct: number[];
  /** Seats with the lowest total. */
  leaders: number[];
  /** The host has asked to end the game when the current hand finishes. */
  endAfterHand: boolean;
  dev: DevView | null;
  version: number;
  updatedAt: number;
}

export type DevMove = { type: 'pass'; cards: Card[] } | { type: 'play'; card: Card };

export type GameAction =
  | { type: 'pass'; cards: Card[] }
  | { type: 'play'; card: Card }
  | { type: 'start' }
  | { type: 'addBot' }
  | { type: 'removePlayer'; userId: number }
  | { type: 'leave' }
  | { type: 'shuffleSeats' }
  // Playtest tools (owner of a playtest table only)
  | { type: 'dev:act'; seat: number; move: DevMove }
  | { type: 'dev:ai'; scope: 'move' | 'trick' | 'hand'; /** For a single move: which seat (default: bots first). */ seat?: number }
  | { type: 'dev:bots'; botMode?: BotMode; speed?: BotSpeed }
  | { type: 'dev:undo' }
  | {
      type: 'dev:deal';
      preset: PresetId;
      seat?: number;
      /** For the custom preset: card lists per seat, and for the crib. */
      custom?: { hands: string[]; crib: string };
      /** null = the normal rotation for this hand number. */
      passOffset?: number | null;
    };

export interface GameListItem {
  id: string;
  name: string;
  status: GameStatus;
  mode: GameMode;
  isOwner: boolean;
  joinCode: string;
  handsPlayed: number;
  players: { name: string; isBot: boolean; score: number; isMe: boolean }[];
  yourTurn: boolean;
  waitingOn: string[];
  updatedAt: number;
}

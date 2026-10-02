import type { Card } from './engine/cards';
import type { GameSettings } from './engine/rules';
import type { HandSummary, TableView } from './engine/view';

export type GameStatus = 'lobby' | 'active' | 'finished';

export interface PlayerView {
  seat: number;
  userId: number;
  name: string;
  username: string;
  isBot: boolean;
  score: number;
  online: boolean;
}

/** Everything one user's browser knows about a game. */
export interface GameView {
  id: string;
  name: string;
  status: GameStatus;
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
  version: number;
  updatedAt: number;
}

export type GameAction =
  | { type: 'pass'; cards: Card[] }
  | { type: 'play'; card: Card }
  | { type: 'start' }
  | { type: 'addBot' }
  | { type: 'removePlayer'; userId: number }
  | { type: 'leave' }
  | { type: 'shuffleSeats' };

export interface GameListItem {
  id: string;
  name: string;
  status: GameStatus;
  isOwner: boolean;
  joinCode: string;
  handsPlayed: number;
  players: { name: string; isBot: boolean; score: number; isMe: boolean }[];
  yourTurn: boolean;
  waitingOn: string[];
  updatedAt: number;
}

/** What the taunt route and the cats' chatter share: one cooldown, one way onto the live stream. */

import { TAUNT_COOLDOWN_MS, type TauntEvent } from '../taunts';
import { sendToSeated } from './games';
import { type AttemptResult, rateLimit } from './rate-limit';

/**
 * One 15s cooldown per player, emotes and throws together. It's kept per table because the seven cats
 * are shared: Rosie can sit at several games at once. It lives in memory, so a restart resets it.
 */
export const takeTauntCooldown = (gameId: string, userId: number): AttemptResult =>
  rateLimit([{ key: `taunt:${gameId}:${userId}`, limit: 1, windowMs: TAUNT_COOLDOWN_MS }]);

/** Every seated player gets the same event, through its own named live-stream event. Never throws. */
export const sendTaunt = (gameId: string, event: TauntEvent): void => sendToSeated(gameId, 'taunt', event);

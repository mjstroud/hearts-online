import type { APIRoute } from 'astro';
import { DEFAULT_SETTINGS } from '../../lib/engine/rules';
import { now, sql, transaction } from '../../lib/server/db';
import { devToolsEnabled } from '../../lib/server/env';
import { createPlaytest, publishPlayerChange } from '../../lib/server/games';

/**
 * Dev only: a playtest table where every other seat has an old 32-character, one-word name, for
 * checking layouts on a phone. /dev/long-names seats five (?players=4 for four), and &me=long gives
 * your own local account a 32-character name too. It also works on the dev site (SITE_ENV=dev);
 * the real site answers 404.
 */

// One word each, so nothing can wrap. The W's are about the widest letters there are.
const LONG_NAMES = [
  'Wolfeschlegelsteinhausenbergerdorff',
  'W'.repeat(32),
  'Supercalifragilisticexpialidocious',
  'Pneumonoultramicroscopicsilicovolcanoconiosis',
].map((name) => name.slice(0, 32));
const MY_LONG_NAME = 'Hippopotomonstrosesquippedaliophobia'.slice(0, 32);

/**
 * The cats are shared by every table, so renaming one would rename it everywhere. These are separate
 * computer players, made once and reused. is_bot = 2 still counts as a bot everywhere (the code only
 * checks it for truth), but keeps them out of the cat pool, which picks is_bot = 1 (botUserIds in
 * games.ts), so they never sit down at an ordinary table. The ':' keeps their usernames out of reach
 * of sign-up.
 */
function longNamedBots(count: number): number[] {
  return LONG_NAMES.slice(0, count).map((name, i) => {
    const row = sql(
      `INSERT INTO users (username, display_name, password_hash, is_bot, created_at) VALUES (?, ?, NULL, 2, ?)
       ON CONFLICT (username) DO UPDATE SET display_name = excluded.display_name RETURNING id`,
    ).get(`dev:long-${i + 1}`, name, now()) as { id: number };
    return row.id;
  });
}

export const GET: APIRoute = ({ locals, url, redirect }) => {
  if (!devToolsEnabled()) return new Response(null, { status: 404 });
  const user = locals.user;
  if (!user) return redirect(`/login?next=${encodeURIComponent(url.pathname + url.search)}`);

  if (url.searchParams.get('me') === 'long') {
    sql('UPDATE users SET display_name = ? WHERE id = ?').run(MY_LONG_NAME, user.id);
    publishPlayerChange(user.id);
  }

  const players = url.searchParams.get('players') === '4' ? 4 : 5;
  const id = createPlaytest(user.id, `Long names, ${players} players`, DEFAULT_SETTINGS, players);
  // The table was dealt with cats in seats 1 and up: swap in the long names. The deal doesn't know who sits where.
  transaction(() => {
    longNamedBots(players - 1).forEach((botId, i) =>
      sql('UPDATE game_players SET user_id = ? WHERE game_id = ? AND seat = ?').run(botId, id, i + 1),
    );
  });
  return redirect(`/games/${id}`, 303);
};

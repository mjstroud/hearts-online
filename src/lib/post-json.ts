/** A JSON POST from the browser, shared by the moves and anything else the table sends. */

export interface PostResult {
  ok: boolean;
  /** The response's status, or 0 when none came back (offline, or timed out). */
  status: number;
  /**
   * The parsed body (untyped, as from res.json()), or {} when there's none or it isn't JSON,
   * say a proxy's error page during a deploy.
   */
  data: any;
}

/**
 * POST `body` as JSON and read the answer. Never throws: a request that fails comes back with
 * status 0. It gives up after 15 seconds, so a request that hangs (say, a phone hopping from wifi
 * to cellular) can't leave the hand locked.
 */
export async function postJson(url: string, body: unknown): Promise<PostResult> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout?.(15_000),
    });
  } catch {
    return { ok: false, status: 0, data: {} };
  }
  return { ok: res.ok, status: res.status, data: await res.json().catch(() => ({})) };
}

import { afterEach, describe, expect, it, vi } from 'vitest';
import { postJson } from './post-json';

afterEach(() => {
  vi.unstubAllGlobals();
});

const answer = (body: string, status: number) => vi.fn(async () => new Response(body, { status }));

describe('postJson', () => {
  it('sends JSON with a timeout and reads the answer', async () => {
    const fetch = answer('{"version":7}', 200);
    vi.stubGlobal('fetch', fetch);
    expect(await postJson('/api/games/abc/action', { type: 'play', card: 'QS' })).toEqual({ ok: true, status: 200, data: { version: 7 } });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/games/abc/action');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(init.body).toBe('{"type":"play","card":"QS"}');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('passes on the server’s refusal and its message', async () => {
    vi.stubGlobal('fetch', answer('{"error":"Not your turn."}', 409));
    expect(await postJson('/x', {})).toEqual({ ok: false, status: 409, data: { error: 'Not your turn.' } });
  });

  it('gives {} for a body that isn’t JSON', async () => {
    vi.stubGlobal('fetch', answer('<html>502 Bad Gateway</html>', 502));
    expect(await postJson('/x', {})).toEqual({ ok: false, status: 502, data: {} });
  });

  it('answers status 0, without throwing, when the request fails or times out', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))));
    expect(await postJson('/x', {})).toEqual({ ok: false, status: 0, data: {} });
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new DOMException('Timed out', 'TimeoutError'))));
    expect(await postJson('/x', {})).toEqual({ ok: false, status: 0, data: {} });
  });
});

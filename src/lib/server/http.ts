/** True when the browser reached us over HTTPS (directly or via a TLS-terminating proxy). */
export function isSecure(request: Request): boolean {
  const proto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
  return proto ? proto === 'https' : new URL(request.url).protocol === 'https:';
}

/** Only allow redirects back into this site (a single-slash path with no whitespace, control chars or backslashes). */
export function safeNext(next: string | null | undefined, fallback = '/games'): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || /[\x00-\x20\x7f\\]/.test(next)) return fallback;
  try {
    const base = 'http://local.invalid';
    const url = new URL(next, base);
    if (url.origin !== base) return fallback;
    return url.pathname + url.search;
  } catch {
    return fallback;
  }
}

/** Best guess at the client's IP (first X-Forwarded-For hop behind a proxy). */
export function clientIp(request: Request, fallback = 'unknown'): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || fallback;
}

export async function readForm(request: Request): Promise<Record<string, string>> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return {};
  }
  const out: Record<string, string> = {};
  for (const [k, v] of form.entries()) {
    if (typeof v === 'string') out[k] = k.toLowerCase().includes('password') ? v : v.trim();
  }
  return out;
}

export function jsonError(message: string, status = 400): Response {
  return Response.json({ error: message }, { status });
}

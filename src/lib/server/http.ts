/** True when the browser reached us over HTTPS (directly or via a TLS-terminating proxy). */
export function isSecure(request: Request): boolean {
  const proto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
  return proto ? proto === 'https' : new URL(request.url).protocol === 'https:';
}

/** The configured public address (SITE_URL, e.g. https://shootthesun.com), if there is one. */
function configuredSite(): URL | null {
  const raw = process.env.SITE_URL?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url : null;
  } catch {
    return null;
  }
}

const requestHost = (request: Request) =>
  request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? new URL(request.url).host;

/** This site's public origin: SITE_URL if set, otherwise whatever host the browser used (proxy-aware). */
export function siteOrigin(request: Request): string {
  const site = configuredSite();
  if (site) return site.origin;
  return `${isSecure(request) ? 'https' : 'http'}://${requestHost(request)}`;
}

/**
 * With SITE_URL set, requests that arrive on any other host (the fly.dev address, www.) are
 * permanently redirected there, so everyone shares one address and one sign-in cookie.
 * Health checks are left alone: the host polls the machine directly.
 */
export function canonicalRedirect(request: Request, url: URL): Response | null {
  const site = configuredSite();
  if (!site || url.pathname === '/healthz') return null;
  const host = requestHost(request).toLowerCase();
  if (host === site.host.toLowerCase() || /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host)) return null;
  return new Response(null, { status: 308, headers: { Location: `${site.origin}${url.pathname}${url.search}` } });
}

/** Only allow redirects back into this site (a single-slash path with no whitespace, control chars or backslashes). */
export function safeNext(next: string | null | undefined, fallback = '/games'): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || /[\x00-\x20\x7f\\]/.test(next)) return fallback;
  try {
    const base = 'http://local.invalid';
    const url = new URL(next, base);
    if (url.origin !== base) return fallback;
    // Check the normalized path too: dot segments like "/.//evil.com" collapse into "//evil.com",
    // which a browser treats as another site.
    const path = url.pathname + url.search;
    if (path.startsWith('//') || path.startsWith('/\\')) return fallback;
    return path;
  } catch {
    return fallback;
  }
}

/**
 * Best guess at the client's IP for rate limiting. On Fly.io the proxy sets Fly-Client-IP itself,
 * so it can't be faked. Elsewhere, fall back to the first X-Forwarded-For hop.
 */
export function clientIp(request: Request, fallback = 'unknown'): string {
  return (
    request.headers.get('fly-client-ip')?.trim() || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || fallback
  );
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

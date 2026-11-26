import { defineMiddleware } from 'astro:middleware';
import { SESSION_COOKIE, getSessionUser, setSessionCookie } from './lib/server/auth';
import { resumeBots } from './lib/server/games';
import { canonicalRedirect, isSecure } from './lib/server/http';
import { ACCEPT_TERMS_PATH, isPageLoad, needsTerms, termsGatedPath } from './lib/terms';

const g = globalThis as typeof globalThis & { __heartsBooted?: boolean };

const PROTECTED = ['/games', '/stats', '/join', '/account', '/playtest', '/admin', '/api/', '/avatars/'];
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return request.headers.get('sec-fetch-site') !== 'cross-site';
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export const onRequest = defineMiddleware(async (ctx, next) => {
  if (!g.__heartsBooted) {
    g.__heartsBooted = true;
    resumeBots();
  }

  // One public address: send visitors on any other host (the fly.dev name, www.) to SITE_URL.
  const canonical = canonicalRedirect(ctx.request, ctx.url);
  if (canonical) return canonical;

  if (!SAFE_METHODS.has(ctx.request.method) && !sameOrigin(ctx.request)) {
    return new Response('Cross-site request blocked.', { status: 403 });
  }

  ctx.locals.user = null;
  const token = ctx.cookies.get(SESSION_COOKIE)?.value;
  if (token) {
    const session = getSessionUser(token);
    if (session) {
      ctx.locals.user = session.user;
      if (session.renewed) setSessionCookie(ctx.cookies, token, session.renewed, isSecure(ctx.request));
    } else {
      ctx.cookies.delete(SESSION_COOKIE, { path: '/' });
    }
  }

  const path = ctx.url.pathname;
  if (!ctx.locals.user && PROTECTED.some((p) => path === p || path.startsWith(p.endsWith('/') ? p : `${p}/`))) {
    if (path.startsWith('/api/')) {
      return Response.json({ error: 'Please sign in.' }, { status: 401 });
    }
    // Photos load as <img>, so a redirect to the sign-in page would be no use.
    if (path.startsWith('/avatars/')) {
      return new Response('Please sign in.', {
        status: 401,
        headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
      });
    }
    return ctx.redirect(`/login?next=${encodeURIComponent(path + ctx.url.search)}`);
  }

  // Anyone who hasn't agreed to the current terms is asked once, on their next page load. API calls,
  // the live stream and photos are never redirected, so a game tab that's already open keeps working.
  const user = ctx.locals.user;
  const askTerms = !!user && !user.isBot && needsTerms(user.termsVersion);
  if (askTerms && termsGatedPath(path) && isPageLoad(ctx.request.method, ctx.request.headers)) {
    return ctx.redirect(`${ACCEPT_TERMS_PATH}?next=${encodeURIComponent(path + ctx.url.search)}`);
  }

  const response = await next();
  try {
    response.headers.set('X-Content-Type-Options', 'nosniff');
    response.headers.set('X-Frame-Options', 'DENY');
    response.headers.set('Referrer-Policy', 'same-origin');
  } catch {
    // Some responses (e.g. Response.redirect) have immutable headers.
  }
  return response;
});

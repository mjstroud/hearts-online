import { defineMiddleware } from 'astro:middleware';
import { SESSION_COOKIE, getSessionUser, setSessionCookie } from './lib/server/auth';
import { resumeBots } from './lib/server/games';
import { isSecure } from './lib/server/http';

const g = globalThis as typeof globalThis & { __heartsBooted?: boolean };

const PROTECTED = ['/games', '/stats', '/join', '/account', '/api/'];
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
    return ctx.redirect(`/login?next=${encodeURIComponent(path + ctx.url.search)}`);
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

import { afterEach, describe, expect, it } from 'vitest';
import { canonicalRedirect, clientIp, safeNext, siteOrigin } from './http';

describe('redirects after sign-in', () => {
  it('keeps paths on this site', () => {
    expect(safeNext('/games/abc?tab=1')).toBe('/games/abc?tab=1');
    expect(safeNext('/join/ABC123')).toBe('/join/ABC123');
    expect(safeNext(null)).toBe('/games');
  });

  it('refuses anything that would leave the site', () => {
    for (const evil of [
      '//evil.example/x',
      'https://evil.example/',
      '/\\evil.example',
      '/.//evil.example/phish',
      '/a/..//evil.example/y',
      '/%2e%2e//evil.example',
      '/%2e//evil.example',
      '/./%2f/evil.example',
      ' /games',
      'javascript:alert(1)',
    ]) {
      const out = safeNext(evil);
      expect(out, evil).toMatch(/^\/(?![/\\])/);
      expect(new URL(out, 'https://shootthesun.com').host, evil).toBe('shootthesun.com');
    }
  });
});

const req = (url: string, headers: Record<string, string> = {}) => new Request(url, { headers });

describe('canonical site address', () => {
  afterEach(() => {
    delete process.env.SITE_URL;
  });

  it('does nothing without SITE_URL', () => {
    expect(canonicalRedirect(req('http://hearts-table.fly.dev/games'), new URL('http://hearts-table.fly.dev/games'))).toBeNull();
    expect(siteOrigin(req('http://x/', { host: 'hearts-table.fly.dev', 'x-forwarded-proto': 'https' }))).toBe('https://hearts-table.fly.dev');
  });

  it('sends other hosts to SITE_URL, keeping the path', () => {
    process.env.SITE_URL = 'https://shootthesun.com';
    const url = new URL('http://hearts-table.fly.dev/join/ABC123?x=1');
    const res = canonicalRedirect(req(url.href, { host: 'hearts-table.fly.dev' }), url)!;
    expect(res.status).toBe(308);
    expect(res.headers.get('location')).toBe('https://shootthesun.com/join/ABC123?x=1');
    const www = new URL('http://www.shootthesun.com/');
    expect(canonicalRedirect(req(www.href, { host: 'www.shootthesun.com' }), www)!.headers.get('location')).toBe('https://shootthesun.com/');
    expect(siteOrigin(req('http://x/', { host: 'hearts-table.fly.dev' }))).toBe('https://shootthesun.com');
  });

  it('leaves the real host, localhost and health checks alone', () => {
    process.env.SITE_URL = 'https://shootthesun.com';
    const home = new URL('http://shootthesun.com/games');
    expect(canonicalRedirect(req(home.href, { host: 'shootthesun.com' }), home)).toBeNull();
    const local = new URL('http://localhost:4321/games');
    expect(canonicalRedirect(req(local.href, { host: 'localhost:4321' }), local)).toBeNull();
    const health = new URL('http://172.19.0.2:8080/healthz');
    expect(canonicalRedirect(req(health.href, { host: '172.19.0.2:8080' }), health)).toBeNull();
  });
});

describe('client IP', () => {
  it('prefers the header Fly sets over a client-supplied X-Forwarded-For', () => {
    expect(clientIp(req('http://x/', { 'fly-client-ip': '203.0.113.9', 'x-forwarded-for': '1.2.3.4, 203.0.113.9' }))).toBe('203.0.113.9');
    expect(clientIp(req('http://x/', { 'x-forwarded-for': '1.2.3.4, 10.0.0.1' }))).toBe('1.2.3.4');
    expect(clientIp(req('http://x/'), 'fallback')).toBe('fallback');
  });
});

import { afterEach, describe, expect, it } from 'vitest';
import { GET as manifestRoute } from '../../pages/manifest.webmanifest';
import { isDevSite } from './env';

const original = process.env.SITE_ENV;
afterEach(() => {
  if (original === undefined) delete process.env.SITE_ENV;
  else process.env.SITE_ENV = original;
});

async function manifestName(): Promise<string> {
  const res = await manifestRoute({} as Parameters<typeof manifestRoute>[0]);
  return (await res.json()).name;
}

describe('dev site switch', () => {
  it('is off unless SITE_ENV is exactly "dev"', () => {
    delete process.env.SITE_ENV;
    expect(isDevSite()).toBe(false);
    for (const value of ['', 'production', 'staging', 'Dev', 'development']) {
      process.env.SITE_ENV = value;
      expect(isDevSite()).toBe(false);
    }
    process.env.SITE_ENV = 'dev';
    expect(isDevSite()).toBe(true);
  });

  it('names the home-screen app after the site it is on', async () => {
    delete process.env.SITE_ENV;
    expect(await manifestName()).toBe('Shoot the Sun');
    process.env.SITE_ENV = 'dev';
    expect(await manifestName()).toBe('Shoot the Sun Dev');
  });
});

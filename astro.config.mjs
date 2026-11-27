// @ts-check
import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
import svelte from '@astrojs/svelte';

// One id per build, baked into the server and the browser code alike, so a tab left open across
// a deploy can tell it's running old code. Kept on the env so every load of this file agrees.
process.env.BUILD_ID ||= Date.now().toString(36);

// https://astro.build/config
export default defineConfig({
  output: 'server',
  // No form or move comes near 64 KB; the adapter's default (1 GB) would let one request fill the VM's memory.
  adapter: node({ mode: 'standalone', bodySizeLimit: 64 * 1024 }),
  integrations: [svelte()],
  // All CSS in files the browser caches, rather than small stylesheets inlined and re-sent with every
  // page. scripts/check-budgets.mjs measures what each page links.
  build: { inlineStylesheets: 'never' },
  // We do our own proxy-aware same-origin check in src/middleware.ts.
  security: { checkOrigin: false },
  server: { port: 4321 },
  vite: {
    plugins: [
      {
        name: 'build-id',
        // The dev server keeps one fixed id, so hot reloads and restarts never offer a refresh.
        config: (_, { command }) => ({
          define: { __BUILD_ID__: JSON.stringify(command === 'build' ? process.env.BUILD_ID : 'dev') },
        }),
      },
    ],
  },
});

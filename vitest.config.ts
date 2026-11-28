import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Turns the cats' chatter off, so a random taunt never lands among a test's live events.
    setupFiles: ['./vitest.setup.ts'],
  },
});

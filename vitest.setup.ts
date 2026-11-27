// Runs before every test file. The cats' chatter is random and on timers of its own, so it's off
// unless a test turns it on (chatter.test.ts does, with dice it scripts). This imports nothing:
// server tests must point DATABASE_PATH at a throwaway file before any server module loads.
(globalThis as { __heartsChatter?: { off?: boolean } }).__heartsChatter = { off: true };

/** Playtest-only timings for your own moves, shown in the playtest panel. All times are ms since the tap. */

export type TimedMove = 'play' | 'pass';

export interface LatencySample {
  action: TimedMove;
  /** False when the move had no optimistic guess, so nothing moved until the server answered. */
  guessed: boolean;
  /** Tap to the first frame drawn with the guess on screen. */
  paint: number | null;
  /** Tap to the POST's response. */
  post: number | null;
  /** Tap to the first live (SSE) state at or after the version the move produced. */
  live: number | null;
}

const KEEP = 20;

export const latency = $state({ samples: [] as LatencySample[] });

export interface MoveTiming {
  /** The guess (if any) has just been put in the view. */
  applied(guessed: boolean): void;
  /** The POST came back, with the version it produced (null if it failed). */
  answered(version: number | null): void;
  /** A live state arrived. */
  live(version: unknown): void;
}

// Inside a tap's handler, count from the tap itself so input delay is included. Older browsers
// stamp events on a different clock, so only trust a stamp that's already in the past.
function tapTime(): number {
  const now = performance.now();
  const stamp = typeof window === 'undefined' ? undefined : window.event?.timeStamp;
  return stamp !== undefined && stamp > 0 && stamp <= now ? stamp : now;
}

export function timeMove(action: TimedMove): MoveTiming {
  const t0 = tapTime();
  const since = () => Math.round(performance.now() - t0);
  latency.samples.push({ action, guessed: false, paint: null, post: null, live: null });
  if (latency.samples.length > KEEP) latency.samples.splice(0, latency.samples.length - KEEP);
  // Read it back: the reactive copy is the one the panel watches.
  const sample = latency.samples[latency.samples.length - 1];

  // undefined while the POST is out, then the version it produced (null if it failed).
  let produced: number | null | undefined;
  // The live stream often beats the POST back, so note what arrives before we know the version.
  const early: { version: number; ms: number }[] = [];

  return {
    applied(guessed) {
      sample.guessed = guessed;
      // rAF runs just before the next frame is drawn; the timeout after it lands once it's on screen.
      if (guessed) requestAnimationFrame(() => setTimeout(() => (sample.paint = since())));
    },
    answered(version) {
      if (produced !== undefined) return;
      sample.post = since();
      produced = version;
      if (version !== null) sample.live = early.find((e) => e.version >= version)?.ms ?? null;
    },
    live(version) {
      if (typeof version !== 'number' || sample.live !== null) return;
      if (produced === undefined) early.push({ version, ms: since() });
      else if (produced !== null && version >= produced) sample.live = since();
    },
  };
}

export function median(values: (number | null)[]): number | null {
  const sorted = values.filter((v): v is number => v !== null).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

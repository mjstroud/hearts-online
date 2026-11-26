/** In-process pub/sub for live game updates over Server-Sent Events. */

export interface Subscriber {
  userId: number;
  send(event: string, data: unknown): void;
  /** Hang up this stream: once someone is removed or the game is deleted, it has nothing more to say. */
  close?(): void;
}

const g = globalThis as typeof globalThis & { __heartsHub?: Map<string, Set<Subscriber>> };
const channels: Map<string, Set<Subscriber>> = (g.__heartsHub ??= new Map());

export function subscribe(gameId: string, sub: Subscriber): () => void {
  let set = channels.get(gameId);
  if (!set) channels.set(gameId, (set = new Set()));
  set.add(sub);
  return () => {
    set.delete(sub);
    if (set.size === 0) channels.delete(gameId);
  };
}

export function subscribers(gameId: string): Subscriber[] {
  return [...(channels.get(gameId) ?? [])];
}

/** Send one person's open streams something nobody else at the table may hear. Never throws. */
export function sendTo(gameId: string, userId: number, event: string, data: unknown): void {
  for (const s of subscribers(gameId)) {
    if (s.userId !== userId) continue;
    try {
      s.send(event, data);
    } catch (err) {
      console.error('Failed to push update', err);
    }
  }
}

export function onlineUsers(gameId: string): Set<number> {
  return new Set(subscribers(gameId).map((s) => s.userId));
}

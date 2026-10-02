/** In-process pub/sub for live game updates over Server-Sent Events. */

export interface Subscriber {
  userId: number;
  send(event: string, data: unknown): void;
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

export function onlineUsers(gameId: string): Set<number> {
  return new Set(subscribers(gameId).map((s) => s.userId));
}

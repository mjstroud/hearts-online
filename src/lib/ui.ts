/** Small presentation helpers shared by Astro pages and Svelte components. */

export const SITE_NAME = 'Hearts Table';

const AVATAR_COLORS = ['#e2557a', '#e8894a', '#d4a72c', '#4caf7f', '#3aa6b9', '#5b7fe0', '#8a63d2', '#c45cb5', '#6f8f3a', '#d0644f'];

export function avatarColor(seed: string | number): string {
  const s = String(seed);
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2);
  return parts[0][0] + parts[parts.length - 1][0];
}

export function timeAgo(ts: number, nowTs = Date.now()): string {
  const s = Math.max(0, Math.round((nowTs - ts) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export const fmtPct = (v: number) => `${v.toFixed(v >= 10 || v === 0 ? 0 : 1)}%`;
export const fmtAvg = (v: number) => v.toFixed(1);
export const signed = (v: number) => (v > 0 ? `+${v}` : `${v}`);

export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

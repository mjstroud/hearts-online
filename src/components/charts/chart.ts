/**
 * Categorical series colors (dark-mode steps), validated for this site's dark
 * chart surface: lightness band, chroma, CVD separation and 3:1 contrast all pass.
 * Assigned by seat order so a player keeps their color everywhere.
 */
export const SERIES_COLORS = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181'];

/** Single-series bars use slot 1. */
export const BAR_COLOR = SERIES_COLORS[0];

/** Round, human-friendly axis ticks covering [min, max]. */
export function niceTicks(min: number, max: number, count = 5): number[] {
  if (min === max) max = min + 1;
  const raw = (max - min) / Math.max(1, count);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
  const start = Math.floor(min / step) * step;
  const end = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= end + step / 2; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return ticks;
}

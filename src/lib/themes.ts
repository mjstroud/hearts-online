/**
 * Visual themes. Each one is a block of CSS tokens in styles/themes.css keyed by
 * data-theme on <html>. The picker exists so we can try several looks at the table
 * before settling on a single one for good.
 */

export interface Theme {
  id: string;
  name: string;
  blurb: string;
  /** Page background, also used for the browser's theme-color. */
  bg: string;
  /** Picker swatch: table, card back, accent. */
  swatch: [felt: string, back: string, accent: string];
  /** Extra Google Fonts families (the css2 `family=` values) this theme needs. */
  fonts?: string[];
}

export const THEMES: Theme[] = [
  {
    id: 'classic',
    name: 'Classic',
    blurb: 'The current look',
    bg: '#090d0c',
    swatch: ['#1f7253', '#b02a40', '#f2c46d'],
  },
  {
    id: 'tiles',
    name: 'Tiles',
    blurb: 'Chunky ivory tiles on a rack, jade backs, a matte mat',
    bg: '#0d1214',
    swatch: ['#1d3b3a', '#2e9a80', '#f2b24c'],
    fonts: ['Outfit:wght@400..800'],
  },
  {
    id: 'outline',
    name: 'Outline',
    blurb: 'Just frames: line-art suits on near black, one lime accent',
    bg: '#0b0b0d',
    swatch: ['#121215', '#121215', '#d4ff4f'],
    fonts: ['Space+Grotesk:wght@400..700'],
  },
  {
    id: 'block',
    name: 'Color Block',
    blurb: 'Every card is its suit colour, on a pale paper table',
    bg: '#0f0e0d',
    swatch: ['#ebe6dc', '#1f1d1b', '#e5383b'],
    fonts: ['Archivo:wdth,wght@62..125,400..900'],
  },
  {
    id: 'daylight',
    name: 'Daylight',
    blurb: 'Light and airy: white cards on a sage mat',
    bg: '#f3f1ec',
    swatch: ['#dfe8e1', '#f0675f', '#e5484d'],
    fonts: ['Plus+Jakarta+Sans:wght@400..800'],
  },
  {
    id: 'aurora',
    name: 'Aurora',
    blurb: 'Frosted glass on a night sky, gradient suits',
    bg: '#0a0b1a',
    swatch: ['#2a2463', '#6b5cff', '#5ef0c0'],
    fonts: ['Sora:wght@400..800'],
  },
];

export const DEFAULT_THEME = THEMES[0];

/** Cookie holding the chosen theme id. */
export const THEME_COOKIE = 'hearts_theme';

export function themeById(id: string | undefined): Theme {
  return THEMES.find((t) => t.id === id) ?? DEFAULT_THEME;
}

/** Stylesheet URL for a theme's extra fonts, or null when it only uses the base fonts. */
export function themeFontsHref(theme: Theme): string | null {
  if (!theme.fonts?.length) return null;
  return `https://fonts.googleapis.com/css2?${theme.fonts.map((f) => `family=${f}`).join('&')}&display=swap`;
}

/** Switch themes instantly in the browser and remember the choice for a year. */
export function setTheme(id: string) {
  const theme = themeById(id);
  const root = document.documentElement;
  root.dataset.theme = theme.id;
  document.cookie = `${THEME_COOKIE}=${theme.id}; path=/; max-age=31536000; samesite=lax`;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme.bg);

  const href = themeFontsHref(theme);
  let link = document.getElementById('theme-fonts') as HTMLLinkElement | null;
  if (href) {
    if (!link) {
      link = document.createElement('link');
      link.id = 'theme-fonts';
      link.rel = 'stylesheet';
      document.head.append(link);
    }
    if (link.getAttribute('href') !== href) link.href = href;
  }
}

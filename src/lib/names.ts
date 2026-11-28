/** Display names: what everyone sees at the table. Shared by the server and the pages. */

/** Longest display name, counted the way people count characters (an emoji is one). */
export const DISPLAY_NAME_MAX = 16;

/**
 * Backstop on raw length, so a few "characters" piled high with accents can't slip through. Also the
 * inputs' maxlength, because browsers count that in code units: an emoji family alone is 11.
 */
export const DISPLAY_NAME_MAX_UNITS = DISPLAY_NAME_MAX * 4;

const segmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;

/** False in old browsers that can't tell where one character ends, so counts there run high. */
export const CAN_COUNT_CHARACTERS = segmenter !== null;

/** Split text into the characters people see, so an emoji family or a flag stays whole. */
export function graphemes(text: string): string[] {
  return segmenter ? Array.from(segmenter.segment(text), (s) => s.segment) : Array.from(text);
}

/** How long a name is, in the characters people see. */
export const displayNameLength = (name: string) => graphemes(name).length;

/** Longest game name, in code units (the form's maxlength). */
export const GAME_NAME_MAX = 60;

/** The longest start of `text` that fits in `maxUnits` code units, without cutting a character in half. */
export function clipToLength(text: string, maxUnits: number): string {
  if (text.length <= maxUnits) return text;
  let out = '';
  for (const g of graphemes(text)) {
    if (out.length + g.length > maxUnits) break;
    out += g;
  }
  return out;
}

// Invisible characters (zero-width spaces, direction overrides, byte-order marks, blank fillers) can
// hide a name or flip the text around it. Keep the joiners, variation selectors and tags that emoji
// and some scripts (Persian, Mongolian, Indic) need.
const INVISIBLE = /(?![\u200c\u200d\u180b-\u180f\ufe00-\ufe0f\u{E0020}-\u{E007F}\u{E0100}-\u{E01EF}])[\p{Cf}\p{Default_Ignorable_Code_Point}\u2800]/gu;
// Tag characters only mean something inside a flag emoji (England, Scotland, Wales): an emoji, its tags and
// at most one cancel tag stay, and any other tag goes. One pass, in step with the text (a lookbehind here
// cost a second of CPU for a long run of tags).
const STRAY_TAGS = /(\p{Extended_Pictographic}[\u{E0020}-\u{E007E}]*\u{E007F}?)|[\u{E0020}-\u{E007F}]/gu;
// Half of an emoji, left over from a broken copy and paste.
const LONE_SURROGATES = /\p{Cs}/gu;
// A joiner or tag between two accents does nothing except split up a pile of accents.
const JOINERS_BETWEEN_MARKS = /(?<=\p{M})[\u200c\u200d\u{E0020}-\u{E007F}]+(?=\p{M})/gu;
// More than four accents on one letter only makes it taller.
const STACKED_MARKS = /(\p{M}{4})\p{M}+/gu;
const JOINER_RUNS = /([\u200c\u200d])[\u200c\u200d]+/gu;
// A joiner that doesn't sit between two characters, left over when an emoji gets cut in half.
const DANGLING_JOINERS = /(^|\s)[\u200c\u200d]+|[\u200c\u200d]+(?=\s|$)/gu;

/** Tidy a submitted name: no control or invisible characters, single spaces, trimmed. */
export function normalizeDisplayName(raw: string): string {
  return raw
    .replace(LONE_SURROGATES, '')
    .replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, ' ')
    .replace(INVISIBLE, '')
    .replace(STRAY_TAGS, (_, flag?: string) => flag ?? '')
    .replace(JOINERS_BETWEEN_MARKS, '')
    .normalize('NFC')
    .replace(STACKED_MARKS, '$1')
    .replace(JOINER_RUNS, '$1')
    .replace(DANGLING_JOINERS, '$1')
    .replace(/\s+/gu, ' ')
    .trim();
}

/** Why a (normalized) display name can't be used, or null if it's fine. */
export function displayNameError(name: string): string | null {
  if (!/[\p{L}\p{N}\p{S}\p{P}]/u.test(name)) return 'Please enter a display name.';
  if (displayNameLength(name) > DISPLAY_NAME_MAX || name.length > DISPLAY_NAME_MAX_UNITS)
    return `Display names can be up to ${DISPLAY_NAME_MAX} characters.`;
  return null;
}

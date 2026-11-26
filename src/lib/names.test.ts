import { describe, expect, it } from 'vitest';
import { DISPLAY_NAME_MAX, clipToLength, displayNameError, graphemes, normalizeDisplayName } from './names';
import { initials } from './ui';

const valid = (raw: string) => displayNameError(normalizeDisplayName(raw));

describe('display names', () => {
  it('allows up to the limit and no more', () => {
    expect(DISPLAY_NAME_MAX).toBe(16);
    expect(valid('Grandma Jo')).toBeNull();
    expect(valid('A'.repeat(16))).toBeNull();
    expect(valid('A'.repeat(17))).toMatch(/up to 16 characters/);
    expect(valid('Wolfeschlegelsteinhausenbergerdo')).toMatch(/up to 16/);
  });

  it('counts an emoji or a flag as one character', () => {
    expect(graphemes('👨\u200d👩\u200d👧\u200d👦🏴\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}1\ufe0f\u20e3é')).toHaveLength(4);
    expect(valid('🎉'.repeat(16))).toBeNull();
    expect(valid('🎉'.repeat(17))).toMatch(/up to 16/);
    expect(valid('👨\u200d👩\u200d👧\u200d👦 Family Night')).toBeNull();
  });

  it('tidies spaces and drops invisible characters', () => {
    expect(normalizeDisplayName('  Grandma \t\n  Jo  ')).toBe('Grandma Jo');
    expect(normalizeDisplayName('Jo\u00a0\u3000Ann')).toBe('Jo Ann');
    expect(normalizeDisplayName('Bob\u200b\u202e\u2066\ufeff\u00ad')).toBe('Bob');
    expect(normalizeDisplayName('Cafe\u0301')).toBe('Café');
    expect(normalizeDisplayName('Rosie\u2060\u034f')).toBe('Rosie');
    expect(normalizeDisplayName('Jo \ud83c')).toBe('Jo');
    // What's left of an emoji family when a paste gets cut off part way.
    expect(normalizeDisplayName('Jo \ud83d\udc68\u200d')).toBe('Jo \ud83d\udc68');
    expect(normalizeDisplayName('\u200d\u200dJo \u200d Ann')).toBe('Jo Ann');
  });

  it('leaves emoji and other scripts whole', () => {
    for (const name of [
      '👨\u200d👩\u200d👧\u200d👦',
      '🏳\ufe0f\u200d🌈 Jo',
      '1\ufe0f\u20e3 Fan',
      '🏴\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}',
      'द\u094dवि',
      'Nguyễn Thị Ánh',
      '\u1820\u180b \u1828\u180e\u1820',
      '山田太郎',
      'می\u200cخواهم',
    ]) {
      expect(normalizeDisplayName(name)).toBe(name);
      expect(valid(name)).toBeNull();
    }
  });

  it('gives the same name when tidied twice', () => {
    for (const raw of ['Cafe\u200b\u0301', '  a\u200b b ', 'Cafe\u0301', 'Z' + '\u0336'.repeat(9), '\u202eBob\t']) {
      const once = normalizeDisplayName(raw);
      expect(normalizeDisplayName(once)).toBe(once);
    }
  });

  it('drops joiner padding and stray tag characters', () => {
    expect(normalizeDisplayName('Bob' + '\u200c'.repeat(60))).toBe('Bob');
    expect(normalizeDisplayName('Bob\u{E0041}\u{E0042}')).toBe('Bob');
  });

  it('refuses names with nothing to see', () => {
    for (const blank of ['', '   ', '\u200b\u200b', '\u3164\u3164', '\u2800', '\n\t']) {
      expect(valid(blank)).toBe('Please enter a display name.');
    }
  });

  it('caps stacked accents so a name can’t grow tall', () => {
    const zalgo = 'Z' + '\u0336\u0337\u0338\u0339\u033a\u033b'.repeat(4);
    expect(normalizeDisplayName(zalgo)).toBe('Z\u0336\u0337\u0338\u0336');
    // Joiners or tags slipped between the accents don't get around the cap.
    for (const sep of ['\u200c', '\u200d', '\u{E0041}']) {
      expect(normalizeDisplayName('Z' + ('\u030d\u030e\u0304\u0305' + sep).repeat(12))).toBe('Z\u030d\u030e\u0304\u0305');
    }
    // A raw-length backstop catches what the character count alone would let through.
    expect(graphemes('𝒜\u0336\u0337\u0338'.repeat(13))).toHaveLength(13);
    expect(displayNameError('𝒜\u0336\u0337\u0338'.repeat(13))).toMatch(/up to 16/);
  });
});

describe('clipToLength', () => {
  it('never cuts a character in half', () => {
    expect(clipToLength('hello', 10)).toBe('hello');
    expect(clipToLength('abc🎉', 4)).toBe('abc');
    expect(clipToLength('Jo 👨\u200d👩\u200d👧\u200d👦', 10)).toBe('Jo ');
  });
});

describe('initials', () => {
  it('takes whole characters', () => {
    expect(initials('Grandma Jo')).toBe('GJ');
    expect(initials('Cali')).toBe('Ca');
    expect(initials('👨\u200d👩\u200d👧\u200d👦 Family Night 🎉')).toBe('👨\u200d👩\u200d👧\u200d👦🎉');
    expect(initials('🎉🎉🎉')).toBe('🎉🎉');
    expect(initials('   ')).toBe('?');
  });
});

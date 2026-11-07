import { describe, expect, it } from 'vitest';
import { checkCaption, checkUsername, normalizeCaption, normalizeUsername } from '../src/index.ts';

describe('username', () => {
  it('normalises to NFC lowercase', () => {
    expect(normalizeUsername('Ana_Example')).toBe('ana_example');
  });

  it('accepts only normalised [a-z0-9_] names of 3 to 30 characters', () => {
    expect(checkUsername('ana_1').ok).toBe(true);
    expect(checkUsername('Ana').ok).toBe(false);
    expect(checkUsername('an').ok).toBe(false);
    expect(checkUsername('a'.repeat(31)).ok).toBe(false);
    expect(checkUsername('ana-b').ok).toBe(false);
    // Cyrillic "а" (U+0430) looks like Latin "a": rejected by the charset, which blocks confusables.
    expect(checkUsername('аna').ok).toBe(false);
  });
});

describe('caption', () => {
  it('normalises decomposed characters to NFC', () => {
    const decomposed = 'café';
    expect(normalizeCaption(decomposed)).toBe('café');
    expect(checkCaption(decomposed).ok).toBe(false);
    expect(checkCaption(normalizeCaption(decomposed)).ok).toBe(true);
  });

  it('counts code points, not UTF-16 units, against the 1,000 limit', () => {
    expect(checkCaption('\u{1F600}'.repeat(1000)).ok).toBe(true);
    expect(checkCaption('\u{1F600}'.repeat(1001)).ok).toBe(false);
  });
});

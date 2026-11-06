import { describe, expect, it } from 'vitest';
import { parsePageRange, resolvePages } from '../src/print/printRange';

const pages = (input: string, count = 10) => {
  const r = parsePageRange(input, count);
  if (!r.ok) throw new Error(r.error);
  return r.pages;
};
const error = (input: string, count = 10) => {
  const r = parsePageRange(input, count);
  if (r.ok) throw new Error(`expected an error, got ${r.pages.join(',')}`);
  return r.error;
};

describe('parsePageRange', () => {
  it('reads single pages and ranges', () => {
    expect(pages('3')).toEqual([3]);
    expect(pages('1-3')).toEqual([1, 2, 3]);
    expect(pages('1-3, 7')).toEqual([1, 2, 3, 7]);
    expect(pages('1;4;6')).toEqual([1, 4, 6]);
  });

  it('supports open-ended ranges', () => {
    expect(pages('8-')).toEqual([8, 9, 10]);
    expect(pages('-3')).toEqual([1, 2, 3]);
    expect(pages('1-3, 9-')).toEqual([1, 2, 3, 9, 10]);
  });

  it('ignores spaces and empty parts', () => {
    expect(pages(' 2 - 4 ,, 6 , ')).toEqual([2, 3, 4, 6]);
  });

  it('sorts and removes duplicates when parts overlap', () => {
    expect(pages('5-7, 1, 6-8, 1')).toEqual([1, 5, 6, 7, 8]);
    expect(pages('9, 2')).toEqual([2, 9]);
  });

  it('accepts a range that is exactly the whole document', () => {
    expect(pages('1-10')).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(pages('1', 1)).toEqual([1]);
  });

  it('rejects empty input', () => {
    expect(error('')).toMatch(/enter the pages/i);
    expect(error('   ')).toMatch(/enter the pages/i);
    expect(error(' , ; ')).toMatch(/enter the pages/i);
  });

  it('rejects pages past the end and says how many there are', () => {
    expect(error('11')).toMatch(/page 11.*10 pages/i);
    expect(error('8-12')).toMatch(/page 12/i);
    expect(error('2', 1)).toMatch(/1 page\b/);
  });

  it('rejects page zero', () => {
    expect(error('0')).toMatch(/start at 1/i);
    expect(error('0-3')).toMatch(/start at 1/i);
  });

  it('rejects ranges that run backwards', () => {
    expect(error('5-2')).toMatch(/backwards/i);
  });

  it('rejects text that is not a page or range', () => {
    expect(error('abc')).toMatch(/isn't a page or a range/i);
    expect(error('1-2-3')).toMatch(/1-2-3/);
    expect(error('-')).toMatch(/isn't a page or a range/i);
    expect(error('1.5')).toMatch(/isn't a page or a range/i);
    expect(error('3 4')).toMatch(/"3 4" isn't a page or a range/i);
  });

  it('rejects any input for a document with no pages', () => {
    expect(error('1', 0)).toMatch(/no pages/i);
  });
});

describe('resolvePages', () => {
  it('all pages', () => {
    expect(resolvePages('all', 3, 2, '')).toEqual({ ok: true, pages: [1, 2, 3] });
  });

  it('the current page, kept inside the document', () => {
    expect(resolvePages('current', 5, 4, '')).toEqual({ ok: true, pages: [4] });
    expect(resolvePages('current', 5, 0, '')).toEqual({ ok: true, pages: [1] });
    expect(resolvePages('current', 5, 99, '')).toEqual({ ok: true, pages: [5] });
  });

  it('a typed range', () => {
    expect(resolvePages('range', 10, 1, '2-3')).toEqual({ ok: true, pages: [2, 3] });
    expect(resolvePages('range', 10, 1, '').ok).toBe(false);
  });

  it('nothing to print', () => {
    expect(resolvePages('all', 0, 0, '').ok).toBe(false);
  });
});

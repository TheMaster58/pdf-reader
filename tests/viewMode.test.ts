import { describe, expect, it } from 'vitest';
import {
  DEFAULT_VIEW_MODE,
  isPaged,
  parseViewMode,
  spreadPages,
  viewerSettings,
  type PageLayout,
  type ViewMode,
} from '../src/viewer/viewMode';

const mode = (layout: PageLayout, cover = false): ViewMode => ({ layout, cover });

describe('viewerSettings', () => {
  it('maps each layout to PDF.js scroll and spread settings', () => {
    expect(viewerSettings(mode('single'))).toEqual({ scroll: 'page', spread: 'none' });
    expect(viewerSettings(mode('single-continuous'))).toEqual({
      scroll: 'vertical',
      spread: 'none',
    });
    expect(viewerSettings(mode('two'))).toEqual({ scroll: 'page', spread: 'odd' });
    expect(viewerSettings(mode('two-continuous'))).toEqual({ scroll: 'vertical', spread: 'odd' });
  });

  it('the cover option turns odd pairing into even pairing, only in the two-page layouts', () => {
    expect(viewerSettings(mode('two', true))).toEqual({ scroll: 'page', spread: 'even' });
    expect(viewerSettings(mode('two-continuous', true))).toEqual({
      scroll: 'vertical',
      spread: 'even',
    });
    expect(viewerSettings(mode('single', true))).toEqual({ scroll: 'page', spread: 'none' });
    expect(viewerSettings(mode('single-continuous', true))).toEqual({
      scroll: 'vertical',
      spread: 'none',
    });
  });

  it('the default is today’s behaviour: one continuous column', () => {
    expect(viewerSettings(DEFAULT_VIEW_MODE)).toEqual({ scroll: 'vertical', spread: 'none' });
  });

  it('knows which layouts show one page (or pair) at a time', () => {
    expect(isPaged('single')).toBe(true);
    expect(isPaged('two')).toBe(true);
    expect(isPaged('single-continuous')).toBe(false);
    expect(isPaged('two-continuous')).toBe(false);
  });
});

describe('spreadPages', () => {
  it('is just the page in the one-page layouts', () => {
    expect(spreadPages(4, 10, mode('single'))).toEqual([4, 4]);
    expect(spreadPages(4, 10, mode('single-continuous', true))).toEqual([4, 4]);
  });

  it('pairs 1-2, 3-4... without a cover', () => {
    const m = mode('two');
    expect(spreadPages(1, 10, m)).toEqual([1, 2]);
    expect(spreadPages(2, 10, m)).toEqual([1, 2]);
    expect(spreadPages(3, 10, m)).toEqual([3, 4]);
    expect(spreadPages(10, 10, m)).toEqual([9, 10]);
  });

  it('leaves the last page alone when the page count is odd (no cover)', () => {
    const m = mode('two-continuous');
    expect(spreadPages(5, 5, m)).toEqual([5, 5]);
    expect(spreadPages(4, 5, m)).toEqual([3, 4]);
  });

  it('with a cover: 1, then 2-3, 4-5...', () => {
    const m = mode('two', true);
    expect(spreadPages(1, 10, m)).toEqual([1, 1]);
    expect(spreadPages(2, 10, m)).toEqual([2, 3]);
    expect(spreadPages(3, 10, m)).toEqual([2, 3]);
    expect(spreadPages(4, 10, m)).toEqual([4, 5]);
  });

  it('with a cover, an even page count leaves the last page alone', () => {
    const m = mode('two', true);
    expect(spreadPages(10, 10, m)).toEqual([10, 10]);
    expect(spreadPages(9, 10, m)).toEqual([8, 9]);
  });

  it('a one-page document is always [1, 1]', () => {
    expect(spreadPages(1, 1, mode('two'))).toEqual([1, 1]);
    expect(spreadPages(1, 1, mode('two', true))).toEqual([1, 1]);
  });

  it('clamps pages outside the document', () => {
    expect(spreadPages(0, 10, mode('two'))).toEqual([1, 2]);
    expect(spreadPages(99, 10, mode('two'))).toEqual([9, 10]);
    expect(spreadPages(NaN, 10, mode('two'))).toEqual([1, 2]);
  });
});

describe('parseViewMode', () => {
  it('accepts a valid stored value', () => {
    expect(parseViewMode({ layout: 'two', cover: true })).toEqual({ layout: 'two', cover: true });
  });

  it('falls back to the default for missing, wrong or hostile values', () => {
    for (const bad of [null, undefined, 5, 'two', [], {}, { layout: 'three' }, { layout: 7 }]) {
      expect(parseViewMode(bad)).toEqual(DEFAULT_VIEW_MODE);
    }
  });

  it('only a real true turns the cover option on', () => {
    expect(parseViewMode({ layout: 'two', cover: 'yes' }).cover).toBe(false);
    expect(parseViewMode({ layout: 'two', cover: 1 }).cover).toBe(false);
  });

  it('returns a fresh object, never the shared default', () => {
    const a = parseViewMode(null);
    a.cover = true;
    expect(DEFAULT_VIEW_MODE.cover).toBe(false);
  });
});

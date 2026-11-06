import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { ViewportLike } from '../src/annotations/geometry';
import { sampleColours, type RgbaImage } from '../src/pdf/pagePixels';
import { textWidth } from '../src/text/fontMetrics';
import {
  ASCENT,
  DESCENT,
  buildRuns,
  describeFont,
  replacementFrame,
  runAt,
  runBox,
  type RawTextItem,
  type TextRun,
} from '../src/pdf/textRuns';
import { BASELINE_EM, LINE_HEIGHT, TEXT_PADDING } from '../src/text/textLayout';

describe('describeFont', () => {
  it('uses PDF.js bold and italic flags when it has them', () => {
    expect(describeFont({ bold: true, italic: false, fallbackName: 'sans-serif' })).toEqual({
      fontFamily: 'Helvetica',
      bold: true,
      italic: false,
    });
    expect(describeFont({ bold: false, italic: true, fallbackName: 'serif' })).toEqual({
      fontFamily: 'Times',
      bold: false,
      italic: true,
    });
  });

  it('falls back to the serif / monospace hint when the name says nothing', () => {
    expect(describeFont({ fallbackName: 'serif' }).fontFamily).toBe('Times');
    expect(describeFont({ fallbackName: 'monospace' }).fontFamily).toBe('Courier');
    expect(describeFont({ fallbackName: 'sans-serif' }).fontFamily).toBe('Helvetica');
    expect(describeFont(undefined)).toEqual({
      fontFamily: 'Helvetica',
      bold: false,
      italic: false,
    });
  });

  it('reads the family and style from the font name, ignoring the subset prefix', () => {
    expect(describeFont({ name: 'ABCDEF+TimesNewRomanPS-BoldItalicMT' })).toEqual({
      fontFamily: 'Times',
      bold: true,
      italic: true,
    });
    expect(describeFont({ name: 'XYZABC+Arial-BoldMT' })).toMatchObject({
      fontFamily: 'Helvetica',
      bold: true,
    });
    expect(describeFont({ name: 'CourierNewPS-ItalicMT' })).toMatchObject({
      fontFamily: 'Courier',
      italic: true,
    });
    expect(describeFont({ name: 'Consolas' }).fontFamily).toBe('Courier');
    expect(describeFont({ name: 'Georgia-Bold' })).toMatchObject({
      fontFamily: 'Times',
      bold: true,
    });
    expect(describeFont({ name: 'Calibri-Light' }).fontFamily).toBe('Helvetica');
  });

  it('does not take "sans serif" for serif', () => {
    expect(describeFont({ name: 'OpenSans-Serif-Free' }).fontFamily).toBe('Helvetica');
    expect(describeFont({ name: 'Palatino-Roman' }).fontFamily).toBe('Times');
  });

  it('flags from PDF.js win over the name', () => {
    expect(describeFont({ name: 'Arial-BoldMT', bold: false })).toMatchObject({ bold: false });
  });
});

// A flat, unrotated page of 612 x 792 points: displayed y is 792 minus PDF y.
const flat = {
  convertToViewportPoint: (x: number, y: number): number[] => [x, 792 - y],
};
const item = (
  str: string,
  x: number,
  y: number,
  width: number,
  size = 12,
  fontName = 'f1',
): RawTextItem => ({
  str,
  transform: [size, 0, 0, size, x, y],
  width,
  height: size,
  fontName,
});

describe('buildRuns', () => {
  it('turns an item into a run in displayed points (y down)', () => {
    const [run] = buildRuns([item('Hello', 100, 700, 30)], flat);
    expect(run).toMatchObject({ text: 'Hello', left: 100, baseline: 92, width: 30, size: 12 });
  });

  it('joins items on one baseline, in the same font and size, with a word space between', () => {
    const runs = buildRuns([item('Hello', 100, 700, 30), item('world', 136, 700, 30)], flat);
    expect(runs).toHaveLength(1);
    expect(runs[0].text).toBe('Hello world');
    expect(runs[0].width).toBeCloseTo(66);
  });

  it('does not add a space when the pieces touch or already have one', () => {
    expect(buildRuns([item('Hel', 100, 700, 18), item('lo', 118, 700, 12)], flat)[0].text).toBe(
      'Hello',
    );
    expect(
      buildRuns([item('Hello ', 100, 700, 33), item('world', 133, 700, 30)], flat)[0].text,
    ).toBe('Hello world');
  });

  it('keeps separate runs for different fonts, sizes, lines and far-apart columns', () => {
    expect(
      buildRuns([item('a', 100, 700, 10, 12, 'f1'), item('b', 112, 700, 10, 12, 'f2')], flat),
    ).toHaveLength(2);
    expect(
      buildRuns([item('a', 100, 700, 10, 12), item('b', 112, 700, 10, 20)], flat),
    ).toHaveLength(2);
    expect(buildRuns([item('a', 100, 700, 10), item('b', 100, 680, 10)], flat)).toHaveLength(2);
    expect(buildRuns([item('a', 100, 700, 10), item('b', 300, 700, 10)], flat)).toHaveLength(2);
  });

  it('puts runs in reading order whatever order the items arrive in', () => {
    const runs = buildRuns(
      [item('second', 100, 680, 40), item('right', 300, 700, 30), item('left', 100, 700, 30)],
      flat,
    );
    expect(runs.map((r) => r.text)).toEqual(['left', 'right', 'second']);
  });

  it('skips empty and whitespace-only items (line-end markers)', () => {
    expect(
      buildRuns([item('', 100, 700, 0), item('   ', 100, 700, 10), item('x', 100, 700, 6)], flat),
    ).toHaveLength(1);
  });

  it('drops a duplicate drawn on top of itself (faux bold)', () => {
    const runs = buildRuns([item('Bold', 100, 700, 28), item('Bold', 100.3, 700, 28)], flat);
    expect(runs).toHaveLength(1);
    expect(runs[0].text).toBe('Bold');
  });

  it('normalises ligatures and compatibility characters so the text can be saved', () => {
    expect(buildRuns([item('ﬁnd ﬂow', 100, 700, 50)], flat)[0].text).toBe('find flow');
  });

  it('skips text that is slanted, vertical or mirrored (it cannot be edited)', () => {
    const slanted: RawTextItem = {
      ...item('x', 100, 700, 10),
      transform: [12, 4, 0, 12, 100, 700],
    };
    const vertical: RawTextItem = {
      ...item('x', 100, 700, 10),
      transform: [0, 12, -12, 0, 100, 700],
    };
    const mirrored: RawTextItem = {
      ...item('x', 100, 700, 10),
      transform: [-12, 0, 0, 12, 100, 700],
    };
    const upside: RawTextItem = {
      ...item('x', 100, 700, 10),
      transform: [12, 0, 0, -12, 100, 700],
    };
    expect(buildRuns([slanted, vertical, mirrored, upside], flat)).toEqual([]);
  });

  it('skips tiny text', () => {
    expect(buildRuns([item('x', 100, 700, 0.1, 0.2)], flat)).toEqual([]);
  });
});

describe('runAt and runBox', () => {
  const runs: TextRun[] = [
    { text: 'big', fontName: 'f', left: 100, baseline: 100, width: 200, size: 20 },
    { text: 'small', fontName: 'f', left: 120, baseline: 100, width: 40, size: 8 },
  ];

  it('the box reaches ASCENT above the baseline and DESCENT below it', () => {
    expect(runBox(runs[0])).toEqual({
      left: 100,
      top: 100 - ASCENT * 20,
      right: 300,
      bottom: 100 + DESCENT * 20,
    });
  });

  it('finds the run under a point, or nothing', () => {
    expect(runAt(runs, 250, 95)?.text).toBe('big');
    expect(runAt(runs, 250, 140)).toBeNull();
    expect(runAt(runs, 50, 95)).toBeNull();
  });

  it('prefers the smaller run where they overlap', () => {
    expect(runAt(runs, 130, 98)?.text).toBe('small');
  });
});

describe('replacementFrame', () => {
  const run: TextRun = {
    text: 'Hello world',
    fontName: 'f',
    left: 72,
    baseline: 112,
    width: 60,
    size: 12,
  };

  it('puts the first baseline of new text on the original baseline', () => {
    for (const family of ['Helvetica', 'Times', 'Courier'] as const) {
      const f = replacementFrame(run, family);
      const firstBaseline = f.top + TEXT_PADDING + BASELINE_EM[family] * run.size;
      expect(firstBaseline).toBeCloseTo(run.baseline, 9);
    }
  });

  it('starts new text at the original left edge (after the box padding)', () => {
    expect(replacementFrame(run, 'Helvetica').left + TEXT_PADDING).toBeCloseTo(run.left);
  });

  it('covers the old text, width and height, with a little to spare', () => {
    const f = replacementFrame(run, 'Helvetica');
    const box = runBox(run);
    expect(f.left).toBeLessThanOrEqual(box.left);
    expect(f.left + f.width).toBeGreaterThanOrEqual(box.right);
    expect(f.top).toBeLessThanOrEqual(box.top);
    expect(f.top + f.height).toBeGreaterThanOrEqual(box.bottom);
    expect(f.height).toBeGreaterThanOrEqual(2 * TEXT_PADDING + LINE_HEIGHT * run.size);
  });
});

describe('sampleColours', () => {
  /** An image of a flat colour with a few "ink" pixels (and some anti-aliased ones). */
  function image(
    bg: [number, number, number],
    ink: [number, number, number] | null,
    w = 40,
    h = 12,
  ): RgbaImage {
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) data.set([...bg, 255], i * 4);
    if (ink) {
      for (let x = 5; x < 35; x += 2) {
        for (let y = 3; y < 9; y++) data.set([...ink, 255], (y * w + x) * 4);
        // anti-aliased neighbour: halfway between ink and background
        data.set([...ink.map((v, k) => Math.round((v + bg[k]) / 2)), 255], (5 * w + x + 1) * 4);
      }
    }
    return { data, width: w, height: h };
  }

  it('finds black text on white paper', () => {
    expect(sampleColours(image([255, 255, 255], [0, 0, 0]))).toEqual({
      background: '#FFFFFF',
      text: '#000000',
    });
  });

  it('finds coloured text on a tinted background', () => {
    const s = sampleColours(image([255, 244, 200], [20, 60, 180]));
    expect(s.background).toBe('#FFF4C8');
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(s.text.slice(i, i + 2), 16));
    expect(Math.abs(r - 20)).toBeLessThan(12);
    expect(Math.abs(g - 60)).toBeLessThan(12);
    expect(Math.abs(b - 180)).toBeLessThan(12);
  });

  it('finds white text on a dark background', () => {
    expect(sampleColours(image([30, 40, 90], [255, 255, 255]))).toEqual({
      background: '#1E285A',
      text: '#FFFFFF',
    });
  });

  it('snaps near-white paper and near-black ink (rendering noise) to pure white and black', () => {
    const s = sampleColours(image([252, 253, 252], [6, 4, 8]));
    expect(s).toEqual({ background: '#FFFFFF', text: '#000000' });
  });

  it('is not fooled by anti-aliased edges: the true ink colour wins', () => {
    const s = sampleColours(image([255, 255, 255], [200, 0, 0]));
    expect(parseInt(s.text.slice(1, 3), 16)).toBeGreaterThan(180);
    expect(parseInt(s.text.slice(3, 5), 16)).toBeLessThan(40);
  });

  it('picks a readable colour when nothing differs from the background', () => {
    expect(sampleColours(image([255, 255, 255], null))).toEqual({
      background: '#FFFFFF',
      text: '#000000',
    });
    expect(sampleColours(image([10, 10, 10], null)).text).toBe('#FFFFFF');
  });

  it('copes with an empty region', () => {
    expect(sampleColours({ data: new Uint8ClampedArray(0), width: 0, height: 0 })).toEqual({
      background: '#FFFFFF',
      text: '#000000',
    });
  });
});

// Real output from PDF.js, on the unrotated sample and on pages turned 0, 90, 180 and 270 degrees.
describe('with real PDF.js text', () => {
  const pages: { viewport: ViewportLike; items: RawTextItem[] }[] = [];
  let sample: { viewport: ViewportLike; items: RawTextItem[] };
  let destroy: () => Promise<void> = async () => {};

  beforeAll(async () => {
    const load = async (name: string) => {
      const data = new Uint8Array(readFileSync(join(__dirname, 'fixtures', name)));
      const task = getDocument({ data, useSystemFonts: true });
      const doc = await task.promise;
      const out: { viewport: ViewportLike; items: RawTextItem[] }[] = [];
      for (let n = 1; n <= doc.numPages; n++) {
        const page = await doc.getPage(n);
        const content = await page.getTextContent();
        out.push({
          viewport: page.getViewport({ scale: 1 }),
          items: content.items.filter(
            (i): i is typeof i & { str: string } => 'str' in i,
          ) as unknown as RawTextItem[],
        });
      }
      return { out, task };
    };
    const a = await load('sample.pdf');
    sample = a.out[0];
    const b = await load('rotated.pdf');
    pages.push(...b.out);
    destroy = async () => {
      await a.task.destroy();
      await b.task.destroy();
    };
  });
  afterAll(() => destroy());

  it('finds the heading and three body lines of the sample page, each as one run', () => {
    const runs = buildRuns(sample.items, sample.viewport);
    const texts = runs.map((r) => r.text);
    expect(texts).toContain('Page 1 of 30');
    expect(texts).toContain('The quick brown fox jumps over the lazy dog.');
    expect(texts).toContain('Pack my box with five dozen liquor jugs.');
    expect(texts).toContain('Sphinx of black quartz, judge my vow.');
  });

  it('puts the body line where the file drew it: left 72, baseline 792 - 680, size 12', () => {
    const run = buildRuns(sample.items, sample.viewport).find((r) =>
      r.text.startsWith('The quick'),
    )!;
    expect(run.left).toBeCloseTo(72, 3);
    expect(run.baseline).toBeCloseTo(792 - 680, 3);
    expect(run.size).toBeCloseTo(12, 3);
    expect(run.width).toBeCloseTo(240.768, 2);
  });

  it('the click position over a line finds that line', () => {
    const runs = buildRuns(sample.items, sample.viewport);
    expect(runAt(runs, 150, 792 - 684)?.text).toMatch(/^The quick/);
    expect(runAt(runs, 150, 792 - 664)?.text).toMatch(/^Pack my box/);
  });

  it('only the unturned page of rotated.pdf has editable text: on the others the file draws it sideways or upside down', () => {
    expect(pages.length).toBe(4);
    const found = pages.map((p) => ({
      rotation: p.viewport.rotation,
      runs: buildRuns(p.items, p.viewport).filter((r) => /^Rotated [0-9]+ degrees$/.test(r.text))
        .length,
    }));
    expect(found).toEqual([
      { rotation: 0, runs: 1 },
      { rotation: 90, runs: 0 },
      { rotation: 180, runs: 0 },
      { rotation: 270, runs: 0 },
    ]);
  });
});

describe('text that reads upright on a turned page', () => {
  it('is found at the displayed position, size and text, for every rotation', async () => {
    const { PDFDocument, StandardFonts, degrees } = await import('pdf-lib');
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const angles = [0, 90, 180, 270];
    // Where each line starts so that all of it is on the page: it runs right, up, left or down.
    const starts: Record<number, [number, number]> = {
      0: [100, 300],
      90: [300, 100],
      180: [500, 300],
      270: [300, 500],
    };
    for (const angle of angles) {
      const page = doc.addPage([612, 792]);
      page.setRotation(degrees(angle));
      // Turned the opposite way to the page, so it reads upright once the page is displayed.
      page.drawText('Upright on a turned page', {
        x: starts[angle][0],
        y: starts[angle][1],
        size: 24,
        font,
        rotate: degrees(angle),
      });
    }
    const bytes = await doc.save();
    const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: true });
    const pdf = await task.promise;
    for (let n = 1; n <= angles.length; n++) {
      const page = await pdf.getPage(n);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const items = content.items.filter((i) => 'str' in i) as unknown as RawTextItem[];
      const runs = buildRuns(items, viewport);
      expect(runs, 'rotation ' + angles[n - 1]).toHaveLength(1);
      const origin = viewport.convertToViewportPoint(...starts[angles[n - 1]]);
      expect(runs[0].text).toBe('Upright on a turned page');
      expect(runs[0].size).toBeCloseTo(24, 3);
      expect(runs[0].left).toBeCloseTo(origin[0], 3);
      expect(runs[0].baseline).toBeCloseTo(origin[1], 3);
      expect(runs[0].width).toBeCloseTo(textWidth('Helvetica', 24, 'Upright on a turned page'), 1);
      // A click on the displayed text finds it.
      expect(runAt(runs, runs[0].left + runs[0].width / 2, runs[0].baseline - 8)).toBe(runs[0]);
    }
    await task.destroy();
  });
});

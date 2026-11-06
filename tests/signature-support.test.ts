import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PDFDocument, PDFHexString, PDFName } from 'pdf-lib';
import type { SignatureArtwork } from '../src/annotations/model';
import { extractAnnotations } from '../src/pdf/annotIO';
import { findEmptySignatureFields } from '../src/pdf/signatureFields';
import {
  MAX_PNG_BYTES,
  dataUrlToPng,
  looksLikePng,
  pngSize,
  pngToDataUrl,
} from '../src/signature/pngData';
import {
  MAX_SAVED_PER_VARIANT,
  addSaved,
  clearSavedSignatures,
  fitToSize,
  loadSavedSignatures,
  parseSavedSignatures,
  removeSaved,
  storeSavedSignatures,
  validateArtwork,
  type SavedSignature,
} from '../src/signature/savedSignatures';
import {
  MAX_IMAGE_WIDTH,
  fitWithin,
  inkBounds,
  whiteToTransparent,
} from '../src/signature/imageTools';
import { makePng, toDataUrl } from './helpers/png';

const N = (name: string) => PDFName.of(name);
const png = makePng(6, 3, () => [10, 10, 10, 255]);
const strokes: Extract<SignatureArtwork, { type: 'strokes' }> = {
  type: 'strokes',
  strokes: [
    [
      [1, 2],
      [3, 4],
    ],
  ],
  color: '#000000',
  width: 3,
  box: [10, 10],
};
const image = {
  type: 'image' as const,
  pngDataUrl: toDataUrl(png),
  size: [6, 3] as [number, number],
};

describe('png data', () => {
  it('round-trips bytes through a data URL', () => {
    expect(dataUrlToPng(pngToDataUrl(png))).toEqual(png);
    expect(pngToDataUrl(png).startsWith('data:image/png;base64,')).toBe(true);
  });

  it('reads the size from the header', () => {
    expect(pngSize(png)).toEqual([6, 3]);
    expect(pngSize(new Uint8Array(10))).toBeNull();
  });

  it('recognises a PNG by its signature', () => {
    expect(looksLikePng(png)).toBe(true);
    expect(looksLikePng(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]))).toBe(false);
  });

  it('rejects anything else, including other image types, bad base64 and oversize data', () => {
    for (const bad of [
      null,
      undefined,
      42,
      'hello',
      'data:image/jpeg;base64,/9j/4AAQ',
      'data:image/png;base64,@@@@',
      'data:image/png;base64,AAAA', // valid base64 but not a PNG
      'data:text/html;base64,PGI+',
      'javascript:alert(1)',
      'data:image/png;base64,' + 'A'.repeat((MAX_PNG_BYTES * 4) / 3 + 100),
    ]) {
      expect(dataUrlToPng(bad), String(bad).slice(0, 40)).toBeNull();
    }
  });

  it('handles pictures bigger than one base64 chunk', () => {
    const big = makePng(300, 300, (x, y) => [x % 256, y % 256, 0, 255]);
    expect(big.length).toBeGreaterThan(0x8000 / 4);
    expect(dataUrlToPng(pngToDataUrl(big))).toEqual(big);
  });
});

describe('validateArtwork', () => {
  it('accepts good strokes and pictures', () => {
    expect(validateArtwork(strokes)).toEqual(strokes);
    expect(validateArtwork(image)).toEqual(image);
  });

  it('takes the picture size from the picture, not from what the data claims', () => {
    const lying = { ...image, size: [999, 999] };
    expect(validateArtwork(lying)).toMatchObject({ size: [6, 3] });
  });

  it('rejects damaged artwork', () => {
    for (const bad of [
      null,
      'x',
      {},
      { type: 'strokes' },
      { ...strokes, strokes: [] },
      { ...strokes, color: 'red' },
      { ...strokes, color: '#12345' },
      { ...strokes, width: 0 },
      { ...strokes, width: 500 },
      { ...strokes, box: [0, 10] },
      { ...strokes, box: [10] },
      { ...strokes, strokes: [[[NaN, 1]]] },
      { type: 'image', pngDataUrl: 'data:image/png;base64,AAAA', size: [1, 1] },
      { type: 'image' },
      { type: 'video' },
    ]) {
      expect(validateArtwork(bad), JSON.stringify(bad)?.slice(0, 60)).toBeNull();
    }
  });
});

describe('saved signatures', () => {
  const entry = (
    id: string,
    variant: 'signature' | 'initials' = 'signature',
    created = '2024-01-01T00:00:00.000Z',
  ): SavedSignature => ({
    id,
    variant,
    artwork: strokes,
    created,
  });

  it('parses a good list, keeping its order', () => {
    const list = [entry('a'), entry('b', 'initials')];
    expect(parseSavedSignatures(JSON.parse(JSON.stringify(list)))).toEqual(list);
  });

  it('drops damaged entries without losing the good ones', () => {
    const out = parseSavedSignatures([
      entry('a'),
      null,
      'junk',
      { id: 'x', variant: 'banner', artwork: strokes, created: 'now' },
      { id: 'y', variant: 'signature', artwork: { type: 'strokes' } },
      entry('b'),
    ]);
    expect(out.map((e) => e.id)).toEqual(['a', 'b']);
  });

  it('copes with something that is not a list at all', () => {
    for (const bad of [null, undefined, 5, 'x', {}, { a: 1 }])
      expect(parseSavedSignatures(bad)).toEqual([]);
  });

  it('makes ids unique and fills in missing ones', () => {
    const out = parseSavedSignatures([
      entry('same'),
      entry('same'),
      { ...entry('x'), id: undefined },
    ]);
    expect(new Set(out.map((e) => e.id)).size).toBe(3);
  });

  it('applies the per-kind limit however many are stored', () => {
    const many = Array.from({ length: MAX_SAVED_PER_VARIANT + 4 }, (_, i) => entry(`s${i}`));
    expect(parseSavedSignatures(many)).toHaveLength(MAX_SAVED_PER_VARIANT);
  });

  it('puts a new one first and drops the oldest of that kind when full', () => {
    let list: SavedSignature[] = [];
    for (let i = 0; i < MAX_SAVED_PER_VARIANT; i++) list = addSaved(list, entry(`s${i}`));
    list = addSaved(list, entry('initials1', 'initials'));
    list = addSaved(list, entry('new'));
    expect(list[0].id).toBe('new');
    expect(list.filter((e) => e.variant === 'signature')).toHaveLength(MAX_SAVED_PER_VARIANT);
    expect(list.some((e) => e.id === 's0')).toBe(false); // the oldest signature went
    expect(list.some((e) => e.id === 'initials1')).toBe(true); // initials are a separate list
  });

  it('removes one by id', () => {
    expect(removeSaved([entry('a'), entry('b')], 'a').map((e) => e.id)).toEqual(['b']);
    expect(removeSaved([entry('a')], 'zzz')).toHaveLength(1);
  });

  it('trims the oldest entries until the list fits the size cap', () => {
    const list = [entry('new'), entry('mid'), entry('old')];
    const one = JSON.stringify([list[0]]).length;
    expect(fitToSize(list, one + 5).map((e) => e.id)).toEqual(['new']);
    expect(fitToSize(list, 10_000_000)).toHaveLength(3);
    expect(fitToSize(list, 1)).toEqual([]);
  });
});

describe('saved signatures in storage', () => {
  let store: Record<string, string>;
  let failWrites: boolean;

  beforeEach(() => {
    store = {};
    failWrites = false;
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => (k in store ? store[k] : null),
      setItem: (k: string, v: string) => {
        if (failWrites) throw new Error('QuotaExceededError');
        store[k] = v;
      },
      removeItem: (k: string) => {
        delete store[k];
      },
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  const entry = (id: string): SavedSignature => ({
    id,
    variant: 'signature',
    artwork: strokes,
    created: '2024-01-01T00:00:00.000Z',
  });

  it('saves and loads', () => {
    expect(storeSavedSignatures([entry('a'), entry('b')])).toBe(true);
    expect(loadSavedSignatures().map((e) => e.id)).toEqual(['a', 'b']);
  });

  it('loads an empty list when nothing is stored, or the stored text is garbage', () => {
    expect(loadSavedSignatures()).toEqual([]);
    store['pdfreader.signatures'] = '{not json';
    expect(loadSavedSignatures()).toEqual([]);
    store['pdfreader.signatures'] = '"a string"';
    expect(loadSavedSignatures()).toEqual([]);
  });

  it('survives hostile stored data (a script in a picture, absurd numbers)', () => {
    store['pdfreader.signatures'] = JSON.stringify([
      {
        id: 'evil',
        variant: 'signature',
        artwork: { type: 'image', pngDataUrl: 'javascript:alert(1)', size: [1, 1] },
      },
      { id: 'big', variant: 'signature', artwork: { ...strokes, strokes: [[[1e12, 0]]] } },
      entry('fine'),
    ]);
    expect(loadSavedSignatures().map((e) => e.id)).toEqual(['fine']);
  });

  it('reports failure when the browser will not store it', () => {
    failWrites = true;
    expect(storeSavedSignatures([entry('a')])).toBe(false);
  });

  it('removes everything', () => {
    storeSavedSignatures([entry('a')]);
    clearSavedSignatures();
    expect(loadSavedSignatures()).toEqual([]);
    expect('pdfreader.signatures' in store).toBe(false);
  });
});

describe('image tools', () => {
  const px = (r: number, g: number, b: number, a = 255) => [r, g, b, a];
  const data = (...pixels: number[][]) => new Uint8ClampedArray(pixels.flat());

  it('makes white paper transparent and dark ink opaque', () => {
    const d = data(px(255, 255, 255), px(0, 0, 0), px(240, 240, 240));
    whiteToTransparent(d);
    expect(d[3]).toBe(0);
    expect(d[7]).toBe(255);
    expect(d[11]).toBe(0);
  });

  it('keeps the soft edge of a stroke partly see-through, and the ink colour', () => {
    const d = data(px(20, 40, 160), px(190, 190, 220));
    whiteToTransparent(d);
    expect(d.slice(0, 3)).toEqual(new Uint8ClampedArray([20, 40, 160]));
    expect(d[3]).toBe(255);
    expect(d[7]).toBeGreaterThan(0);
    expect(d[7]).toBeLessThan(255);
  });

  it('respects transparency that was already there', () => {
    const d = data(px(0, 0, 0, 0), px(0, 0, 0, 128));
    whiteToTransparent(d);
    expect(d[3]).toBe(0);
    expect(d[7]).toBe(128);
  });

  it('finds the box around the ink', () => {
    // 4x3 picture with ink at (1,1) and (2,2).
    const d = new Uint8ClampedArray(4 * 3 * 4);
    d[(1 * 4 + 1) * 4 + 3] = 255;
    d[(2 * 4 + 2) * 4 + 3] = 255;
    expect(inkBounds(d, 4, 3)).toEqual({ left: 1, top: 1, width: 2, height: 2 });
  });

  it('ignores faint specks and reports nothing for a blank picture', () => {
    const blank = new Uint8ClampedArray(4 * 4 * 4);
    expect(inkBounds(blank, 4, 4)).toBeNull();
    blank[3] = 10; // below the threshold
    expect(inkBounds(blank, 4, 4)).toBeNull();
  });

  it('scales to fit, keeps the shape, and never enlarges', () => {
    expect(fitWithin(1200, 400, MAX_IMAGE_WIDTH, 300)).toEqual([600, 200]);
    expect(fitWithin(400, 900, 600, 300)).toEqual([133, 300]);
    expect(fitWithin(100, 50, 600, 300)).toEqual([100, 50]);
    expect(fitWithin(0, 50, 600, 300)).toEqual([1, 1]);
  });
});

describe('finding empty signature fields', () => {
  async function pdfWith(literals: Record<string, unknown>[], page2 = false) {
    const doc = await PDFDocument.create();
    const page = doc.addPage([612, 792]);
    const other = page2 ? doc.addPage([612, 792]) : null;
    const ctx = doc.context;
    const make = (l: Record<string, unknown>) =>
      ctx.register(
        ctx.obj({ Type: 'Annot', Subtype: 'Widget', Rect: [100, 100, 300, 160], ...l } as never),
      );
    page.node.set(N('Annots'), ctx.obj(literals.filter((l) => l.__page !== 2).map(make)));
    if (other)
      other.node.set(
        N('Annots'),
        ctx.obj(
          literals.filter((l) => l.__page === 2).map((l) => make({ ...l, __page: undefined })),
        ),
      );
    return doc;
  }

  it('finds an empty signature field and its rectangle', async () => {
    const doc = await pdfWith([{ FT: 'Sig', T: 'Signature1' }]);
    expect(findEmptySignatureFields(doc)).toEqual([{ pageIndex: 0, rect: [100, 100, 300, 160] }]);
  });

  it('skips fields that are already signed', async () => {
    const doc = await pdfWith([
      { FT: 'Sig', V: { Type: 'Sig', ByteRange: [0, 1, 2, 3], Contents: PDFHexString.of('00') } },
    ]);
    expect(findEmptySignatureFields(doc)).toEqual([]);
  });

  it('skips other kinds of form field', async () => {
    const doc = await pdfWith([{ FT: 'Tx', T: 'Name' }, { FT: 'Btn', T: 'Check' }, {}]);
    expect(findEmptySignatureFields(doc)).toEqual([]);
  });

  it('skips hidden fields and ones too small to click', async () => {
    const doc = await pdfWith([
      { FT: 'Sig', F: 2 },
      { FT: 'Sig', F: 32 },
      { FT: 'Sig', Rect: [0, 0, 0, 0] },
      { FT: 'Sig', Rect: [10, 10, 14, 14] },
    ]);
    expect(findEmptySignatureFields(doc)).toEqual([]);
  });

  it('normalises a rectangle given in the other corner order', async () => {
    const doc = await pdfWith([{ FT: 'Sig', Rect: [300, 160, 100, 100] }]);
    expect(findEmptySignatureFields(doc)[0].rect).toEqual([100, 100, 300, 160]);
  });

  it('reads the field type and value from the parent field', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([612, 792]);
    const ctx = doc.context;
    const parent = ctx.register(ctx.obj({ FT: 'Sig', T: 'Group' }));
    const signedParent = ctx.register(
      ctx.obj({
        FT: 'Sig',
        T: 'Signed',
        V: { Type: 'Sig', ByteRange: [0, 1, 2, 3], Contents: PDFHexString.of('00') },
      }),
    );
    const child = ctx.register(
      ctx.obj({
        Type: 'Annot',
        Subtype: 'Widget',
        Parent: parent,
        Rect: [10, 10, 110, 60],
      } as never),
    );
    const signedChild = ctx.register(
      ctx.obj({
        Type: 'Annot',
        Subtype: 'Widget',
        Parent: signedParent,
        Rect: [10, 100, 110, 160],
      } as never),
    );
    page.node.set(N('Annots'), ctx.obj([child, signedChild]));
    expect(findEmptySignatureFields(doc)).toEqual([{ pageIndex: 0, rect: [10, 10, 110, 60] }]);
  });

  it('keeps track of the page', async () => {
    const doc = await pdfWith(
      [{ FT: 'Sig' }, { FT: 'Sig', __page: 2, Rect: [20, 20, 120, 80] }],
      true,
    );
    expect(findEmptySignatureFields(doc)).toEqual([
      { pageIndex: 0, rect: [100, 100, 300, 160] },
      { pageIndex: 1, rect: [20, 20, 120, 80] },
    ]);
  });

  it('survives odd data: a parent loop, a missing rectangle, a rectangle of the wrong kind', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([612, 792]);
    const ctx = doc.context;
    const a = ctx.nextRef();
    ctx.assign(
      a,
      ctx.obj({ Type: 'Annot', Subtype: 'Widget', Parent: a, Rect: [0, 0, 100, 50] } as never),
    ); // loops on itself
    const noRect = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Widget', FT: 'Sig' } as never));
    const badRect = ctx.register(
      ctx.obj({ Type: 'Annot', Subtype: 'Widget', FT: 'Sig', Rect: 'nope' } as never),
    );
    page.node.set(N('Annots'), ctx.obj([a, noRect, badRect, 'junk']));
    expect(findEmptySignatureFields(doc)).toEqual([]);
  });

  it('is part of extraction, so the app learns of the fields when a file is opened', async () => {
    const doc = await pdfWith([{ FT: 'Sig' }]);
    const { signatureFields, annotations, viewBytes } = await extractAnnotations(await doc.save());
    expect(signatureFields).toEqual([{ pageIndex: 0, rect: [100, 100, 300, 160] }]);
    // A form field is not one of our annotations: it is left alone and still drawn by PDF.js.
    expect(annotations).toEqual([]);
    expect(viewBytes).toBeNull();
  });
});

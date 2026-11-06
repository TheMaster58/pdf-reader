import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFString } from 'pdf-lib';
import {
  createHighlight,
  createNote,
  type Annotation,
  type HighlightAnnotation,
  type NoteAnnotation,
} from '../src/annotations/model';
import { UnsupportedPdfError, extractAnnotations, writeAnnotations } from '../src/pdf/annotIO';
import { acrobatStylePdf } from './helpers/foreignPdf';

/** Highlights and notes: the kinds that carry a colour and a comment. */
type Commented = HighlightAnnotation | NoteAnnotation;
const commented = (list: Annotation[]) => list as Commented[];

const fixture = (name: string) => new Uint8Array(readFileSync(join(__dirname, 'fixtures', name)));

async function blankPdf(pages = 3): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([612, 792]);
  return doc.save();
}

/** The fields of PDF.js's annotation data that these tests look at. */
interface PdfJsAnnotation {
  subtype: string;
  rect: number[];
  quadPoints: Float32Array;
  color: Uint8ClampedArray;
  contentsObj: { str: string };
  titleObj: { str: string };
  hasAppearance: boolean;
  annotationFlags: number;
}

/** Annotations as PDF.js sees them on one page. */
async function pdfjsAnnotations(bytes: Uint8Array, pageNumber: number): Promise<PdfJsAnnotation[]> {
  const task = getDocument({ data: bytes.slice(), useSystemFonts: true });
  const doc = await task.promise;
  try {
    return (await (await doc.getPage(pageNumber)).getAnnotations()) as unknown as PdfJsAnnotation[];
  } finally {
    await task.destroy();
  }
}

/** Annotation subtypes on a page, read with pdf-lib (PDF.js hides annotations with no geometry). */
async function pdfLibSubtypes(bytes: Uint8Array, pageIndex = 0): Promise<string[]> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const annots = doc.getPages()[pageIndex].node.Annots();
  const out: string[] = [];
  for (let i = 0; i < (annots?.size() ?? 0); i++) {
    const d = doc.context.lookupMaybe(annots!.get(i), PDFDict);
    const st = d?.get(PDFName.of('Subtype'));
    if (st instanceof PDFName) out.push(st.decodeText());
  }
  return out;
}

/** Every dict in the file that has a /Contents string, decoded. Detects leftover objects. */
async function allContentsStrings(bytes: Uint8Array): Promise<string[]> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const out: string[] = [];
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFDict)) continue;
    const c = obj.get(PDFName.of('Contents'));
    if (c instanceof PDFString || c instanceof PDFHexString) out.push(c.decodeText());
  }
  return out;
}

const round = (v: number) => Math.round(v * 100) / 100;

const sampleHighlight = (over: Partial<HighlightAnnotation> = {}): HighlightAnnotation => ({
  ...createHighlight({
    pageIndex: 0,
    rects: [
      [72, 680, 300, 694],
      [72, 662, 210, 676],
    ],
    color: '#8FE388',
    text: 'quick brown fox',
    author: 'Alex',
  }),
  contents: 'check this',
  ...over,
});

const sampleNote = (over: Partial<NoteAnnotation> = {}): NoteAnnotation => ({
  ...createNote({ pageIndex: 1, point: [200, 500], color: '#FF9EC4', author: 'Alex' }),
  contents: 'call bob',
  ...over,
});

describe('writeAnnotations: what other readers see (PDF.js)', () => {
  it('writes a highlight with quad points, colour, comment and popup', async () => {
    const out = await writeAnnotations(await blankPdf(), [sampleHighlight()]);
    const annots = await pdfjsAnnotations(out, 1);
    const hl = annots.find((a) => a.subtype === 'Highlight')!;
    expect(hl).toBeDefined();
    // Two lines -> two quads of 8 numbers, first one top-left, top-right, bottom-left, bottom-right.
    expect(Array.from(hl.quadPoints).map(round)).toEqual([
      72, 694, 300, 694, 72, 680, 300, 680, 72, 676, 210, 676, 72, 662, 210, 662,
    ]);
    expect(Array.from(hl.color)).toEqual([143, 227, 136]);
    expect(hl.contentsObj.str).toBe('check this');
    expect(hl.titleObj.str).toBe('Alex');
    expect(hl.hasAppearance).toBe(true);
    // Comment present -> a linked popup annotation exists.
    expect(annots.some((a) => a.subtype === 'Popup')).toBe(true);
    expect(hl.rect.map(round)).toEqual([72, 662, 300, 694]);
  });

  it('writes a sticky note as a Text annotation with an icon appearance', async () => {
    const out = await writeAnnotations(await blankPdf(), [sampleNote()]);
    const annots = await pdfjsAnnotations(out, 2);
    const note = annots.find((a) => a.subtype === 'Text')!;
    expect(note).toBeDefined();
    expect(note.contentsObj.str).toBe('call bob');
    expect(Array.from(note.color)).toEqual([255, 158, 196]);
    expect(note.hasAppearance).toBe(true);
    // Rect hangs 24x24 below-right of the stored top-left point.
    expect(note.rect.map(round)).toEqual([200, 476, 224, 500]);
    // Print + NoZoom + NoRotate.
    expect(note.annotationFlags).toBe(28);
  });

  it('omits the popup when there is no comment', async () => {
    const out = await writeAnnotations(await blankPdf(), [sampleHighlight({ contents: '' }), sampleNote({ contents: '   ' })]);
    expect((await pdfjsAnnotations(out, 1)).filter((a) => a.subtype === 'Popup')).toHaveLength(0);
    expect((await pdfjsAnnotations(out, 2)).filter((a) => a.subtype === 'Popup')).toHaveLength(0);
  });

  it('puts annotations on the right pages', async () => {
    const out = await writeAnnotations(await blankPdf(), [
      sampleHighlight({ pageIndex: 2 }),
      sampleNote({ pageIndex: 0 }),
    ]);
    expect((await pdfjsAnnotations(out, 1)).map((a) => a.subtype)).toContain('Text');
    expect((await pdfjsAnnotations(out, 2)).filter((a) => a.subtype !== 'Popup')).toHaveLength(0);
    expect((await pdfjsAnnotations(out, 3)).map((a) => a.subtype)).toContain('Highlight');
  });

  it('ignores annotations for pages that do not exist', async () => {
    const out = await writeAnnotations(await blankPdf(1), [sampleHighlight({ pageIndex: 7 })]);
    expect((await pdfjsAnnotations(out, 1)).filter((a) => a.subtype !== 'Popup')).toHaveLength(0);
  });
});

describe('round trip through extractAnnotations', () => {
  it('returns the same annotations that were written', async () => {
    const written: Commented[] = [sampleHighlight(), sampleNote(), sampleHighlight({ pageIndex: 2, contents: '' })];
    const saved = await writeAnnotations(await blankPdf(), written);
    const annotations = commented((await extractAnnotations(saved)).annotations);

    expect(annotations).toHaveLength(3);
    for (const w of written) {
      const r = annotations.find((a) => a.id === w.id)!; // ids survive via /NM
      expect(r).toBeDefined();
      expect(r.kind).toBe(w.kind);
      expect(r.pageIndex).toBe(w.pageIndex);
      expect(r.color.toLowerCase()).toBe(w.color.toLowerCase());
      expect(r.contents).toBe(w.contents);
      expect(r.author).toBe(w.author);
      expect(r.created.slice(0, 19)).toBe(w.created.slice(0, 19)); // PDF dates have 1 s resolution
      expect(r.modified.slice(0, 19)).toBe(w.modified.slice(0, 19));
      if (w.kind === 'highlight' && r.kind === 'highlight') {
        expect(r.rects.map((x) => x.map(round))).toEqual(w.rects.map((x) => x.map(round)));
      }
      if (w.kind === 'note' && r.kind === 'note') {
        expect(r.point.map(round)).toEqual(w.point.map(round));
      }
    }
  });

  it('preserves non-ASCII text in comments and author', async () => {
    const text = 'Zażółć gęślą jaźń 日本語 😀';
    const saved = await writeAnnotations(await blankPdf(), [sampleHighlight({ contents: text, author: 'Łukasz' })]);
    const [a] = commented((await extractAnnotations(saved)).annotations);
    expect(a.contents).toBe(text);
    expect(a.author).toBe('Łukasz');
    expect((await pdfjsAnnotations(saved, 1)).find((x) => x.subtype === 'Highlight')!.contentsObj.str).toBe(text);
  });

  it('survives many save cycles without duplicating anything', async () => {
    const original = await blankPdf();
    let anns: Annotation[] = [sampleHighlight(), sampleNote()];
    let saved = await writeAnnotations(original, anns);
    for (let i = 0; i < 4; i++) {
      // The app always rewrites from the original bytes with the current in-memory set.
      saved = await writeAnnotations(original, anns);
    }
    // And a document that was saved by us and then opened again behaves the same.
    const reopened = (await extractAnnotations(saved)).annotations;
    expect(reopened).toHaveLength(2);
    const resaved = await writeAnnotations(saved, reopened);
    expect((await extractAnnotations(resaved)).annotations).toHaveLength(2);
    expect((await pdfjsAnnotations(resaved, 1)).filter((a) => a.subtype === 'Highlight')).toHaveLength(1);
    anns = [];
    expect((await extractAnnotations(await writeAnnotations(saved, anns))).annotations).toHaveLength(0);
  });

  it('an empty set removes previously saved annotations', async () => {
    const saved = await writeAnnotations(await blankPdf(), [sampleHighlight(), sampleNote()]);
    const cleared = await writeAnnotations(saved, []);
    const { annotations } = await extractAnnotations(cleared);
    expect(annotations).toHaveLength(0);
    expect((await pdfjsAnnotations(cleared, 1)).filter((a) => a.subtype !== 'Popup')).toHaveLength(0);
  });

  it('works on rotated pages', async () => {
    const original = fixture('rotated.pdf');
    const hl = sampleHighlight({ pageIndex: 1, rects: [[74, 710, 291, 738]] });
    const saved = await writeAnnotations(original, [hl]);
    const [back] = (await extractAnnotations(saved)).annotations as HighlightAnnotation[];
    expect(back.pageIndex).toBe(1);
    expect(back.rects[0].map(round)).toEqual([74, 710, 291, 738]);
  });
});

describe('extractAnnotations: the display copy', () => {
  it('returns no copy when the file has nothing of ours', async () => {
    const r = await extractAnnotations(fixture('sample.pdf'));
    expect(r.annotations).toHaveLength(0);
    expect(r.viewBytes).toBeNull();
  });

  it('removes our annotations but keeps links and everything else', async () => {
    // sample.pdf has two link annotations on page 1.
    const withLinks = fixture('sample.pdf');
    const saved = await writeAnnotations(withLinks, [sampleHighlight()]);
    const { annotations, viewBytes } = await extractAnnotations(saved);
    expect(annotations).toHaveLength(1);
    expect(viewBytes).not.toBeNull();
    const subtypes = (await pdfjsAnnotations(viewBytes!, 1)).map((a) => a.subtype).sort();
    expect(subtypes).toEqual(['Link', 'Link']);
  });

  it('keeps the links intact in the saved file too', async () => {
    const saved = await writeAnnotations(fixture('sample.pdf'), [sampleHighlight()]);
    const subtypes = (await pdfjsAnnotations(saved, 1)).map((a) => a.subtype).filter((s) => s !== 'Popup').sort();
    expect(subtypes).toEqual(['Highlight', 'Link', 'Link']);
  });
});

describe('privacy: removed annotations are really gone', () => {
  it('does not leave deleted comments behind as orphaned objects', async () => {
    const secret = 'TOP-SECRET-COMMENT-42';
    const saved = await writeAnnotations(await blankPdf(), [sampleHighlight({ contents: secret })]);
    expect(await allContentsStrings(saved)).toContain(secret);

    const cleared = await writeAnnotations(saved, []);
    expect(await allContentsStrings(cleared)).not.toContain(secret);
  });

  it('also purges the comment from the display copy', async () => {
    const secret = 'ANOTHER-SECRET-77';
    const saved = await writeAnnotations(await blankPdf(), [sampleNote({ contents: secret })]);
    const { viewBytes } = await extractAnnotations(saved);
    expect(await allContentsStrings(viewBytes!)).not.toContain(secret);
  });
});

describe('annotations made by other tools', () => {
  it('reads them with the right colours, geometry and metadata', async () => {
    const annotations = commented((await extractAnnotations(await acrobatStylePdf())).annotations);
    const byContent = (c: string) => annotations.find((a) => a.contents === c);

    const h1 = byContent('acrobat comment') as HighlightAnnotation;
    expect(h1.kind).toBe('highlight');
    expect(h1.color).toBe('#FFFF00');
    expect(h1.rects).toEqual([[100, 600, 300, 620]]);
    expect(h1.author).toBe('Someone');
    // +01:00 offset: 03:04:05 local is 02:04:05 UTC.
    expect(h1.modified).toBe('2024-01-02T02:04:05.000Z');

    const grey = annotations.find((a) => a.kind === 'highlight' && a.color === '#808080') as HighlightAnnotation;
    expect(grey.rects).toEqual([[100, 500, 200, 520]]);

    const cmyk = annotations.find((a) => a.kind === 'highlight' && a.color === '#FFFF00' && a !== h1);
    expect(cmyk).toBeDefined();

    const note = byContent('standalone note') as NoteAnnotation;
    expect(note.kind).toBe('note');
    expect(note.point).toEqual([400, 620]); // top-left of the rect
  });

  it('leaves replies, underlines, links and unreadable highlights alone', async () => {
    const { annotations: all, viewBytes } = await extractAnnotations(await acrobatStylePdf());
    const annotations = commented(all);
    const taken = annotations.map((a) => a.contents);
    expect(taken).not.toContain('a reply');
    expect(taken).not.toContain('unreadable');
    expect(taken).not.toContain('parent note'); // has a reply: part of a thread

    // The display copy keeps all of those, plus the unreadable highlight...
    expect((await pdfLibSubtypes(viewBytes!)).sort()).toEqual(['Highlight', 'Link', 'Text', 'Text', 'Underline']);
    const contents = await allContentsStrings(viewBytes!);
    expect(contents).toContain('a reply');
    expect(contents).toContain('parent note');
    expect(contents).toContain('unreadable');
    // ...and none of the ones we took over.
    expect(contents).not.toContain('acrobat comment');
    expect(contents).not.toContain('standalone note');
  });

  it('keeps unmanaged annotations through a full save', async () => {
    const original = await acrobatStylePdf();
    const { annotations } = await extractAnnotations(original);
    const saved = await writeAnnotations(original, annotations);

    const kinds = (await pdfLibSubtypes(saved)).filter((s) => s !== 'Popup');
    // 4 highlights (3 readable + 1 unreadable), 3 text (standalone + parent + reply), 1 underline, 1 link.
    expect(kinds.filter((k) => k === 'Highlight')).toHaveLength(4);
    expect(kinds.filter((k) => k === 'Text')).toHaveLength(3);
    expect(kinds).toContain('Underline');
    expect(kinds).toContain('Link');
    expect(await allContentsStrings(saved)).toContain('unreadable');
    expect(await allContentsStrings(saved)).toContain('a reply');
  });

  it('never breaks a comment thread: replies still point at a live parent after saving', async () => {
    const original = await acrobatStylePdf();
    const { annotations } = await extractAnnotations(original);
    // Even deleting everything we own must leave the thread intact.
    for (const set of [annotations, [] as Annotation[]]) {
      const saved = await writeAnnotations(original, set);
      const doc = await PDFDocument.load(saved, { updateMetadata: false });
      const annots = doc.getPages()[0].node.Annots()!;
      let checked = 0;
      for (let i = 0; i < annots.size(); i++) {
        const d = doc.context.lookupMaybe(annots.get(i), PDFDict);
        const irt = d?.get(PDFName.of('IRT'));
        if (!d || !irt) continue;
        const parent = doc.context.lookupMaybe(irt, PDFDict);
        expect(parent).toBeDefined();
        const c = parent!.get(PDFName.of('Contents'));
        expect(c instanceof PDFHexString && c.decodeText()).toBe('parent note');
        checked++;
      }
      expect(checked).toBe(1);
    }
  });

  it('can edit and delete them like our own', async () => {
    const original = await acrobatStylePdf();
    const { annotations } = await extractAnnotations(original);
    const [first, ...rest] = annotations;
    const edited = [{ ...first, contents: 'edited!' }, ...rest.slice(1)] as Annotation[]; // drop one
    const saved = await writeAnnotations(original, edited);
    const back = (await extractAnnotations(saved)).annotations;
    expect(back).toHaveLength(annotations.length - 1);
    expect(commented(back).map((a) => a.contents)).toContain('edited!');
    expect(await allContentsStrings(saved)).not.toContain('acrobat comment');
  });
});

describe('unsupported documents', () => {
  it('rejects encrypted PDFs as read-only', async () => {
    await expect(extractAnnotations(fixture('encrypted.pdf'))).rejects.toMatchObject({
      name: 'UnsupportedPdfError',
      reason: 'encrypted',
    });
    await expect(writeAnnotations(fixture('encrypted.pdf'), [])).rejects.toBeInstanceOf(UnsupportedPdfError);
  });

  it('rejects garbage as an invalid document', async () => {
    await expect(extractAnnotations(new TextEncoder().encode('this is not a pdf'))).rejects.toMatchObject({
      reason: 'invalid',
    });
  });
});

// A page /Annots entry that is an array of mixed direct and indirect objects must not break us.
describe('odd structures', () => {
  it('handles direct (non-reference) annotation dictionaries', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([612, 792]);
    const direct = doc.context.obj({ Type: 'Annot', Subtype: 'Highlight', Rect: [10, 10, 100, 30], C: [1, 0, 0] });
    page.node.set(PDFName.of('Annots'), PDFArray.withContext(doc.context));
    (page.node.Annots() as PDFArray).push(direct);
    const { annotations } = await extractAnnotations(await doc.save());
    expect(annotations).toHaveLength(1);
    expect((annotations[0] as HighlightAnnotation).color).toBe('#FF0000');
  });
});

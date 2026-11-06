import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFString,
  decodePDFRawStream,
} from 'pdf-lib';
import {
  createHighlight,
  createNote,
  createTextBox,
  type Annotation,
  type TextBoxAnnotation,
} from '../src/annotations/model';
import { extractAnnotations, parseDefaultAppearance, writeAnnotations } from '../src/pdf/annotIO';
import {
  BASELINE_EM,
  LINE_HEIGHT,
  TEXT_PADDING,
  displayedSize,
  layoutLines,
} from '../src/text/textLayout';

const fixture = (name: string) => new Uint8Array(readFileSync(join(__dirname, 'fixtures', name)));
const N = (name: string) => PDFName.of(name);

const box = (over: Partial<TextBoxAnnotation> = {}, pageIndex = 0): TextBoxAnnotation => ({
  ...createTextBox({
    pageIndex,
    rect: [100, 600, 300, 640],
    contents: 'Hello world',
    author: 'Tester',
  }),
  ...over,
});

async function blankPdf(pages = 2): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([612, 792]);
  return doc.save();
}

/** The FreeText annotations of a page, as pdf-lib dictionaries. */
async function freeTexts(bytes: Uint8Array, pageIndex = 0) {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const annots = doc.getPages()[pageIndex].node.Annots();
  const out: PDFDict[] = [];
  for (let i = 0; i < (annots?.size() ?? 0); i++) {
    const d = doc.context.lookupMaybe(annots!.get(i), PDFDict);
    if (d?.get(N('Subtype')) === N('FreeText')) out.push(d);
  }
  return { doc, dicts: out };
}

/** The decoded appearance stream of an annotation. */
function appearanceOf(doc: PDFDocument, dict: PDFDict): { content: string; stream: PDFRawStream } {
  const ap = doc.context.lookup(dict.get(N('AP')), PDFDict);
  const stream = doc.context.lookup(ap.get(N('N'))) as PDFRawStream;
  return { content: new TextDecoder('latin1').decode(decodePDFRawStream(stream).decode()), stream };
}

async function pdfJsAnnotations(bytes: Uint8Array, pageNumber = 1) {
  const task = getDocument({ data: bytes.slice(), useSystemFonts: true });
  const doc = await task.promise;
  try {
    return (await (await doc.getPage(pageNumber)).getAnnotations()) as unknown as {
      subtype: string;
      annotationFlags: number;
      hasAppearance: boolean;
      rect: number[];
    }[];
  } finally {
    await task.destroy();
  }
}

describe('text boxes: saving and reading back', () => {
  it('round-trips every property', async () => {
    const original = box({
      contents: 'First line\nSecond line, which is a little longer',
      fontFamily: 'Times',
      fontSize: 18,
      color: '#1565C0',
      align: 'center',
      fill: '#FFF59D',
      border: true,
    });
    const bytes = await writeAnnotations(fixture('sample.pdf'), [original]);
    const { annotations } = await extractAnnotations(bytes);

    expect(annotations).toHaveLength(1);
    const back = annotations[0] as TextBoxAnnotation;
    expect(back.kind).toBe('textbox');
    expect(back.id).toBe(original.id);
    expect(back.pageIndex).toBe(0);
    expect(back.rect).toEqual(original.rect);
    expect(back.contents).toBe(original.contents);
    expect(back.fontFamily).toBe('Times');
    expect(back.fontSize).toBe(18);
    expect(back.color.toLowerCase()).toBe('#1565c0');
    expect(back.align).toBe('center');
    expect(back.fill?.toLowerCase()).toBe('#fff59d');
    expect(back.border).toBe(true);
    expect(back.author).toBe('Tester');
  });

  it('round-trips the plain defaults too (no fill, no border, left aligned)', async () => {
    const original = box();
    const bytes = await writeAnnotations(fixture('sample.pdf'), [original]);
    const back = (await extractAnnotations(bytes)).annotations[0] as TextBoxAnnotation;
    expect(back).toMatchObject({
      fontFamily: 'Helvetica',
      fontSize: 12,
      align: 'left',
      fill: null,
      border: false,
    });
    expect(back.color.toLowerCase()).toBe('#000000');
  });

  it('writes a standard printable FreeText annotation that other readers can draw', async () => {
    const bytes = await writeAnnotations(fixture('sample.pdf'), [box({ fill: '#FFFFFF' })]);
    const found = (await pdfJsAnnotations(bytes)).filter((a) => a.subtype === 'FreeText');
    expect(found).toHaveLength(1);
    expect(found[0].hasAppearance).toBe(true);
    expect(found[0].annotationFlags & 4).toBeTruthy(); // Print
    expect(found[0].rect).toEqual([100, 600, 300, 640]);
  });

  it('writes the entries Acrobat expects of a text box', async () => {
    const { doc, dicts } = await freeTexts(
      await writeAnnotations(fixture('sample.pdf'), [
        box({ fontFamily: 'Courier', fontSize: 10, color: '#D32F2F', align: 'right' }),
      ]),
    );
    const d = dicts[0];
    const da = (d.get(N('DA')) as PDFString | PDFHexString).decodeText();
    expect(da).toMatch(/^\/Cour 10 Tf /);
    expect(da).toMatch(/0\.827 0\.184 0\.184 rg$/);
    expect(doc.context.lookup(d.get(N('Q')), PDFNumber).asNumber()).toBe(2);
    expect(d.get(N('IT'))).toBe(N('FreeTextTypeWriter'));
    expect((d.get(N('Contents')) as PDFHexString).decodeText()).toBe('Hello world');
  });

  it('draws one line of text per wrapped line, at the baselines the editor uses', async () => {
    const original = box({
      rect: [100, 500, 200, 560],
      contents: 'alpha beta gamma delta epsilon zeta eta theta',
      fontSize: 12,
    });
    const lines = layoutLines(original, 100);
    expect(lines.length).toBeGreaterThan(2);

    const { doc, dicts } = await freeTexts(
      await writeAnnotations(fixture('sample.pdf'), [original]),
    );
    const { content, stream } = appearanceOf(doc, dicts[0]);

    // One Tj per line, in order.
    const tj = [...content.matchAll(/<([0-9a-f]*)> Tj/gi)].map((m) =>
      Buffer.from(m[1], 'hex').toString('latin1'),
    );
    expect(tj).toEqual(lines);

    // Baselines step down by one line height, starting just below the top padding.
    const ys = [...content.matchAll(/1 0 0 1 ([\d.]+) ([\d.]+) Tm/g)].map((m) => Number(m[2]));
    const height = 60;
    ys.forEach((y, i) => {
      const expected = height - (TEXT_PADDING + i * LINE_HEIGHT * 12 + BASELINE_EM.Helvetica * 12);
      expect(y).toBeCloseTo(expected, 2);
    });

    // The appearance box is the displayed box, so nothing is scaled when the reader draws it.
    expect(
      stream.dict
        .lookup(N('BBox'), PDFArray)
        .asArray()
        .map((v) => (v as PDFNumber).asNumber()),
    ).toEqual([0, 0, 100, 60]);
  });

  it('draws the background and outline only when asked', async () => {
    const plain = appearanceOf(
      ...(await (async () => {
        const { doc, dicts } = await freeTexts(
          await writeAnnotations(fixture('sample.pdf'), [box()]),
        );
        return [doc, dicts[0]] as const;
      })()),
    ).content;
    expect(plain).not.toMatch(/ re f/);
    expect(plain).not.toMatch(/ re S/);

    const { doc, dicts } = await freeTexts(
      await writeAnnotations(fixture('sample.pdf'), [box({ fill: '#FFF59D', border: true })]),
    );
    const styled = appearanceOf(doc, dicts[0]).content;
    expect(styled).toMatch(/0 0 200 40 re f/);
    expect(styled).toMatch(/ re S/);
  });

  it('keeps explicit line breaks in /Contents', async () => {
    const bytes = await writeAnnotations(fixture('sample.pdf'), [
      box({ contents: 'one\ntwo\n\nfour' }),
    ]);
    const back = (await extractAnnotations(bytes)).annotations[0] as TextBoxAnnotation;
    expect(back.contents).toBe('one\ntwo\n\nfour');
  });

  it('replaces characters the standard fonts cannot show with "?" (and does not fail)', async () => {
    const bytes = await writeAnnotations(fixture('sample.pdf'), [
      box({ contents: 'price: 5€ 日本 ok' }),
    ]);
    const back = (await extractAnnotations(bytes)).annotations[0] as TextBoxAnnotation;
    expect(back.contents).toBe('price: 5€ ?? ok');
  });

  it('saves an empty box without errors', async () => {
    const bytes = await writeAnnotations(fixture('sample.pdf'), [box({ contents: '' })]);
    const back = (await extractAnnotations(bytes)).annotations[0] as TextBoxAnnotation;
    expect(back.contents).toBe('');
  });

  it('uses one font object per family however many boxes there are', async () => {
    const boxes = [box(), box(), box({ fontFamily: 'Times' }), box({ fontFamily: 'Times' }, 1)];
    const bytes = await writeAnnotations(await blankPdf(2), boxes);
    const doc = await PDFDocument.load(bytes, { updateMetadata: false });
    const baseFonts: string[] = [];
    for (const [, obj] of doc.context.enumerateIndirectObjects()) {
      if (
        obj instanceof PDFDict &&
        obj.get(N('Type')) === N('Font') &&
        obj.get(N('Subtype')) === N('Type1')
      ) {
        const base = obj.get(N('BaseFont'));
        if (base instanceof PDFName) baseFonts.push(base.decodeText());
      }
    }
    expect(baseFonts.filter((f) => f === 'Helvetica')).toHaveLength(1);
    expect(baseFonts.filter((f) => f === 'Times-Roman')).toHaveLength(1);
  });

  it('keeps boxes on the right pages', async () => {
    const bytes = await writeAnnotations(fixture('sample.pdf'), [
      box({ contents: 'A' }, 0),
      box({ contents: 'B' }, 2),
    ]);
    const back = (await extractAnnotations(bytes)).annotations as TextBoxAnnotation[];
    expect(back.map((a) => [a.pageIndex, a.contents])).toEqual([
      [0, 'A'],
      [2, 'B'],
    ]);
  });
});

describe('text boxes: repeated saves and deletion', () => {
  it('saving again does not duplicate boxes, and edits are applied', async () => {
    const original = box({ contents: 'v1' });
    const first = await writeAnnotations(fixture('sample.pdf'), [original]);
    const loaded = (await extractAnnotations(first)).annotations as TextBoxAnnotation[];
    const edited = { ...loaded[0], contents: 'v2' };
    const second = await writeAnnotations(first, [edited]);

    const { dicts } = await freeTexts(second);
    expect(dicts).toHaveLength(1);
    const back = (await extractAnnotations(second)).annotations as TextBoxAnnotation[];
    expect(back).toHaveLength(1);
    expect(back[0].contents).toBe('v2');
    expect(back[0].id).toBe(original.id);
  });

  it('removing every box leaves no FreeText annotation, appearance or text behind', async () => {
    const withBox = await writeAnnotations(fixture('sample.pdf'), [
      box({ contents: 'secret words' }),
    ]);
    const without = await writeAnnotations(withBox, []);

    const { dicts } = await freeTexts(without);
    expect(dicts).toHaveLength(0);
    const doc = await PDFDocument.load(without, { updateMetadata: false });
    for (const [, obj] of doc.context.enumerateIndirectObjects()) {
      if (obj instanceof PDFDict) expect(obj.get(N('Subtype'))).not.toBe(N('FreeText'));
      if (obj instanceof PDFRawStream) {
        const text = new TextDecoder('latin1').decode(decodePDFRawStream(obj).decode());
        expect(text).not.toContain(Buffer.from('secret').toString('hex'));
      }
    }
    expect(Buffer.from(without).toString('latin1')).not.toContain('secret words');
  });

  it('takes nothing from the document that was not a text box', async () => {
    const mixed: Annotation[] = [
      createHighlight({ pageIndex: 0, rects: [[72, 700, 200, 716]], color: '#FFE74C', text: 'x' }),
      createNote({ pageIndex: 0, point: [320, 700], color: '#FFE74C' }),
      box(),
    ];
    const bytes = await writeAnnotations(fixture('sample.pdf'), mixed);
    const back = (await extractAnnotations(bytes)).annotations;
    expect(back.map((a) => a.kind).sort()).toEqual(['highlight', 'note', 'textbox']);
  });
});

describe('text boxes on rotated pages (rotated.pdf)', () => {
  it('writes an upright appearance and reads the box back unchanged on every page', async () => {
    const source = fixture('rotated.pdf');
    const doc = await PDFDocument.load(source);
    const rotations = doc.getPages().map((p) => p.getRotation().angle);
    expect(new Set(rotations).size).toBeGreaterThan(1);

    const boxes = rotations.map((_, i) =>
      box({ contents: `page ${i + 1} text`, rect: [100, 500, 260, 560] }, i),
    );
    const bytes = await writeAnnotations(source, boxes);

    const back = (await extractAnnotations(bytes)).annotations as TextBoxAnnotation[];
    expect(back.map((a) => [a.pageIndex, a.contents])).toEqual(
      boxes.map((b, i) => [i, b.contents]),
    );
    back.forEach((a, i) => expect(a.rect).toEqual(boxes[i].rect));

    for (let i = 0; i < rotations.length; i++) {
      const { doc: d, dicts } = await freeTexts(bytes, i);
      expect(dicts).toHaveLength(1);
      const { stream } = appearanceOf(d, dicts[0]);
      const size = displayedSize(boxes[i].rect, rotations[i]);
      const bbox = stream.dict
        .lookup(N('BBox'), PDFArray)
        .asArray()
        .map((v) => (v as PDFNumber).asNumber());
      expect(bbox).toEqual([0, 0, size.width, size.height]);

      const matrix = stream.dict.lookupMaybe(N('Matrix'), PDFArray);
      const angle = ((rotations[i] % 360) + 360) % 360;
      if (angle === 0) expect(matrix).toBeUndefined();
      else {
        const m = matrix!.asArray().map((v) => (v as PDFNumber).asNumber());
        // Turns the opposite way to the page: 90 -> [0 1 -1 0], 180 -> [-1 0 0 -1], 270 -> [0 -1 1 0].
        const expected =
          angle === 90
            ? [0, 1, -1, 0, 0, 0]
            : angle === 180
              ? [-1, 0, 0, -1, 0, 0]
              : [0, -1, 1, 0, 0, 0];
        expect(m).toEqual(expected);
      }
    }
  });
});

describe('FreeText annotations from other tools', () => {
  const str = (s: string) => PDFHexString.fromText(s);

  async function withForeign(literals: Record<string, unknown>[], rotatePage?: number) {
    const doc = await PDFDocument.create();
    const page = doc.addPage([612, 792]);
    if (rotatePage) page.setRotation({ type: 'degrees' as never, angle: rotatePage });
    const ctx = doc.context;
    const refs = literals.map((l) =>
      ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'FreeText', ...l } as never)),
    );
    page.node.set(N('Annots'), ctx.obj(refs));
    return doc.save();
  }

  const base = {
    Rect: [50, 50, 250, 90],
    Contents: str('foreign'),
    DA: PDFString.of('0 g /Helv 12 Tf'),
  };

  it('takes over a plain text box from another editor', async () => {
    const bytes = await withForeign([
      { ...base, Q: 1, C: [1, 1, 0], IC: [1, 1, 0.5], BS: { W: 2 } },
    ]);
    const { annotations, viewBytes } = await extractAnnotations(bytes);
    expect(annotations).toHaveLength(1);
    const a = annotations[0] as TextBoxAnnotation;
    expect(a).toMatchObject({
      kind: 'textbox',
      contents: 'foreign',
      fontFamily: 'Helvetica',
      fontSize: 12,
      align: 'center',
      border: true,
    });
    expect(a.fill?.toLowerCase()).toBe('#ffff80');
    expect(viewBytes).not.toBeNull(); // it is drawn by the overlay, so it is removed from the view copy
  });

  it('leaves callouts, rich text, replies, other fonts and rotated boxes exactly as they are', async () => {
    const bytes = await withForeign([
      { ...base, CL: [10, 10, 50, 50] },
      { ...base, RC: PDFString.of('<body><p>rich</p></body>') },
      { ...base, DA: PDFString.of('0 g /Helv-Bold 12 Tf') },
      { ...base, DA: PDFString.of('0 g /F1 12 Tf') },
      { ...base, DA: PDFString.of('0 g /Helv 0 Tf') }, // automatic size
      { ...base, DA: PDFString.of('0 0 0 1 k /Helv 12 Tf') }, // CMYK
      { ...base, Rotate: 90 },
      { Rect: [50, 50, 250, 90], Contents: str('no DA') },
    ]);
    const { annotations, viewBytes } = await extractAnnotations(bytes);
    expect(annotations).toHaveLength(0);
    expect(viewBytes).toBeNull();

    // And a save keeps every one of them.
    const saved = await writeAnnotations(bytes, [box()]);
    expect((await freeTexts(saved)).dicts).toHaveLength(8 + 1);
  });

  it('does not take over a reply, even a plain one', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([612, 792]);
    const ctx = doc.context;
    const parent = ctx.register(
      ctx.obj({
        Type: 'Annot',
        Subtype: 'Text',
        Rect: [10, 10, 30, 30],
        Contents: str('p'),
      } as never),
    );
    const reply = ctx.register(
      ctx.obj({ Type: 'Annot', Subtype: 'FreeText', ...base, IRT: parent, RT: 'R' } as never),
    );
    page.node.set(N('Annots'), ctx.obj([parent, reply]));
    const { annotations } = await extractAnnotations(await doc.save());
    expect(annotations.filter((a) => a.kind === 'textbox')).toHaveLength(0);
  });

  it('does not take over a box on a rotated page (it may be sideways there)', async () => {
    const bytes = await withForeign([base], 90);
    expect((await extractAnnotations(bytes)).annotations).toHaveLength(0);
  });

  it('still takes over its own boxes on a rotated page', async () => {
    const bytes = await writeAnnotations(await withForeign([], 90), [
      box({ rect: [100, 100, 260, 140] }),
    ]);
    const back = (await extractAnnotations(bytes)).annotations;
    expect(back).toHaveLength(1);
    expect(back[0].kind).toBe('textbox');
  });
});

describe('parseDefaultAppearance', () => {
  it('reads font, size and colour in either order', () => {
    expect(parseDefaultAppearance('/Helv 12 Tf 0 0 0 rg')).toMatchObject({
      fontFamily: 'Helvetica',
      fontSize: 12,
    });
    expect(parseDefaultAppearance('1 0 0 rg /TiRo 18.5 Tf')).toMatchObject({
      fontFamily: 'Times',
      fontSize: 18.5,
    });
    expect(parseDefaultAppearance('1 0 0 rg /TiRo 18.5 Tf')?.color.toLowerCase()).toBe('#ff0000');
    expect(parseDefaultAppearance('0.5 g /Cour 9 Tf')?.color.toLowerCase()).toBe('#808080');
  });

  it('defaults to black when no colour is given', () => {
    expect(parseDefaultAppearance('/Helv 12 Tf')?.color).toBe('#000000');
  });

  it('accepts the full font names too', () => {
    expect(parseDefaultAppearance('/Helvetica 12 Tf')?.fontFamily).toBe('Helvetica');
    expect(parseDefaultAppearance('/Times-Roman 12 Tf')?.fontFamily).toBe('Times');
    expect(parseDefaultAppearance('/Courier 12 Tf')?.fontFamily).toBe('Courier');
  });

  it('rejects what cannot be reproduced', () => {
    for (const da of [
      '',
      'garbage',
      '/Helv-Bold 12 Tf',
      '/Arial 12 Tf',
      '/Helv 0 Tf',
      '/Helv 5 Tf', // below the smallest size we offer
      '/Helv 200 Tf',
      '0 0 0 1 k /Helv 12 Tf',
    ]) {
      expect(parseDefaultAppearance(da), da).toBeNull();
    }
  });
});

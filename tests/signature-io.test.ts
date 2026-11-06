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
  createSignature,
  createTextBox,
  type Annotation,
  type SignatureAnnotation,
  type SignatureArtwork,
} from '../src/annotations/model';
import { extractAnnotations, hasDigitalSignature, writeAnnotations } from '../src/pdf/annotIO';
import { displayedSize } from '../src/text/textLayout';
import { looksLikePng } from '../src/signature/pngData';
import { makePng, toDataUrl } from './helpers/png';

const fixture = (name: string) => new Uint8Array(readFileSync(join(__dirname, 'fixtures', name)));
const N = (name: string) => PDFName.of(name);

const strokesArt = (
  over: Partial<Extract<SignatureArtwork, { type: 'strokes' }>> = {},
): SignatureArtwork => ({
  type: 'strokes',
  strokes: [
    [
      [3, 20],
      [15, 5],
      [30, 25],
      [45, 8],
      [60, 22],
    ],
    [
      [10, 30],
      [55, 30],
    ],
    [[40, 12]],
  ],
  color: '#1565C0',
  width: 3,
  box: [66, 36],
  ...over,
});

// A 4x2 picture: left half opaque dark, right half see-through, so a soft mask is needed.
const png = makePng(4, 2, (x) => (x < 2 ? [20, 20, 120, 255] : [0, 0, 0, 0]));
const imageArt = (): SignatureArtwork => ({
  type: 'image',
  pngDataUrl: toDataUrl(png),
  size: [4, 2],
});

const sig = (
  artwork: SignatureArtwork,
  over: Partial<SignatureAnnotation> = {},
  pageIndex = 0,
): SignatureAnnotation => ({
  ...createSignature({
    pageIndex,
    rect: [100, 500, 250, 550],
    variant: 'signature',
    artwork,
    author: 'Tester',
  }),
  ...over,
});

async function stamps(bytes: Uint8Array, pageIndex = 0) {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const annots = doc.getPages()[pageIndex].node.Annots();
  const out: PDFDict[] = [];
  for (let i = 0; i < (annots?.size() ?? 0); i++) {
    const d = doc.context.lookupMaybe(annots!.get(i), PDFDict);
    if (d?.get(N('Subtype')) === N('Stamp')) out.push(d);
  }
  return { doc, dicts: out };
}

function appearanceOf(doc: PDFDocument, dict: PDFDict) {
  const ap = doc.context.lookup(dict.get(N('AP')), PDFDict);
  const stream = doc.context.lookup(ap.get(N('N'))) as PDFRawStream;
  return { content: new TextDecoder('latin1').decode(decodePDFRawStream(stream).decode()), stream };
}

async function pdfJsAnnotations(bytes: Uint8Array) {
  const task = getDocument({ data: bytes.slice(), useSystemFonts: true });
  const doc = await task.promise;
  try {
    return (await (await doc.getPage(1)).getAnnotations()) as unknown as {
      subtype: string;
      annotationFlags: number;
      hasAppearance: boolean;
      rect: number[];
    }[];
  } finally {
    await task.destroy();
  }
}

describe('drawn signatures: saving and reading back', () => {
  it('round-trips the strokes, colour, width, size, variant, position and author', async () => {
    const original = sig(strokesArt(), { variant: 'initials' });
    const bytes = await writeAnnotations(fixture('sample.pdf'), [original]);
    const { annotations } = await extractAnnotations(bytes);

    expect(annotations).toHaveLength(1);
    const back = annotations[0] as SignatureAnnotation;
    expect(back.kind).toBe('signature');
    expect(back.id).toBe(original.id);
    expect(back.variant).toBe('initials');
    expect(back.rect).toEqual(original.rect);
    expect(back.pageIndex).toBe(0);
    expect(back.author).toBe('Tester');
    expect(back.artwork).toEqual(original.artwork);
  });

  it('writes a printable stamp with an appearance that other readers draw', async () => {
    const bytes = await writeAnnotations(fixture('sample.pdf'), [sig(strokesArt())]);
    const found = (await pdfJsAnnotations(bytes)).filter((a) => a.subtype === 'Stamp');
    expect(found).toHaveLength(1);
    expect(found[0].hasAppearance).toBe(true);
    expect(found[0].annotationFlags & 4).toBeTruthy(); // Print
    expect(found[0].rect).toEqual([100, 500, 250, 550]);
  });

  it('draws the strokes as vector paths, scaled to the box, with the pen width scaled too', async () => {
    const { doc, dicts } = await stamps(
      await writeAnnotations(fixture('sample.pdf'), [sig(strokesArt())]),
    );
    const { content, stream } = appearanceOf(doc, dicts[0]);

    // 150x50 box from a 66x36 drawing: x scale 150/66, y scale 50/36 (flipped).
    const cm = /([\d.]+) 0 0 (-[\d.]+) 0 ([\d.]+) cm/.exec(content)!;
    expect(Number(cm[1])).toBeCloseTo(150 / 66, 3);
    expect(Number(cm[2])).toBeCloseTo(-50 / 36, 3);
    expect(Number(cm[3])).toBe(50);
    expect(content).toMatch(/0\.082 0\.396 0\.753 RG/); // #1565C0
    expect(content).toMatch(/\n3 w\n/);
    expect(content).toMatch(/\n1 J\n1 j\n/); // round caps and joins
    expect(content.match(/\nS(?=\n)/g)).toHaveLength(3); // one painted path per stroke
    expect(
      stream.dict
        .lookup(N('BBox'), PDFArray)
        .asArray()
        .map((v) => (v as PDFNumber).asNumber()),
    ).toEqual([0, 0, 150, 50]);
  });

  it('keeps the proportions when the box is a different shape from the drawing', async () => {
    // The box comes from the drawing's own aspect ratio in the app; here it is deliberately different.
    const { doc, dicts } = await stamps(
      await writeAnnotations(fixture('sample.pdf'), [
        sig(strokesArt(), { rect: [100, 500, 200, 600] }),
      ]),
    );
    const { content } = appearanceOf(doc, dicts[0]);
    const cm = /([\d.]+) 0 0 (-[\d.]+) 0 ([\d.]+) cm/.exec(content)!;
    expect(Number(cm[1])).toBeCloseTo(100 / 66, 3);
    expect(Number(cm[2])).toBeCloseTo(-100 / 36, 3);
  });

  it('saving again keeps exactly one stamp, and a change is applied', async () => {
    const first = await writeAnnotations(fixture('sample.pdf'), [sig(strokesArt())]);
    const loaded = (await extractAnnotations(first)).annotations as SignatureAnnotation[];
    const moved = { ...loaded[0], rect: [120, 400, 270, 450] as SignatureAnnotation['rect'] };
    const second = await writeAnnotations(first, [moved]);

    expect((await stamps(second)).dicts).toHaveLength(1);
    const back = (await extractAnnotations(second)).annotations as SignatureAnnotation[];
    expect(back).toHaveLength(1);
    expect(back[0].rect).toEqual([120, 400, 270, 450]);
    expect(back[0].id).toBe(loaded[0].id);
    expect(back[0].artwork).toEqual(loaded[0].artwork);
  });

  it('removing it leaves no stamp, appearance or stroke data behind', async () => {
    const withIt = await writeAnnotations(fixture('sample.pdf'), [sig(strokesArt(), {}, 0)]);
    const without = await writeAnnotations(withIt, []);
    expect((await stamps(without)).dicts).toHaveLength(0);
    const doc = await PDFDocument.load(without, { updateMetadata: false });
    for (const [, obj] of doc.context.enumerateIndirectObjects()) {
      if (obj instanceof PDFDict) {
        expect(obj.get(N('Subtype'))).not.toBe(N('Stamp'));
        expect(obj.has(N('PDFReaderSig'))).toBe(false);
      }
    }
    expect(Buffer.from(without).toString('latin1')).not.toContain('PDFReaderSig');
  });
});

describe('picture signatures (typed names, imported images)', () => {
  it('round-trips the picture exactly', async () => {
    const original = sig(imageArt());
    const bytes = await writeAnnotations(fixture('sample.pdf'), [original]);
    const back = (await extractAnnotations(bytes)).annotations[0] as SignatureAnnotation;
    expect(back.artwork.type).toBe('image');
    if (back.artwork.type === 'image') {
      expect(back.artwork.pngDataUrl).toBe(toDataUrl(png));
      expect(back.artwork.size).toEqual([4, 2]);
    }
  });

  it('embeds the picture with a soft mask so transparent parts stay transparent', async () => {
    const { doc, dicts } = await stamps(
      await writeAnnotations(fixture('sample.pdf'), [sig(imageArt())]),
    );
    const { content, stream } = appearanceOf(doc, dicts[0]);
    expect(content).toMatch(/150 0 0 50 0 0 cm\n\/Sig Do/);
    const resources = stream.dict.lookup(N('Resources'), PDFDict);
    const xobjects = resources.lookup(N('XObject'), PDFDict);
    const image = doc.context.lookup(xobjects.get(N('Sig'))) as PDFRawStream;
    expect(image.dict.get(N('Subtype'))).toBe(N('Image'));
    expect(image.dict.has(N('SMask'))).toBe(true);
  });

  it('is drawn by PDF.js', async () => {
    const bytes = await writeAnnotations(fixture('sample.pdf'), [sig(imageArt())]);
    const found = (await pdfJsAnnotations(bytes)).find((a) => a.subtype === 'Stamp');
    expect(found?.hasAppearance).toBe(true);
  });

  it('embeds a picture that is used twice only once', async () => {
    const bytes = await writeAnnotations(fixture('sample.pdf'), [
      sig(imageArt()),
      sig(imageArt(), { rect: [300, 400, 450, 450] }, 1),
    ]);
    const doc = await PDFDocument.load(bytes, { updateMetadata: false });
    let images = 0;
    for (const [, obj] of doc.context.enumerateIndirectObjects()) {
      if (
        obj instanceof PDFRawStream &&
        obj.dict.get(N('Subtype')) === N('Image') &&
        obj.dict.get(N('Width')) instanceof PDFNumber
      ) {
        if ((obj.dict.get(N('SMask')) ?? null) !== null) images++;
      }
    }
    expect(images).toBe(1);
  });

  it('removing it leaves no picture data behind', async () => {
    const withIt = await writeAnnotations(fixture('sample.pdf'), [sig(imageArt())]);
    const without = await writeAnnotations(withIt, []);
    const doc = await PDFDocument.load(without, { updateMetadata: false });
    for (const [, obj] of doc.context.enumerateIndirectObjects()) {
      if (obj instanceof PDFRawStream) {
        // Neither the stored copy of the PNG nor an embedded 4x2 image remains.
        expect(looksLikePng(obj.getContents())).toBe(false);
        const w = obj.dict.get(N('Width'));
        expect(
          w instanceof PDFNumber &&
            w.asNumber() === 4 &&
            obj.dict.get(N('Height')) instanceof PDFNumber &&
            (obj.dict.get(N('Height')) as PDFNumber).asNumber() === 2,
        ).toBe(false);
      }
    }
  });

  it('writes nothing for artwork that is not a PNG', async () => {
    const bad = sig({ type: 'image', pngDataUrl: 'data:image/png;base64,AAAA', size: [4, 2] });
    const bytes = await writeAnnotations(fixture('sample.pdf'), [bad]);
    expect((await stamps(bytes)).dicts).toHaveLength(0);
  });
});

describe('signatures on rotated pages', () => {
  it('writes an upright appearance and reads the signature back unchanged on every page', async () => {
    const source = fixture('rotated.pdf');
    const doc = await PDFDocument.load(source);
    const rotations = doc.getPages().map((p) => p.getRotation().angle);
    expect(new Set(rotations).size).toBeGreaterThan(1);

    const items = rotations.map((_, i) => sig(strokesArt(), { rect: [100, 500, 250, 550] }, i));
    const bytes = await writeAnnotations(source, items);
    const back = (await extractAnnotations(bytes)).annotations as SignatureAnnotation[];
    expect(back.map((a) => a.pageIndex)).toEqual(items.map((_, i) => i));
    back.forEach((a, i) => expect(a.rect).toEqual(items[i].rect));

    for (let i = 0; i < rotations.length; i++) {
      const { doc: d, dicts } = await stamps(bytes, i);
      const { stream } = appearanceOf(d, dicts[0]);
      const size = displayedSize(items[i].rect, rotations[i]);
      const bbox = stream.dict
        .lookup(N('BBox'), PDFArray)
        .asArray()
        .map((v) => (v as PDFNumber).asNumber());
      expect(bbox).toEqual([0, 0, size.width, size.height]);
      const angle = ((rotations[i] % 360) + 360) % 360;
      const matrix = stream.dict.lookupMaybe(N('Matrix'), PDFArray);
      if (angle === 0) expect(matrix).toBeUndefined();
      else expect(matrix).toBeDefined();
    }
  });
});

describe('stamps that are not ours', () => {
  async function withStamps(literals: Record<string, unknown>[]) {
    const doc = await PDFDocument.create();
    const page = doc.addPage([612, 792]);
    const ctx = doc.context;
    const refs = literals.map((l) =>
      ctx.register(
        ctx.obj({ Type: 'Annot', Subtype: 'Stamp', Rect: [50, 50, 200, 100], ...l } as never),
      ),
    );
    page.node.set(N('Annots'), ctx.obj(refs));
    return { bytes: await doc.save(), count: literals.length };
  }

  const info = (over: Record<string, unknown>) => ({
    PDFReaderSig: {
      Variant: 'signature',
      Kind: 'strokes',
      Data: PDFString.of(JSON.stringify({ s: [[1, 2, 3, 4]], c: '#000000', w: 3, b: [10, 10] })),
      ...over,
    },
  });

  it('leaves a plain stamp from another tool exactly as it is', async () => {
    const { bytes } = await withStamps([{ Name: 'Approved' }]);
    const { annotations, viewBytes } = await extractAnnotations(bytes);
    expect(annotations).toHaveLength(0);
    expect(viewBytes).toBeNull();
    expect((await stamps(await writeAnnotations(bytes, [sig(strokesArt())]))).dicts).toHaveLength(
      2,
    );
  });

  it('leaves our own stamps alone when their data is damaged or out of range', async () => {
    const good = JSON.stringify({ s: [[1, 2, 3, 4]], c: '#000000', w: 3, b: [10, 10] });
    const png = makePng(2, 2, () => [0, 0, 0, 255]);
    const { bytes, count } = await withStamps([
      info({ Data: PDFString.of('not json') }),
      info({ Data: PDFString.of(good.replace('#000000', 'red')) }), // colour must be #rrggbb
      info({ Data: PDFString.of(good.replace('"w":3', '"w":9999')) }), // pen width out of range
      info({ Data: PDFString.of(good.replace('[1,2,3,4]', '[1,2,3]')) }), // odd number of coordinates
      info({ Data: PDFString.of(good.replace('"b":[10,10]', '"b":[0,10]')) }), // empty box
      info({ Variant: 'banner' }),
      info({ Kind: 'hologram' }),
      info({ Kind: 'image', Data: PDFHexString.of('00') }), // not a stream
      { PDFReaderSig: { Variant: 'signature', Kind: 'strokes' } }, // no data at all
      { PDFReaderSig: 'nope' },
      { ...info({}), Rect: [1, 2, 3] }, // no usable rectangle
    ]);
    void png;
    const { annotations } = await extractAnnotations(bytes);
    expect(annotations).toHaveLength(0);
    // And a save keeps every one of them.
    expect((await stamps(await writeAnnotations(bytes, []))).dicts).toHaveLength(count);
  });

  it('takes nothing from the document that was not a signature, and keeps other kinds apart', async () => {
    const mixed: Annotation[] = [
      createHighlight({ pageIndex: 0, rects: [[72, 700, 200, 716]], color: '#FFE74C', text: 'x' }),
      createNote({ pageIndex: 0, point: [320, 700], color: '#FFE74C' }),
      createTextBox({ pageIndex: 0, rect: [100, 300, 250, 330], contents: 'text' }),
      sig(strokesArt()),
      sig(imageArt(), { rect: [300, 100, 450, 150] }),
    ];
    const bytes = await writeAnnotations(fixture('sample.pdf'), mixed);
    const back = (await extractAnnotations(bytes)).annotations;
    expect(back.map((a) => a.kind).sort()).toEqual([
      'highlight',
      'note',
      'signature',
      'signature',
      'textbox',
    ]);
  });
});

describe('detecting an existing digital signature', () => {
  async function pdfWith(setup: (doc: PDFDocument) => void) {
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]);
    setup(doc);
    return doc.save();
  }

  const addSignatureValue = (doc: PDFDocument) => {
    const ctx = doc.context;
    ctx.register(
      ctx.obj({
        Type: 'Sig',
        Filter: 'Adobe.PPKLite',
        SubFilter: 'adbe.pkcs7.detached',
        ByteRange: [0, 100, 200, 300],
        Contents: PDFHexString.of('3082'),
      }),
    );
  };

  it('is false for an ordinary document and for annotated ones', async () => {
    expect(hasDigitalSignature(await PDFDocument.load(fixture('sample.pdf')))).toBe(false);
    const annotated = await writeAnnotations(fixture('sample.pdf'), [sig(strokesArt())]);
    expect(hasDigitalSignature(await PDFDocument.load(annotated))).toBe(false);
    expect((await extractAnnotations(annotated)).signed).toBe(false);
  });

  it('is true when a signature value with a byte range is present', async () => {
    const bytes = await pdfWith(addSignatureValue);
    expect(hasDigitalSignature(await PDFDocument.load(bytes))).toBe(true);
    expect((await extractAnnotations(bytes)).signed).toBe(true);
  });

  it('is true when the form says signatures exist, even if the value is hard to find', async () => {
    const bytes = await pdfWith((doc) => {
      doc.catalog.set(N('AcroForm'), doc.context.obj({ Fields: [], SigFlags: 3 }));
    });
    expect((await extractAnnotations(bytes)).signed).toBe(true);
  });

  it('is false when SigFlags says no signatures exist yet (an empty signature field)', async () => {
    const bytes = await pdfWith((doc) => {
      doc.catalog.set(N('AcroForm'), doc.context.obj({ Fields: [], SigFlags: 0 }));
    });
    expect((await extractAnnotations(bytes)).signed).toBe(false);
  });

  it('does not mistake a dictionary that merely has a /ByteRange for a signature', async () => {
    const bytes = await pdfWith((doc) => {
      doc.context.register(doc.context.obj({ ByteRange: [0, 1, 2, 3] })); // no /Contents
    });
    expect((await extractAnnotations(bytes)).signed).toBe(false);
  });
});

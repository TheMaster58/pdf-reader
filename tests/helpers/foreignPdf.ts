import { PDFDict, PDFDocument, PDFHexString, PDFName, PDFString } from 'pdf-lib';

/** A document annotated the way other tools do it: different colour spaces, no appearance, etc. */
export async function acrobatStylePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const ctx = doc.context;
  const refs: ReturnType<typeof ctx.register>[] = [];
  const add = (literal: Record<string, unknown>) => {
    const ref = ctx.register(ctx.obj({ Type: 'Annot', ...literal } as never));
    refs.push(ref);
    return ref;
  };
  const str = (s: string) => PDFHexString.fromText(s);

  // 1. Acrobat-order quad points, RGB colour, popup, author.
  const h1 = add({
    Subtype: 'Highlight',
    Rect: [100, 600, 300, 620],
    QuadPoints: [100, 620, 300, 620, 100, 600, 300, 600],
    C: [1, 1, 0],
    Contents: str('acrobat comment'),
    T: str('Someone'),
    M: PDFString.of("D:20240102030405+01'00'"),
  });
  const popup = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Popup', Rect: [320, 560, 520, 620], Parent: h1 }));
  (ctx.lookup(h1) as PDFDict).set(PDFName.of('Popup'), popup);
  refs.push(popup);

  // 2. Grey colour, Rect only (no QuadPoints, no appearance).
  add({ Subtype: 'Highlight', Rect: [100, 500, 200, 520], C: [0.5] });
  // 3. CMYK colour.
  add({ Subtype: 'Highlight', Rect: [100, 450, 200, 470], QuadPoints: [100, 470, 200, 470, 100, 450, 200, 450], C: [0, 0, 1, 0] });
  // 4a. A plain sticky note nobody replied to: ours to take over.
  add({ Subtype: 'Text', Rect: [400, 600, 420, 620], Contents: str('standalone note'), Name: 'Note' });
  // 4b. A sticky note with a reply: that is somebody else's comment thread, so it is left alone.
  const note = add({ Subtype: 'Text', Rect: [400, 700, 420, 720], Contents: str('parent note'), Name: 'Note' });
  add({ Subtype: 'Text', Rect: [400, 700, 420, 720], Contents: str('a reply'), IRT: note, RT: 'R' });
  // 5. Things we must never touch.
  add({ Subtype: 'Underline', Rect: [100, 300, 200, 320], QuadPoints: [100, 320, 200, 320, 100, 300, 200, 300], C: [1, 0, 0] });
  add({ Subtype: 'Link', Rect: [10, 10, 50, 30], Border: [0, 0, 0] });
  // 6. A highlight we cannot read (no geometry at all): must survive untouched.
  add({ Subtype: 'Highlight', Contents: str('unreadable') });

  page.node.set(PDFName.of('Annots'), ctx.obj(refs));
  return doc.save();
}

// Generates the test PDFs in tests/fixtures. Run: node scripts/make-fixtures.mjs
// The encrypted variant is produced separately by scripts/make_encrypted_fixture.py (needs pypdf).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument, PDFName, PDFString, StandardFonts, rgb } from 'pdf-lib';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'tests', 'fixtures');
mkdirSync(outDir, { recursive: true });

const PAGES = 30;
/** Pages that contain the search keyword "needle" exactly once each. */
const NEEDLE_PAGES = [5, 12, 20];

const doc = await PDFDocument.create();
const font = await doc.embedFont(StandardFonts.Helvetica);
const bold = await doc.embedFont(StandardFonts.HelveticaBold);

const pages = [];
for (let i = 1; i <= PAGES; i++) {
  const page = doc.addPage([612, 792]);
  pages.push(page);
  page.drawText(`Page ${i} of ${PAGES}`, { x: 72, y: 720, size: 24, font: bold });
  const lines = [
    'The quick brown fox jumps over the lazy dog.',
    'Pack my box with five dozen liquor jugs.',
    'Sphinx of black quartz, judge my vow.',
  ];
  lines.forEach((text, n) => page.drawText(text, { x: 72, y: 680 - n * 20, size: 12, font }));
  if (NEEDLE_PAGES.includes(i)) {
    page.drawText('Here is the needle in the haystack.', { x: 72, y: 560, size: 12, font });
  }
  page.drawRectangle({ x: 72, y: 100, width: 468, height: 1, color: rgb(0.6, 0.6, 0.6) });
}

function addLink(page, rect, action) {
  const ctx = doc.context;
  const annot = ctx.obj({
    Type: 'Annot',
    Subtype: 'Link',
    Rect: rect,
    Border: [0, 0, 0],
    A: action,
  });
  page.node.addAnnot(ctx.register(annot));
}

// External link on page 1.
pages[0].drawText('Visit example.com', { x: 72, y: 600, size: 14, font, color: rgb(0, 0, 0.8) });
addLink(
  pages[0],
  [72, 596, 190, 616],
  doc.context.obj({ Type: 'Action', S: 'URI', URI: PDFString.of('https://example.com/') }),
);

// Internal link on page 1 that jumps to page 10.
pages[0].drawText('Jump to page 10', { x: 72, y: 560, size: 14, font, color: rgb(0, 0, 0.8) });
addLink(
  pages[0],
  [72, 556, 190, 576],
  doc.context.obj({
    Type: 'Action',
    S: 'GoTo',
    D: [pages[9].ref, PDFName.of('Fit')],
  }),
);

doc.setTitle('PDF Reader test fixture');
writeFileSync(join(outDir, 'sample.pdf'), await doc.save());

// A page with a rotation, to check orientation handling.
const rot = await PDFDocument.create();
const rotFont = await rot.embedFont(StandardFonts.Helvetica);
for (const angle of [0, 90, 180, 270]) {
  const p = rot.addPage([612, 792]);
  p.setRotation({ type: 'degrees', angle });
  p.drawText(`Rotated ${angle} degrees`, { x: 72, y: 700, size: 24, font: rotFont });
}
writeFileSync(join(outDir, 'rotated.pdf'), await rot.save());

// Page 1 rotated 90 degrees: thumbnails must come out landscape.
const land = await PDFDocument.create();
const landFont = await land.embedFont(StandardFonts.Helvetica);
const landPage = land.addPage([612, 792]);
landPage.setRotation({ type: 'degrees', angle: 90 });
landPage.drawText('Landscape first page', { x: 72, y: 700, size: 28, font: landFont });
for (let i = 0; i < 12; i++) landPage.drawText('Line ' + i + ' of body text on a rotated page', { x: 72, y: 640 - i * 18, size: 12, font: landFont });
writeFileSync(join(outDir, 'landscape-first.pdf'), await land.save());

console.log('Wrote tests/fixtures/sample.pdf, rotated.pdf and landscape-first.pdf');

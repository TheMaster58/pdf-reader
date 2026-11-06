import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createHighlight, createNote, type Annotation } from '../src/annotations/model';
import { writeAnnotations } from '../src/pdf/annotIO';
import { acrobatStylePdf } from './helpers/foreignPdf';

/**
 * Writes annotated PDFs to the directory in INTEROP_OUT so they can be opened in other readers
 * (PDFium, pypdf, Edge...). Skipped unless that environment variable is set.
 *   INTEROP_OUT=some/dir npx vitest run tests/interop-export.test.ts
 */
describe.skipIf(!process.env.INTEROP_OUT)('export for interop checks', () => {
  it('writes sample.pdf with a highlight, a commented highlight and two notes', async () => {
    const out = process.env.INTEROP_OUT!;
    mkdirSync(out, { recursive: true });
    const original = new Uint8Array(readFileSync(join(__dirname, 'fixtures', 'sample.pdf')));

    // Page 1 text lines are drawn at y = 680, 660, 640 (12 pt Helvetica) starting at x = 72.
    const annotations: Annotation[] = [
      createHighlight({
        pageIndex: 0,
        rects: [[71, 677, 330, 692]],
        color: '#FFE74C',
        text: 'The quick brown fox jumps over the lazy dog.',
        author: 'Interop Tester',
      }),
      {
        ...createHighlight({
          pageIndex: 0,
          rects: [[71, 657, 310, 672]],
          color: '#8CC8FF',
          text: 'Pack my box with five dozen liquor jugs.',
          author: 'Interop Tester',
        }),
        contents: 'A comment on the blue highlight',
      },
      { ...createNote({ pageIndex: 0, point: [400, 600], color: '#FF9EC4', author: 'Interop Tester' }), contents: 'Sticky note' },
      createHighlight({
        pageIndex: 4,
        rects: [[71, 557, 330, 572]],
        color: '#8FE388',
        text: 'Here is the needle in the haystack.',
        author: 'Interop Tester',
      }),
    ];
    const bytes = await writeAnnotations(original, annotations);
    writeFileSync(join(out, 'annotated.pdf'), bytes);
    expect(bytes.length).toBeGreaterThan(original.length);
  });

  it('writes foreign.pdf, annotated the way other tools do it', async () => {
    const out = process.env.INTEROP_OUT!;
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, 'foreign.pdf'), await acrobatStylePdf());
  });
});

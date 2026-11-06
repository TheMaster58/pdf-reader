import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createHighlight, createNote } from '../src/annotations/model';
import { writeAnnotations } from '../src/pdf/annotIO';

const fixture = (name: string) => new Uint8Array(readFileSync(join(__dirname, 'fixtures', name)));

/** Annot flag bit 3: the annotation is drawn when the page is printed (PDF 32000-1, table 165). */
const PRINT_FLAG = 4;

interface Found {
  subtype: string;
  annotationFlags: number;
  hasAppearance: boolean;
}

async function annotationsOnFirstPage(bytes: Uint8Array): Promise<Found[]> {
  const task = getDocument({ data: bytes.slice(), useSystemFonts: true });
  const doc = await task.promise;
  try {
    return (await (await doc.getPage(1)).getAnnotations()) as unknown as Found[];
  } finally {
    await task.destroy();
  }
}

async function pageCount(bytes: Uint8Array): Promise<number> {
  const task = getDocument({ data: bytes.slice(), useSystemFonts: true });
  try {
    return (await task.promise).numPages;
  } finally {
    await task.destroy();
  }
}

const highlight = createHighlight({
  pageIndex: 0,
  rects: [[72, 700, 300, 716]],
  color: '#FFE74C',
  text: 'sample',
});
const note = createNote({ pageIndex: 0, point: [320, 700], color: '#FFE74C' });

// Printing renders "the bytes a save would produce" with PDF.js's print intent, which draws only
// annotations that are marked printable and have an appearance. The page drawing itself can't run
// in Node (no canvas), so these tests pin down the two things that decide what appears on paper.
// The drawing is checked by hand: see the manual checklist in PRINT_EDIT_PLAN.md.
describe('what gets printed', () => {
  it('marks every annotation the app writes as printable and gives it an appearance', async () => {
    const bytes = await writeAnnotations(fixture('sample.pdf'), [highlight, note]);
    const found = await annotationsOnFirstPage(bytes);

    const h = found.find((a) => a.subtype === 'Highlight');
    const n = found.find((a) => a.subtype === 'Text');
    expect(h && h.annotationFlags & PRINT_FLAG).toBeTruthy();
    expect(n && n.annotationFlags & PRINT_FLAG).toBeTruthy();
    expect(h?.hasAppearance).toBe(true);
    expect(n?.hasAppearance).toBe(true);
  });

  it('writing an empty set removes our annotations: nothing of ours prints when switched off', async () => {
    // The print path starts from the file as opened, which may already carry saved annotations.
    const saved = await writeAnnotations(fixture('sample.pdf'), [highlight, note]);
    const stripped = await writeAnnotations(saved, []);
    const found = await annotationsOnFirstPage(stripped);
    expect(found.filter((a) => a.subtype === 'Highlight' || a.subtype === 'Text')).toEqual([]);
  });

  it('keeps every page: same count with and without annotations', async () => {
    const original = fixture('sample.pdf');
    expect(await pageCount(await writeAnnotations(original, [highlight]))).toBe(
      await pageCount(original),
    );
    expect(await pageCount(await writeAnnotations(original, []))).toBe(await pageCount(original));
  });
});

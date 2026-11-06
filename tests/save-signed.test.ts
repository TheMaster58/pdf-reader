import { beforeEach, describe, expect, it, vi } from 'vitest';

// The disk, the worker that builds the file, and PDF.js are replaced: this tests the decisions
// saveCurrent makes about a file that already carries a digital signature, not the PDF writing.
const mocks = vi.hoisted(() => ({
  pickSavePath: vi.fn(),
  writeFileAtomic: vi.fn(async () => undefined),
  writeAnnotationsAsync: vi.fn(async () => new Uint8Array([1, 2, 3])),
}));

vi.mock('../src/services/files', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/services/files')>()),
  pickSavePath: mocks.pickSavePath,
  writeFileAtomic: mocks.writeFileAtomic,
  saveRecent: vi.fn(),
}));
vi.mock('../src/pdf/annotClient', () => ({ writeAnnotationsAsync: mocks.writeAnnotationsAsync }));
vi.mock('../src/viewer/pdfjs', () => ({
  loadPdf: vi.fn(async () => ({
    numPages: 3,
    getPage: async () => ({
      getAnnotations: async () => Array.from({ length: 10 }, () => ({ subtype: 'Highlight' })),
    }),
    loadingTask: { destroy: async () => undefined },
  })),
}));

import { createHighlight } from '../src/annotations/model';
import { saveCurrent, setBaseline } from '../src/annotations/persist';
import { useAnnotations } from '../src/annotations/store';
import { useApp } from '../src/viewer/store';

const annotations = () => useAnnotations.getState();
const app = () => useApp.getState();

function openDocument(signed: boolean) {
  setBaseline(new Uint8Array([9, 9, 9]));
  useApp.setState({
    status: 'ready',
    filePath: 'C:/docs/contract.pdf',
    fileName: 'contract.pdf',
    pagesCount: 3,
    annotationBlock: null,
    saving: false,
    documentSigned: signed,
    signedAcknowledged: false,
    signedPrompt: null,
    error: null,
  });
  annotations().reset();
}

/** Makes an edit, so there is something to save. */
function edit() {
  annotations().addAnnotations([
    createHighlight({ pageIndex: 0, rects: [[10, 10, 100, 22]], color: '#FFE74C', text: 'x' }),
  ]);
}

/** Answers the question as soon as it appears. */
function answerWith(choice: 'copy' | 'overwrite' | 'cancel') {
  const unsubscribe = useApp.subscribe((s) => {
    if (s.signedPrompt) {
      unsubscribe();
      queueMicrotask(() => s.signedPrompt?.resolve(choice));
    }
  });
}

beforeEach(() => {
  mocks.pickSavePath.mockReset();
  mocks.writeFileAtomic.mockClear();
  mocks.writeAnnotationsAsync.mockClear();
});

describe('saving a file that has a digital signature', () => {
  it('asks first, and cancelling writes nothing', async () => {
    openDocument(true);
    edit();
    answerWith('cancel');
    expect(await saveCurrent()).toBe(false);
    expect(mocks.writeFileAtomic).not.toHaveBeenCalled();
    expect(mocks.writeAnnotationsAsync).not.toHaveBeenCalled();
    expect(annotations().dirty).toBe(true); // still unsaved
    expect(app().signedPrompt).toBeNull();
    expect(app().signedAcknowledged).toBe(false);
  });

  it('"Save a copy" asks where, and leaves the signed original alone', async () => {
    openDocument(true);
    edit();
    mocks.pickSavePath.mockResolvedValue('C:/docs/contract copy.pdf');
    answerWith('copy');
    expect(await saveCurrent()).toBe(true);
    expect(mocks.pickSavePath).toHaveBeenCalledTimes(1);
    expect(mocks.writeFileAtomic).toHaveBeenCalledTimes(1);
    expect(mocks.writeFileAtomic).toHaveBeenCalledWith(
      'C:/docs/contract copy.pdf',
      expect.anything(),
    );
    expect(app().filePath).toBe('C:/docs/contract copy.pdf'); // the copy is now the open document
    expect(annotations().dirty).toBe(false);
  });

  it('"Save a copy" and then cancelling the file dialog writes nothing', async () => {
    openDocument(true);
    edit();
    mocks.pickSavePath.mockResolvedValue(null);
    answerWith('copy');
    expect(await saveCurrent()).toBe(false);
    expect(mocks.writeFileAtomic).not.toHaveBeenCalled();
  });

  it('"Save anyway" writes over the file, and does not ask again for this document', async () => {
    openDocument(true);
    edit();
    answerWith('overwrite');
    expect(await saveCurrent()).toBe(true);
    expect(mocks.writeFileAtomic).toHaveBeenCalledWith('C:/docs/contract.pdf', expect.anything());
    expect(app().signedAcknowledged).toBe(true);

    edit();
    const asked = vi.fn();
    const unsubscribe = useApp.subscribe((s) => s.signedPrompt && asked());
    expect(await saveCurrent()).toBe(true); // no prompt this time
    unsubscribe();
    expect(asked).not.toHaveBeenCalled();
    expect(mocks.writeFileAtomic).toHaveBeenCalledTimes(2);
  });

  it('does not ask when the user is already saving a copy (Save as)', async () => {
    openDocument(true);
    edit();
    mocks.pickSavePath.mockResolvedValue('C:/docs/other.pdf');
    const asked = vi.fn();
    const unsubscribe = useApp.subscribe((s) => s.signedPrompt && asked());
    expect(await saveCurrent({ saveAs: true })).toBe(true);
    unsubscribe();
    expect(asked).not.toHaveBeenCalled();
    expect(mocks.writeFileAtomic).toHaveBeenCalledWith('C:/docs/other.pdf', expect.anything());
  });

  it('does not ask when nothing has changed (there is nothing to save)', async () => {
    openDocument(true);
    const asked = vi.fn();
    const unsubscribe = useApp.subscribe((s) => s.signedPrompt && asked());
    expect(await saveCurrent()).toBe(true);
    unsubscribe();
    expect(asked).not.toHaveBeenCalled();
    expect(mocks.writeFileAtomic).not.toHaveBeenCalled();
  });

  it('never asks about an ordinary file', async () => {
    openDocument(false);
    edit();
    const asked = vi.fn();
    const unsubscribe = useApp.subscribe((s) => s.signedPrompt && asked());
    expect(await saveCurrent()).toBe(true);
    unsubscribe();
    expect(asked).not.toHaveBeenCalled();
    expect(mocks.writeFileAtomic).toHaveBeenCalledWith('C:/docs/contract.pdf', expect.anything());
  });

  it('a second request while the question is open does not stack another dialog', async () => {
    openDocument(true);
    edit();
    const first = saveCurrent();
    await Promise.resolve();
    expect(app().signedPrompt).not.toBeNull();
    expect(await saveCurrent()).toBe(false); // refused: already asking
    app().signedPrompt?.resolve('cancel');
    expect(await first).toBe(false);
  });
});

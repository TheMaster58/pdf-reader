import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTextBox, type SignatureArtwork } from '../src/annotations/model';
import { useAnnotations } from '../src/annotations/store';
import { useSignatures } from '../src/signature/signatureStore';

const state = () => useAnnotations.getState();
const art: SignatureArtwork = {
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

describe('the sign tool', () => {
  beforeEach(() => state().reset());

  it('picking up a signature turns the sign tool on and carries it', () => {
    state().startSigning({ variant: 'signature', artwork: art });
    expect(state().tool).toBe('sign');
    expect(state().signing).toEqual({ variant: 'signature', artwork: art });
  });

  it('starts with a clean slate: nothing selected or being typed into', () => {
    const box = createTextBox({ pageIndex: 0, rect: [0, 0, 100, 20], contents: 'x' });
    state().addAnnotations([box]);
    state().setEditing(box.id);
    state().startSigning({ variant: 'initials', artwork: art });
    expect(state().selectedId).toBeNull();
    expect(state().editingId).toBeNull();
  });

  it('leaving the tool drops the signature being carried', () => {
    state().startSigning({ variant: 'signature', artwork: art });
    state().setTool('select');
    expect(state().signing).toBeNull();
    state().startSigning({ variant: 'signature', artwork: art });
    state().setTool('text');
    expect(state().signing).toBeNull();
  });

  it('choosing the sign tool again keeps what is being carried', () => {
    state().startSigning({ variant: 'signature', artwork: art });
    state().setTool('sign');
    expect(state().signing).not.toBeNull();
  });

  it('loading a document ends signing', () => {
    state().startSigning({ variant: 'signature', artwork: art });
    state().loadAnnotations([]);
    expect(state().tool).toBe('select');
    expect(state().signing).toBeNull();
  });
});

describe('the saved signature store', () => {
  let storage: Record<string, string>;
  let failWrites = false;

  beforeEach(() => {
    storage = {};
    failWrites = false;
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => (k in storage ? storage[k] : null),
      setItem: (k: string, v: string) => {
        if (failWrites) throw new Error('QuotaExceededError');
        storage[k] = v;
      },
      removeItem: (k: string) => {
        delete storage[k];
      },
    });
    useSignatures.setState({ saved: [], dialog: null, storageFailed: false });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('saves, newest first, and keeps them in storage', () => {
    const a = useSignatures.getState().save('signature', art);
    const b = useSignatures.getState().save('signature', { ...art, color: '#D32F2F' });
    expect(useSignatures.getState().saved.map((s) => s.id)).toEqual([b.id, a.id]);
    expect(JSON.parse(storage['pdfreader.signatures'])).toHaveLength(2);
  });

  it('keeps signatures and initials in separate lists', () => {
    for (let i = 0; i < 7; i++) useSignatures.getState().save('signature', art);
    useSignatures.getState().save('initials', art);
    const saved = useSignatures.getState().saved;
    expect(saved.filter((s) => s.variant === 'signature')).toHaveLength(5);
    expect(saved.filter((s) => s.variant === 'initials')).toHaveLength(1);
  });

  it('removes one, and everything', () => {
    const a = useSignatures.getState().save('signature', art);
    useSignatures.getState().save('initials', art);
    useSignatures.getState().remove(a.id);
    expect(useSignatures.getState().saved).toHaveLength(1);
    useSignatures.getState().clearAll();
    expect(useSignatures.getState().saved).toEqual([]);
    expect('pdfreader.signatures' in storage).toBe(false);
  });

  it('still works for this session when storage refuses, and says so', () => {
    failWrites = true;
    const a = useSignatures.getState().save('signature', art);
    expect(useSignatures.getState().saved.map((s) => s.id)).toEqual([a.id]);
    expect(useSignatures.getState().storageFailed).toBe(true);
    failWrites = false;
    useSignatures.getState().save('signature', art);
    expect(useSignatures.getState().storageFailed).toBe(false);
  });

  it('opens and closes the dialog for a kind', () => {
    useSignatures.getState().openDialog('initials');
    expect(useSignatures.getState().dialog).toBe('initials');
    useSignatures.getState().closeDialog();
    expect(useSignatures.getState().dialog).toBeNull();
  });
});

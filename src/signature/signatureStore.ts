import { create } from 'zustand';
import type { SignatureArtwork, SignatureVariant } from '../annotations/model';
import {
  addSaved,
  clearSavedSignatures,
  loadSavedSignatures,
  removeSaved,
  storeSavedSignatures,
  type SavedSignature,
} from './savedSignatures';

interface SignatureState {
  /** Signatures and initials kept on this computer, newest first. */
  saved: SavedSignature[];
  /** The "add signature" dialog, when open (for which kind). */
  dialog: SignatureVariant | null;
  /** True after storing failed (storage full or blocked), so the dialog can say so. */
  storageFailed: boolean;

  save: (variant: SignatureVariant, artwork: SignatureArtwork) => SavedSignature;
  remove: (id: string) => void;
  clearAll: () => void;
  openDialog: (variant: SignatureVariant) => void;
  closeDialog: () => void;
}

export const useSignatures = create<SignatureState>((set, get) => ({
  saved: loadSavedSignatures(),
  dialog: null,
  storageFailed: false,

  save: (variant, artwork) => {
    const entry: SavedSignature = {
      id: crypto.randomUUID(),
      variant,
      artwork,
      created: new Date().toISOString(),
    };
    const saved = addSaved(get().saved, entry);
    set({ saved, storageFailed: !storeSavedSignatures(saved) });
    return entry;
  },

  remove: (id) => {
    const saved = removeSaved(get().saved, id);
    set({ saved, storageFailed: !storeSavedSignatures(saved) });
  },

  clearAll: () => {
    clearSavedSignatures();
    set({ saved: [], storageFailed: false });
  },

  openDialog: (dialog) => set({ dialog }),
  closeDialog: () => set({ dialog: null }),
}));

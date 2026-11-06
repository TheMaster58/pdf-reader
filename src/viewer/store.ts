import { create } from 'zustand';
import { loadAuthor, loadRecent } from '../services/files';
import type { SignatureField } from '../pdf/signatureFields';
import type { PasswordReason } from './pdfjs';
import type { ViewMode } from './viewMode';
import { loadViewMode } from './viewPrefs';

export type DocStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface FindStatus {
  query: string;
  current: number;
  total: number;
  /** The last search finished with no results. */
  notFound: boolean;
}

export interface PasswordRequest {
  reason: PasswordReason;
  /** The file being opened (the store's fileName still names the previous document). */
  fileName: string;
  resolve: (password: string | null) => void;
}

/** Why the open document can be read but not annotated. */
export interface AnnotationBlock {
  reason: 'encrypted' | 'invalid';
  message: string;
}

export type UnsavedChoice = 'save' | 'discard' | 'cancel';

/** What to do about saving over a file that carries a digital signature. */
export type SignedChoice = 'copy' | 'overwrite' | 'cancel';

export interface SignedPrompt {
  fileName: string;
  resolve: (choice: SignedChoice) => void;
}

export interface UnsavedPrompt {
  fileName: string;
  resolve: (choice: UnsavedChoice) => void;
}

export interface AppState {
  status: DocStatus;
  error: string | null;
  filePath: string | null;
  fileName: string | null;
  pageNumber: number;
  pagesCount: number;
  /** PDF.js scale value: a preset ('auto', 'page-fit', 'page-width') or a number as a string. */
  scaleValue: string;
  scale: number;
  /** One or two pages across, continuous or one at a time. Remembered between sessions. */
  viewMode: ViewMode;
  findOpen: boolean;
  find: FindStatus;
  recent: string[];
  passwordRequest: PasswordRequest | null;
  dragOver: boolean;
  /** Set when highlights and notes can't be saved for this document (encrypted, unreadable...). */
  annotationBlock: AnnotationBlock | null;
  /** Name stamped on new annotations. */
  author: string;
  saving: boolean;
  unsavedPrompt: UnsavedPrompt | null;
  /** The open file has a digital (certificate) signature that saving in place would invalidate. */
  documentSigned: boolean;
  /** The user has been told, and chose to go ahead, for this document. */
  signedAcknowledged: boolean;
  signedPrompt: SignedPrompt | null;
  /** Empty signature fields in the open document, for placing a signature into. */
  signatureFields: SignatureField[];
  settingsOpen: boolean;
  aboutOpen: boolean;
  /** A short confirmation such as "Saved" that clears itself. */
  notice: string | null;
  noticeTone: 'ok' | 'info';
  /** The one-time explanation of editing existing text is showing. */
  editNoticeOpen: boolean;
}

export const emptyFind: FindStatus = { query: '', current: 0, total: 0, notFound: false };

export const useApp = create<AppState>(() => ({
  status: 'idle',
  error: null,
  filePath: null,
  fileName: null,
  pageNumber: 0,
  pagesCount: 0,
  scaleValue: 'auto',
  scale: 1,
  viewMode: loadViewMode(),
  findOpen: false,
  find: emptyFind,
  recent: loadRecent(),
  passwordRequest: null,
  dragOver: false,
  annotationBlock: null,
  author: loadAuthor() ?? '',
  saving: false,
  unsavedPrompt: null,
  documentSigned: false,
  signedAcknowledged: false,
  signedPrompt: null,
  signatureFields: [],
  settingsOpen: false,
  aboutOpen: false,
  notice: null,
  noticeTone: 'ok',
  editNoticeOpen: false,
}));

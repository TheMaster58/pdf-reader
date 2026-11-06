import type { SignatureArtwork, SignatureVariant } from '../annotations/model';
import { dataUrlToPng, pngSize } from './pngData';
import { sanitizeStrokes } from './strokes';

/** A signature or initials the user chose to keep, so they can sign again with one click. */
export interface SavedSignature {
  id: string;
  variant: SignatureVariant;
  artwork: SignatureArtwork;
  created: string;
}

/** How many of each kind are kept; adding more drops the oldest. */
export const MAX_SAVED_PER_VARIANT = 5;
/** Longest allowed serialised store, in characters. Local storage allows about 5 MB in all. */
export const MAX_STORE_CHARS = 3_000_000;

const STORAGE_KEY = 'pdfreader.signatures';
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

const isSize = (v: unknown): v is [number, number] =>
  Array.isArray(v) &&
  v.length === 2 &&
  v.every((x) => typeof x === 'number' && Number.isFinite(x) && x > 0 && x <= 1e5);

/** Checks artwork of unknown origin and returns clean artwork, or null if it is not usable. */
export function validateArtwork(raw: unknown): SignatureArtwork | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const a = raw as Record<string, unknown>;
  if (a.type === 'strokes') {
    const strokes = sanitizeStrokes(a.strokes);
    if (!strokes || typeof a.color !== 'string' || !HEX_COLOR.test(a.color)) return null;
    if (typeof a.width !== 'number' || !(a.width >= 0.25 && a.width <= 50) || !isSize(a.box))
      return null;
    return { type: 'strokes', strokes, color: a.color, width: a.width, box: [a.box[0], a.box[1]] };
  }
  if (a.type === 'image') {
    const bytes = dataUrlToPng(a.pngDataUrl);
    // The size comes from the picture itself, not from what the stored data claims.
    const size = bytes ? pngSize(bytes) : null;
    return bytes && size ? { type: 'image', pngDataUrl: a.pngDataUrl as string, size } : null;
  }
  return null;
}

/**
 * Reads the stored list. Anything damaged is dropped (one bad entry never hides the others), ids
 * are made unique, and the per-kind limit is applied, so whatever is in storage, the result is safe.
 */
export function parseSavedSignatures(raw: unknown): SavedSignature[] {
  if (!Array.isArray(raw)) return [];
  const out: SavedSignature[] = [];
  const ids = new Set<string>();
  const perVariant: Record<SignatureVariant, number> = { signature: 0, initials: 0 };
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue;
    const e = item as Record<string, unknown>;
    const variant = e.variant === 'signature' || e.variant === 'initials' ? e.variant : null;
    const artwork = validateArtwork(e.artwork);
    if (!variant || !artwork || perVariant[variant] >= MAX_SAVED_PER_VARIANT) continue;
    let id =
      typeof e.id === 'string' && e.id.length > 0 && e.id.length <= 64 ? e.id : crypto.randomUUID();
    if (ids.has(id)) id = crypto.randomUUID();
    ids.add(id);
    perVariant[variant]++;
    const created =
      typeof e.created === 'string' && !Number.isNaN(Date.parse(e.created))
        ? e.created
        : new Date(0).toISOString();
    out.push({ id, variant, artwork, created });
  }
  return out;
}

/** The new entry first; the oldest of its kind is dropped if there are too many. */
export function addSaved(list: readonly SavedSignature[], entry: SavedSignature): SavedSignature[] {
  const others = list.filter((s) => s.id !== entry.id);
  const sameKind = others
    .filter((s) => s.variant === entry.variant)
    .slice(0, MAX_SAVED_PER_VARIANT - 1);
  const otherKind = others.filter((s) => s.variant !== entry.variant);
  return [entry, ...sameKind, ...otherKind];
}

export function removeSaved(list: readonly SavedSignature[], id: string): SavedSignature[] {
  return list.filter((s) => s.id !== id);
}

/** Drops the oldest entries until the serialised list fits in `maxChars`. */
export function fitToSize(
  list: readonly SavedSignature[],
  maxChars = MAX_STORE_CHARS,
): SavedSignature[] {
  const kept = [...list];
  while (kept.length > 0 && JSON.stringify(kept).length > maxChars) {
    // The list is newest first, so the last entry is the oldest.
    kept.pop();
  }
  return kept;
}

export function loadSavedSignatures(): SavedSignature[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? parseSavedSignatures(JSON.parse(raw)) : [];
  } catch {
    return [];
  }
}

/** Writes the list. Returns false if the browser would not store it (full, or storage blocked). */
export function storeSavedSignatures(list: readonly SavedSignature[]): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(fitToSize(list)));
    return true;
  } catch {
    return false;
  }
}

/** Deletes every saved signature from this computer. */
export function clearSavedSignatures(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* nothing stored, or storage blocked */
  }
}

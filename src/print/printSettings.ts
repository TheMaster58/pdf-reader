import { DEFAULT_PRINT_QUALITY, isPrintQuality, type PrintQuality } from './printLayout';

const QUALITY_KEY = 'pdfreader.printQuality';

/** The quality chosen last time, or the default. */
export function loadPrintQuality(): PrintQuality {
  try {
    const raw = localStorage.getItem(QUALITY_KEY);
    return isPrintQuality(raw) ? raw : DEFAULT_PRINT_QUALITY;
  } catch {
    return DEFAULT_PRINT_QUALITY;
  }
}

export function savePrintQuality(quality: PrintQuality): void {
  try {
    localStorage.setItem(QUALITY_KEY, quality);
  } catch {
    /* storage unavailable: the choice just won't be remembered */
  }
}

const pad = (v: number, len = 2) => String(v).padStart(len, '0');

/** ISO 8601 -> PDF date string in UTC, e.g. "D:20261105183000Z". */
export function formatPdfDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return formatPdfDate(new Date().toISOString());
  return (
    'D:' +
    pad(d.getUTCFullYear(), 4) +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds()) +
    'Z'
  );
}

/**
 * PDF date string -> ISO 8601, or null if it can't be understood. Accepts the optional "D:" prefix,
 * partial dates ("D:2026"), and "Z", "+HH'mm'" and "-HH'mm'" zones.
 */
export function parsePdfDate(value: string | undefined): string | null {
  if (!value) return null;
  const m = /^(?:D:)?(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?(?:(Z)|([+-])(\d{2})'?(\d{2})?'?)?/.exec(
    value.trim(),
  );
  if (!m) return null;
  const [, y, mo = '01', d = '01', h = '00', mi = '00', s = '00', z, sign, oh = '00', om = '00'] = m;
  let t = Date.UTC(+y, +mo - 1, +d, +h, +mi, +s);
  if (Number.isNaN(t)) return null;
  if (!z && sign) {
    const offset = (+oh * 60 + +om) * 60_000;
    t -= sign === '+' ? offset : -offset;
  }
  return new Date(t).toISOString();
}

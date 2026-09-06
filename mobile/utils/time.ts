/**
 * IST (Asia/Kolkata, UTC+5:30) formatting helpers.
 *
 * The backend stores datetimes in UTC but serialises them without a 'Z' suffix.
 * Without correction, JavaScript's Date constructor treats zone-less ISO strings
 * as *local* time (browser) or UTC (V8/Hermes — behaviour varies).
 * toUTCDate() appends 'Z' when needed so the value is always parsed as UTC,
 * and then Intl.DateTimeFormat converts it to IST for display.
 */

const IST_ZONE = 'Asia/Kolkata';

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function toUTCDate(isoStr: string): Date {
  // Append 'Z' only when the string has no timezone indicator at all.
  const normalised =
    isoStr.endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(isoStr)
      ? isoStr
      : isoStr + 'Z';
  return new Date(normalised);
}

/** IST calendar date key in YYYY-MM-DD. */
export function getISTDateKey(date: Date = new Date()): string {
  const istDate = new Date(date.getTime() + IST_OFFSET_MS);
  return `${istDate.getUTCFullYear()}-${String(istDate.getUTCMonth() + 1).padStart(2, '0')}-${String(istDate.getUTCDate()).padStart(2, '0')}`;
}

/** Full date + time in IST, e.g. "08 Aug 2026, 03:30 PM" */
export function formatDateTimeIST(isoStr: string | null | undefined): string {
  if (!isoStr) return '—';
  return toUTCDate(isoStr).toLocaleString('en-IN', {
    timeZone: IST_ZONE,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

/** Date only in IST, e.g. "08 Aug 2026" */
export function formatDateIST(isoStr: string | null | undefined): string {
  if (!isoStr) return '—';
  return toUTCDate(isoStr).toLocaleString('en-IN', {
    timeZone: IST_ZONE,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

const BYTE_UNITS = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'] as const;
const RATE_UNITS = ['B/s', 'KiB/s', 'MiB/s', 'GiB/s'] as const;

export const MISSING = '—';

function scale(value: number, units: readonly string[]): { n: number; unit: string } {
  let n = Math.abs(value);
  let index = 0;
  while (n >= 1024 && index < units.length - 1) {
    n /= 1024;
    index += 1;
  }
  return { n: value < 0 ? -n : n, unit: units[index] ?? '' };
}

function digits(n: number): number {
  const a = Math.abs(n);
  return a >= 100 ? 0 : a >= 10 ? 1 : 2;
}

export function formatBytes(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return MISSING;
  const { n, unit } = scale(value, BYTE_UNITS);
  return `${n.toFixed(unit === 'B' ? 0 : digits(n))} ${unit}`;
}

export function formatRate(bytesPerSecond: number | null | undefined): string {
  if (bytesPerSecond === null || bytesPerSecond === undefined || !Number.isFinite(bytesPerSecond)) return MISSING;
  const { n, unit } = scale(bytesPerSecond, RATE_UNITS);
  return `${n.toFixed(unit === 'B/s' ? 0 : digits(n))} ${unit}`;
}

export function formatPercent(value: number | null | undefined, fractionDigits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return MISSING;
  return `${value.toFixed(fractionDigits)}%`;
}

export function formatNumber(value: number | null | undefined, fractionDigits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return MISSING;
  return value.toFixed(fractionDigits);
}

export function formatCelsius(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return MISSING;
  return `${value.toFixed(1)} °C`;
}

export function formatDuration(totalSeconds: number | null | undefined): string {
  if (totalSeconds === null || totalSeconds === undefined || !Number.isFinite(totalSeconds) || totalSeconds < 0) {
    return MISSING;
  }
  const s = Math.floor(totalSeconds);
  const days = Math.floor(s / 86_400);
  const hours = Math.floor((s % 86_400) / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${s % 60}s`;
  return `${s}s`;
}

/** "12 s ago", "3 min ago"… relative to `now`. Future timestamps (clock skew) read as "just now". */
export function formatAgo(iso: string | number | null | undefined, now: number = Date.now()): string {
  if (iso === null || iso === undefined) return 'never';
  const then = typeof iso === 'number' ? iso : Date.parse(iso);
  if (Number.isNaN(then)) return MISSING;
  const seconds = Math.round((now - then) / 1000);
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds} s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)} h ago`;
  return `${Math.floor(seconds / 86_400)} d ago`;
}

/** Local, human timestamp. Internals stay UTC; only display is localised. */
export function formatDateTime(iso: string | number | null | undefined, locale?: string): string {
  if (iso === null || iso === undefined) return MISSING;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return MISSING;
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'medium' }).format(date);
}

export function formatClock(ms: number, withSeconds = false, locale?: string): string {
  const options: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' };
  if (withSeconds) options.second = '2-digit';
  return new Intl.DateTimeFormat(locale, options).format(new Date(ms));
}

export function formatDayClock(ms: number, locale?: string): string {
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(
    new Date(ms),
  );
}

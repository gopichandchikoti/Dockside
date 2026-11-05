import { describe, expect, it } from 'vitest';
import {
  MISSING,
  formatAgo,
  formatBytes,
  formatCelsius,
  formatClock,
  formatDateTime,
  formatDayClock,
  formatDuration,
  formatNumber,
  formatPercent,
  formatRate,
} from './format';

describe('formatBytes', () => {
  it('uses binary units with sensible precision', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1023)).toBe('1023 B');
    expect(formatBytes(1024)).toBe('1.00 KiB');
    expect(formatBytes(1536)).toBe('1.50 KiB');
    expect(formatBytes(10 * 1024 ** 2)).toBe('10.0 MiB');
    expect(formatBytes(250 * 1024 ** 3)).toBe('250 GiB');
    expect(formatBytes(3.2 * 1024 ** 4)).toBe('3.20 TiB');
  });

  it('shows an em dash for missing or non-finite values, never zero', () => {
    for (const bad of [null, undefined, Number.NaN, Number.POSITIVE_INFINITY]) expect(formatBytes(bad)).toBe(MISSING);
  });
});

describe('formatRate', () => {
  it('labels throughput per second', () => {
    expect(formatRate(0)).toBe('0 B/s');
    expect(formatRate(2048)).toBe('2.00 KiB/s');
    expect(formatRate(5 * 1024 ** 2)).toBe('5.00 MiB/s');
    expect(formatRate(null)).toBe(MISSING);
  });
});

describe('percent, number and temperature', () => {
  it('formats values and missing data', () => {
    expect(formatPercent(12.345)).toBe('12.3%');
    expect(formatPercent(12.345, 0)).toBe('12%');
    expect(formatPercent(null)).toBe(MISSING);
    expect(formatNumber(0.5)).toBe('0.50');
    expect(formatNumber(undefined)).toBe(MISSING);
    expect(formatCelsius(48.26)).toBe('48.3 °C');
    expect(formatCelsius(null)).toBe(MISSING);
  });
});

describe('formatDuration', () => {
  it('scales from seconds to days', () => {
    expect(formatDuration(5)).toBe('5s');
    expect(formatDuration(125)).toBe('2m 5s');
    expect(formatDuration(3 * 3600 + 120)).toBe('3h 2m');
    expect(formatDuration(2 * 86_400 + 5 * 3600)).toBe('2d 5h');
  });

  it('rejects negative and missing values', () => {
    expect(formatDuration(-1)).toBe(MISSING);
    expect(formatDuration(null)).toBe(MISSING);
  });
});

describe('formatAgo', () => {
  const now = Date.parse('2026-03-01T12:00:00Z');
  it('describes elapsed time and handles edge cases', () => {
    expect(formatAgo(null, now)).toBe('never');
    expect(formatAgo('garbage', now)).toBe(MISSING);
    expect(formatAgo(now + 5000, now)).toBe('just now');
    expect(formatAgo(now - 30_000, now)).toBe('30 s ago');
    expect(formatAgo(now - 5 * 60_000, now)).toBe('5 min ago');
    expect(formatAgo(now - 3 * 3_600_000, now)).toBe('3 h ago');
    expect(formatAgo(new Date(now - 2 * 86_400_000).toISOString(), now)).toBe('2 d ago');
  });
});

describe('date formatting', () => {
  it('localises display without changing the instant', () => {
    expect(formatDateTime('2026-03-01T12:00:00Z', 'en-GB')).toContain('2026');
    expect(formatDateTime(null)).toBe(MISSING);
    expect(formatDateTime('nonsense')).toBe(MISSING);
    expect(formatClock(Date.UTC(2026, 2, 1, 9, 5), true, 'en-GB')).toMatch(/\d{2}:\d{2}:\d{2}/);
    expect(formatDayClock(Date.UTC(2026, 2, 1, 9, 5), 'en-GB')).toMatch(/Mar/);
  });
});

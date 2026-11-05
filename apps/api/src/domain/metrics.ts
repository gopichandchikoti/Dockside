import type { Host } from '@dockside/shared';
import { seriesKey, type ExposedSample } from './prometheus';

export interface Baseline {
  at: number;
  samples: Map<string, number>;
}
export interface DerivedMetrics {
  latest: Record<string, number | null>;
  filesystems: Host['filesystems'];
  interfaces: Host['interfaces'];
  sensors: Host['sensors'];
  baseline: Baseline;
}
const DENIED_MOUNTS = ['/etc', '/root', '/proc', '/sys', '/dev', '/run', '/var/lib/docker', '/var/lib/containers'];
const PSEUDO = /^(tmpfs|devtmpfs|overlay|squashfs|proc|sysfs|cgroup2?|nsfs|ramfs|autofs|tracefs|debugfs)$/;
export function allowedFilesystem(mount: string, type: string): boolean {
  return (
    mount.startsWith('/') &&
    !mount.split('/').includes('..') &&
    !PSEUDO.test(type) &&
    !DENIED_MOUNTS.some((prefix) => mount === prefix || mount.startsWith(`${prefix}/`))
  );
}
const finite = (n: number | undefined): number | null => (n !== undefined && Number.isFinite(n) ? n : null);

function rate(s: ExposedSample, previous: Baseline | undefined, at: number, maxGap: number): number | null {
  if (!previous || at <= previous.at || at - previous.at > maxGap) return null;
  const before = previous.samples.get(seriesKey(s));
  if (before === undefined || s.value < before) return null;
  return finite((s.value - before) / (at - previous.at));
}
function sumRates(samples: ExposedSample[], baseline: Baseline | undefined, at: number, gap: number): number | null {
  const values = samples.map((s) => rate(s, baseline, at, gap));
  if (!values.length || values.some((v) => v === null)) return null;
  return values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
}
function cpuPercent(samples: ExposedSample[], prev: Baseline | undefined, at: number, gap: number): number | null {
  const cpu = samples.filter(
    (s) => s.name === 'node_cpu_seconds_total' && !['guest', 'guest_nice'].includes(s.labels.mode ?? ''),
  );
  const total = sumRates(cpu, prev, at, gap);
  const idle = sumRates(
    cpu.filter((s) => s.labels.mode === 'idle'),
    prev,
    at,
    gap,
  );
  if (!total || idle === null) return null;
  return Math.max(0, Math.min(100, (1 - idle / total) * 100));
}

function filesystemState(samples: ExposedSample[]): Host['filesystems'] {
  return samples
    .filter((s) => s.name === 'node_filesystem_size_bytes')
    .flatMap((s) => {
      const mount = s.labels.mountpoint ?? '';
      const type = s.labels.fstype ?? '';
      if (!allowedFilesystem(mount, type) || !Number.isFinite(s.value)) return [];
      const available = samples.find(
        (a) =>
          a.name === 'node_filesystem_avail_bytes' &&
          a.labels.mountpoint === mount &&
          a.labels.device === s.labels.device,
      );
      if (!available || !Number.isFinite(available.value)) return [];
      return [{ mount, type, device: s.labels.device ?? '', sizeBytes: s.value, availableBytes: available.value }];
    });
}

export function deriveMetrics(input: {
  samples: ExposedSample[];
  at: number;
  interval: number;
  previous?: Baseline | undefined;
}): DerivedMetrics {
  const { samples, at, previous } = input;
  const gap = input.interval * 3;
  const gauge = (name: string) => finite(samples.find((s) => s.name === name)?.value);
  const memory = gauge('node_memory_MemTotal_bytes');
  const available = gauge('node_memory_MemAvailable_bytes');
  const used = memory !== null && available !== null ? Math.max(0, memory - available) : null;
  const aggregate = (name: string) =>
    sumRates(
      samples.filter((s) => s.name === name && s.labels.device !== 'lo' && !/^(loop|ram)/.test(s.labels.device ?? '')),
      previous,
      at,
      gap,
    );
  const sensors = samples
    .filter((s) => /^(node_hwmon_temp_celsius|node_thermal_zone_temp)$/.test(s.name) && Number.isFinite(s.value))
    .map((s) => ({
      name: [s.labels.chip, s.labels.sensor, s.labels.zone].filter(Boolean).join(' / '),
      celsius: s.value,
    }));
  const boot = gauge('node_boot_time_seconds');
  const filesystems = filesystemState(samples);
  const interfaces = samples
    .filter((s) => s.name === 'node_network_receive_bytes_total' && s.labels.device !== 'lo')
    .map((s) => ({
      name: s.labels.device ?? '',
      receivedBytesPerSecond: rate(s, previous, at, gap),
      sentBytesPerSecond: rateForDevice(samples, s, { previous, at, gap }),
    }));
  return {
    latest: {
      cpu_percent: cpuPercent(samples, previous, at, gap),
      memory_used_bytes: used,
      memory_percent: used !== null && memory ? (used / memory) * 100 : null,
      filesystem_percent: highestFilesystemUsage(filesystems),
      network_rx_bytes_per_second: aggregate('node_network_receive_bytes_total'),
      network_tx_bytes_per_second: aggregate('node_network_transmit_bytes_total'),
      disk_read_bytes_per_second: aggregate('node_disk_read_bytes_total'),
      disk_write_bytes_per_second: aggregate('node_disk_written_bytes_total'),
      uptime_seconds: boot === null ? null : Math.max(0, at - boot),
      load1: gauge('node_load1'),
      temperature_celsius: sensors.length ? Math.max(...sensors.map((s) => s.celsius)) : null,
    },
    filesystems,
    interfaces,
    sensors,
    baseline: { at, samples: new Map(samples.map((s) => [seriesKey(s), s.value])) },
  };
}
function highestFilesystemUsage(filesystems: Host['filesystems']): number | null {
  const values = filesystems
    .filter((f) => f.sizeBytes > 0)
    .map((f) => Math.max(0, Math.min(100, (1 - f.availableBytes / f.sizeBytes) * 100)));
  return values.length ? Math.max(...values) : null;
}

function rateForDevice(
  samples: ExposedSample[],
  s: ExposedSample,
  context: { previous: Baseline | undefined; at: number; gap: number },
): number | null {
  const tx = samples.find((a) => a.name === 'node_network_transmit_bytes_total' && a.labels.device === s.labels.device);
  return tx ? rate(tx, context.previous, context.at, context.gap) : null;
}

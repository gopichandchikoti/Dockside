export function demultiplexLogs(data: Buffer): string {
  if (data.length < 8 || ![0, 1, 2].includes(data[0] ?? 255) || data[1] !== 0 || data[2] !== 0 || data[3] !== 0)
    return data.toString('utf8');
  const chunks: Buffer[] = [];
  let offset = 0;
  while (offset + 8 <= data.length) {
    const size = data.readUInt32BE(offset + 4);
    if (offset + 8 + size > data.length) throw new Error('Truncated Docker log frame.');
    chunks.push(data.subarray(offset + 8, offset + 8 + size));
    offset += 8 + size;
  }
  if (offset !== data.length) throw new Error('Truncated Docker log header.');
  return Buffer.concat(chunks).toString('utf8');
}

export function previousLogCursor(text: string): string | null {
  const match = /(?:^|\n)(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.(\d{1,9}))?Z/.exec(text);
  if (!match?.[1]) return null;
  const seconds = BigInt(Math.floor(Date.parse(`${match[1]}Z`) / 1000));
  const nanos = BigInt((match[2] ?? '').padEnd(9, '0'));
  const before = seconds * 1_000_000_000n + nanos - 1n;
  return `${before / 1_000_000_000n}.${String(before % 1_000_000_000n).padStart(9, '0')}`;
}

interface CpuSnapshot {
  cpu_usage?: { total_usage?: number };
  system_cpu_usage?: number;
  online_cpus?: number;
}
function snapshotValues(snapshot: CpuSnapshot | undefined): { used: number; total: number; cores: number } {
  return {
    used: snapshot?.cpu_usage?.total_usage ?? NaN,
    total: snapshot?.system_cpu_usage ?? NaN,
    cores: snapshot?.online_cpus ?? 1,
  };
}
export function containerCpu(stats: { cpu_stats?: CpuSnapshot; precpu_stats?: CpuSnapshot }): number | null {
  const cpu = snapshotValues(stats.cpu_stats);
  const previous = snapshotValues(stats.precpu_stats);
  const used = cpu.used - previous.used;
  const total = cpu.total - previous.total;
  if (!Number.isFinite(used + total)) return null;
  if (used < 0 || total <= 0) return null;
  return (used / total) * cpu.cores * 100;
}

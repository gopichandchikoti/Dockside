export interface ExposedSample {
  name: string;
  labels: Record<string, string>;
  value: number;
  timestamp: number | null;
}
export interface Exposition {
  samples: ExposedSample[];
  dropped: number;
}
const LINE = /^([a-zA-Z_:][a-zA-Z0-9_:]*)(?:\{(.*)\})?\s+([^\s]+)(?:\s+(-?\d+))?$/;
const LABEL = /\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*"((?:[^"\\]|\\[\\n"])*)"\s*(,|$)/gy;

function labelsFrom(text: string): Record<string, string> | null {
  if (!text.trim()) return {};
  const out: Record<string, string> = {};
  LABEL.lastIndex = 0;
  let end = 0;
  let match: RegExpExecArray | null;
  while ((match = LABEL.exec(text))) {
    const key = match[1] ?? '';
    if (Object.hasOwn(out, key)) return null;
    out[key] = (match[2] ?? '').replace(/\\([\\n"])/g, (_, char: string) => (char === 'n' ? '\n' : char));
    end = LABEL.lastIndex;
  }
  return end === text.length ? out : null;
}

function parseLine(line: string): ExposedSample | null {
  const match = LINE.exec(line);
  if (!match) return null;
  const labels = labelsFrom(match[2] ?? '');
  if (!labels || Object.keys(labels).length > 24) return null;
  const raw = match[3] ?? '';
  const value = parseValue(raw);
  if (!/^(?:NaN|[+-]?Inf|[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)$/.test(raw)) return null;
  return { name: match[1] ?? '', labels, value, timestamp: match[4] ? Number(match[4]) : null };
}
function parseValue(raw: string): number {
  if (raw === '+Inf' || raw === 'Inf') return Infinity;
  return raw === '-Inf' ? -Infinity : Number(raw);
}

export function seriesKey(sample: ExposedSample): string {
  return `${sample.name}:${JSON.stringify(Object.entries(sample.labels).sort(([a], [b]) => a.localeCompare(b)))}`;
}

export function parseExposition(text: string, limits = { families: 256, series: 4096 }): Exposition {
  const samples: ExposedSample[] = [];
  const families = new Set<string>();
  const keys = new Set<string>();
  let dropped = 0;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const sample = parseLine(line);
    if (!sample) {
      dropped += 1;
      continue;
    }
    const key = seriesKey(sample);
    const full = !families.has(sample.name) && families.size >= limits.families;
    if (full || samples.length >= limits.series || keys.has(key)) {
      dropped += 1;
      continue;
    }
    families.add(sample.name);
    keys.add(key);
    samples.push(sample);
  }
  return { samples, dropped };
}

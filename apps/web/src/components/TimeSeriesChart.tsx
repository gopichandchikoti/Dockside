import type { Series } from '@dockside/shared';
import { useState, type KeyboardEvent, type PointerEvent } from 'react';
import { formatBytes, formatRate, formatDateTime, formatDayClock, formatNumber } from '../lib/format';

export function chartPath(points: Series['points'], bounds: { min: number; max: number }): string {
  const start = points[0]?.[0] ?? 0;
  const span = Math.max(1, (points.at(-1)?.[0] ?? start) - start);
  let drawing = false;
  return points
    .map(([ts, value]) => {
      if (value === null) {
        drawing = false;
        return '';
      }
      const x = 54 + ((ts - start) / span) * 526;
      const y = 154 - ((value - bounds.min) / Math.max(1, bounds.max - bounds.min)) * 136;
      const command = `${drawing ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`;
      drawing = true;
      return command;
    })
    .join(' ');
}

export function TimeSeriesChart({ series, title }: { series: Series; title: string }) {
  const [cursor, setCursor] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const values = series.points.flatMap(([, value]) => (value === null ? [] : [value]));
  const bounds = { min: Math.min(0, ...values), max: Math.max(1, ...values) };
  const index = Math.min(series.points.length - 1, cursor ?? series.points.length - 1);
  const selected = series.points[index];
  const x = 54 + (Math.max(0, index) / Math.max(1, series.points.length - 1)) * 526;
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const fraction = (((e.clientX - rect.left) / rect.width) * 600 - 54) / 526;
    setCursor(Math.round(Math.max(0, Math.min(1, fraction)) * (series.points.length - 1)));
  };
  const key = (e: KeyboardEvent) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const next =
      e.key === 'Home' ? 0 : e.key === 'End' ? series.points.length - 1 : index + (e.key === 'ArrowLeft' ? -1 : 1);
    setCursor(Math.max(0, Math.min(series.points.length - 1, next)));
  };
  return (
    <figure className="chart">
      <div className="section__head">
        <h3>{title}</h3>
        <button className="btn" type="button" onClick={() => setTable(!table)}>
          {table ? 'View as chart' : 'View as table'}
        </button>
      </div>
      {table ? (
        <ChartTable series={series} />
      ) : (
        <div
          tabIndex={0}
          role="group"
          aria-label={`${title}: use arrow keys to inspect`}
          onKeyDown={key}
          onPointerMove={move}
          className="chart__plot"
        >
          <ChartSvg series={series} title={title} bounds={bounds} x={x} />
          {!values.length ? (
            <p className="muted small">No measurements in this range yet. The exporter may not expose this metric.</p>
          ) : null}
          <output className="chart__readout" aria-live="polite">
            {selected
              ? `${formatDateTime(selected[0])} · ${
                  selected[1] === null ? 'No sample' : `${formatNumber(selected[1])} ${series.unit}`
                }`
              : 'No samples'}
          </output>
        </div>
      )}
      <figcaption className="small muted">
        {series.source} · {series.unit} · sampled every {series.cadenceSeconds} s. Missing samples remain gaps. Arrow
        keys move the cursor.
      </figcaption>
    </figure>
  );
}
function ChartTable({ series }: { series: Series }) {
  return (
    <div className="table-wrap chart__table" tabIndex={0} role="region" aria-label="Chart data table">
      <table className="table">
        <caption className="sr-only">Measurements in {series.unit}</caption>
        <thead>
          <tr>
            <th scope="col">Time</th>
            <th scope="col">Value ({series.unit})</th>
          </tr>
        </thead>
        <tbody>
          {series.points.map(([ts, value]) => (
            <tr key={ts}>
              <td>{formatDateTime(ts)}</td>
              <td className="num">{value === null ? 'No sample' : formatNumber(value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ChartSvg({
  series,
  title,
  bounds,
  x,
}: {
  series: Series;
  title: string;
  bounds: { min: number; max: number };
  x: number;
}) {
  return (
    <svg viewBox="0 0 600 184" role="img" aria-label={`${title} in ${series.unit}. Gaps indicate missing data.`}>
      {[0, 0.5, 1].map((fraction) => (
        <g key={fraction}>
          <line x1="54" x2="580" y1={154 - fraction * 136} y2={154 - fraction * 136} className="chart__grid" />
          <text x="48" y={158 - fraction * 136} textAnchor="end">
            {axisValue(bounds.min + (bounds.max - bounds.min) * fraction, series.unit)}
          </text>
        </g>
      ))}
      <path d={chartPath(series.points, bounds)} className="chart__line" />
      <line x1={x} x2={x} y1="18" y2="154" className="chart__cursor" />
      <text x="54" y="178">
        {formatDayClock(series.points[0]?.[0] ?? 0)}
      </text>
      <text x="580" y="178" textAnchor="end">
        {formatDayClock(series.points.at(-1)?.[0] ?? 0)}
      </text>
    </svg>
  );
}
function axisValue(value: number, unit: string): string {
  if (unit === 'B') return formatBytes(value);
  if (unit === 'B/s') return formatRate(value);
  return formatNumber(value, 1);
}

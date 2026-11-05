import { REFRESH_CHOICES, updatePrefs, usePrefs, type RefreshSeconds } from '../lib/prefs';
import { Icon } from './Icon';
export function RefreshControl({ refresh }: { refresh: () => Promise<unknown> }) {
  const { refreshSeconds } = usePrefs();
  return (
    <div className="row">
      <label className="field">
        <span className="sr-only">Refresh interval</span>
        <select
          className="select"
          value={refreshSeconds}
          onChange={(e) => updatePrefs({ refreshSeconds: Number(e.target.value) as RefreshSeconds })}
        >
          {REFRESH_CHOICES.map((s) => (
            <option key={s} value={s}>
              {s ? `Every ${s} s` : 'Paused'}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className="btn btn--icon"
        aria-label="Refresh data"
        title="Refresh data"
        onClick={() => void refresh()}
      >
        <Icon name="refresh" />
      </button>
    </div>
  );
}

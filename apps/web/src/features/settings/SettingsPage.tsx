import { ChangePasswordRequestSchema, PASSWORD_MIN } from '@dockside/shared';
import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Field } from '../../components/Field';
import { Icon } from '../../components/Icon';
import { Segmented } from '../../components/Segmented';
import { PageHead } from '../../components/States';
import { api, describeError } from '../../lib/api';
import {
  REFRESH_CHOICES,
  updatePrefs,
  usePrefs,
  type MotionPref,
  type RefreshSeconds,
  type ThemePref,
} from '../../lib/prefs';
import { useAuth } from '../session/SessionProvider';
import { PlatformStatusList } from './PlatformStatusList';

const THEMES = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
] as const;

const MOTION = [
  { value: 'system', label: 'Follow system' },
  { value: 'reduce', label: 'Reduce' },
  { value: 'allow', label: 'Full' },
] as const;

function AppearanceSection() {
  const prefs = usePrefs();
  return (
    <section className="section" aria-labelledby="appearance">
      <h2 id="appearance">Appearance</h2>
      <div className="stack">
        <div className="field">
          <span className="field__label">Theme</span>
          <Segmented<ThemePref>
            label="Theme"
            value={prefs.theme}
            options={THEMES}
            onChange={(theme) => updatePrefs({ theme })}
          />
        </div>
        <div className="field">
          <span className="field__label">Motion</span>
          <Segmented<MotionPref>
            label="Motion"
            value={prefs.motion}
            options={MOTION}
            onChange={(motion) => updatePrefs({ motion })}
          />
          <span className="field__hint">
            “Reduce” removes transitions and animation. “Follow system” respects your operating system setting.
          </span>
        </div>
        <label className="field">
          <span className="field__label">Default refresh interval</span>
          <select
            className="select"
            value={prefs.refreshSeconds}
            onChange={(e) => updatePrefs({ refreshSeconds: Number(e.target.value) as RefreshSeconds })}
          >
            {REFRESH_CHOICES.map((seconds) => (
              <option key={seconds} value={seconds}>
                {seconds === 0 ? 'Paused (manual refresh)' : `Every ${seconds} s`}
              </option>
            ))}
          </select>
          <span className="field__hint">Stored in this browser only.</span>
        </label>
      </div>
    </section>
  );
}

function PasswordSection() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const change = useMutation({
    mutationFn: (body: { currentPassword: string; newPassword: string }) => api.post('/api/v1/me/password', body),
    onSuccess: () => {
      setCurrent('');
      setNext('');
    },
  });
  const invalid = !ChangePasswordRequestSchema.safeParse({ currentPassword: current, newPassword: next }).success;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    change.mutate({ currentPassword: current, newPassword: next });
  };

  return (
    <section className="section" aria-labelledby="password">
      <h2 id="password">Password</h2>
      <form className="stack narrow-form" onSubmit={submit} noValidate>
        <Field
          label="Current password"
          type="password"
          autoComplete="current-password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
        />
        <Field
          label="New password"
          type="password"
          autoComplete="new-password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          hint={`At least ${PASSWORD_MIN} characters. Other signed-in sessions will be ended.`}
        />
        {change.isError ? (
          <div className="notice" data-tone="crit" role="alert">
            <Icon name="alert" />
            <div className="notice__body">{describeError(change.error)}</div>
          </div>
        ) : null}
        {change.isSuccess ? (
          <div className="notice" data-tone="info" role="status">
            <Icon name="check" />
            <div className="notice__body">Password changed. Other sessions were signed out.</div>
          </div>
        ) : null}
        <div>
          <button type="submit" className="btn" disabled={invalid || change.isPending}>
            {change.isPending ? 'Saving…' : 'Change password'}
          </button>
        </div>
      </form>
    </section>
  );
}

export function SettingsPage() {
  const { features, user, can } = useAuth();
  return (
    <>
      <PageHead title="Settings" sub={`Signed in as ${user.username} (${user.role}).`} />
      {can('users:manage') ? (
        <div className="row">
          <Link className="btn" to="/admin/users">
            Manage users
          </Link>
          <Link className="btn" to="/admin/audit">
            Audit trail
          </Link>
        </div>
      ) : null}
      <AppearanceSection />
      <PasswordSection />
      <section className="section" aria-labelledby="data">
        <h2 id="data">Data &amp; retention</h2>
        <dl className="kv">
          <div>
            <dt>Scrape interval</dt>
            <dd className="num">{features.scrapeIntervalSeconds} s</dd>
          </div>
          <div>
            <dt>Raw samples kept</dt>
            <dd className="num">{features.rawRetentionDays} days</dd>
          </div>
          <div>
            <dt>5-minute rollups kept</dt>
            <dd className="num">{features.rollupRetentionDays} days</dd>
          </div>
          <div>
            <dt>Container actions</dt>
            <dd>{features.containerActionsEnabled ? 'Enabled by the operator' : 'Off (read-only)'}</dd>
          </div>
        </dl>
        <p className="muted small">These values come from the server&apos;s environment and cannot be changed here.</p>
      </section>
      <PlatformStatusList />
    </>
  );
}

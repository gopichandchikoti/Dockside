import { useMutation, useQueryClient } from '@tanstack/react-query';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth, SESSION_KEY } from '../features/session/SessionProvider';
import { api, setCsrfToken } from '../lib/api';
import { useDisconnected } from '../lib/connection';
import { updatePrefs, usePrefs, type ThemePref } from '../lib/prefs';
import { Icon } from './Icon';
import { Logo } from './Logo';
import { NAV_ITEMS } from './nav';

const NEXT_THEME: Record<ThemePref, ThemePref> = { system: 'light', light: 'dark', dark: 'system' };
const THEME_ICON = { system: 'monitor', light: 'sun', dark: 'moon' } as const;

function ThemeButton() {
  const { theme } = usePrefs();
  return (
    <button
      type="button"
      className="btn btn--ghost btn--icon"
      onClick={() => updatePrefs({ theme: NEXT_THEME[theme] })}
      aria-label={`Theme: ${theme}. Switch to ${NEXT_THEME[theme]}.`}
      title={`Theme: ${theme}`}
    >
      <Icon name={THEME_ICON[theme]} />
    </button>
  );
}

function useSignOut() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api.post('/api/v1/logout'),
    onSettled: () => {
      setCsrfToken(null);
      client.clear();
      client.setQueryData(SESSION_KEY, { setupRequired: false, user: null, csrfToken: null, features: null });
    },
  });
}

function SignOutButton({ label }: { label?: string }) {
  const signOut = useSignOut();
  return (
    <button
      type="button"
      className={label ? 'btn btn--ghost' : 'btn btn--ghost btn--icon'}
      onClick={() => signOut.mutate()}
      aria-label="Sign out"
      disabled={signOut.isPending}
    >
      <Icon name="logout" />
      {label ? <span>{label}</span> : null}
    </button>
  );
}

function Banners() {
  const { features } = useAuth();
  const disconnected = useDisconnected();
  return (
    <>
      {disconnected ? (
        <div className="notice" data-tone="crit" role="alert">
          <Icon name="plug" />
          <div className="notice__body">
            <span className="notice__title">Disconnected from the Dockside server</span>
            <span>Showing the last data received. Retrying automatically.</span>
          </div>
        </div>
      ) : null}
      {features.sampleData ? (
        <div className="notice" data-tone="warn" role="note">
          <Icon name="sparkle" />
          <div className="notice__body">
            <span className="notice__title">Sample data mode</span>
            <span>
              This server is wired to the bundled sample stack. Values are simulated for development and screenshots —
              they are not readings from a real machine.
            </span>
          </div>
        </div>
      ) : null}
    </>
  );
}

export function AppShell() {
  const { user, can } = useAuth();
  const items = NAV_ITEMS.filter((item) => can(item.permission));

  return (
    <div className="app">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <aside className="rail">
        <NavLink to="/" className="brand" aria-label="Dockside home">
          <Logo size={34} />
          <span>
            <span className="brand__name">Dockside</span>
            <span className="brand__tag">personal cloud console</span>
          </span>
        </NavLink>
        <nav className="nav" aria-label="Primary">
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className="nav__link"
              aria-label={item.label}
              title={item.label}
            >
              <Icon name={item.icon} />
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="rail__foot">
          <div className="whoami">
            <strong>{user.username}</strong>
            <span className="whoami__role">{user.role}</span>
          </div>
          <div className="row">
            <ThemeButton />
            <SignOutButton label="Sign out" />
          </div>
        </div>
      </aside>
      <main className="main" id="main" tabIndex={-1}>
        <div className="mobile-head">
          <span className="row">
            <Logo size={28} />
            <strong>Dockside</strong>
          </span>
          <span className="row">
            <ThemeButton />
            <SignOutButton />
          </span>
        </div>
        <div className="page">
          <Banners />
          <Outlet />
        </div>
      </main>
    </div>
  );
}

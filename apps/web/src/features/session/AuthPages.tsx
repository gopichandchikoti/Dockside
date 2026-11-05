import { useMutation, useQueryClient } from '@tanstack/react-query';
import { SessionInfoSchema, PASSWORD_MIN, type SessionInfo } from '@dockside/shared';
import { useState, type FormEvent } from 'react';
import { Field } from '../../components/Field';
import { Icon } from '../../components/Icon';
import { Logo } from '../../components/Logo';
import { api, setCsrfToken } from '../../lib/api';
import { FormError } from '../../components/QueryState';
import { SESSION_KEY } from './SessionProvider';

function useSessionMutation<V>(path: string, payload: (v: V) => unknown) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (values: V) => api.post<SessionInfo>(path, payload(values), SessionInfoSchema),
    onSuccess: (session) => {
      setCsrfToken(session.csrfToken);
      client.setQueryData(SESSION_KEY, session);
    },
  });
}

function AuthFrame({ title, lead, children }: { title: string; lead: string; children: React.ReactNode }) {
  return (
    <main className="auth" id="main">
      <div className="auth__panel">
        <div className="row">
          <Logo size={40} />
          <div>
            <h1>{title}</h1>
            <p className="muted small">{lead}</p>
          </div>
        </div>
        {children}
      </div>
    </main>
  );
}

export function LoginPage({ expired }: { expired: boolean }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const login = useSessionMutation('/api/v1/login', (v: { username: string; password: string }) => v);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    login.mutate({ username, password });
  };

  return (
    <AuthFrame title="Sign in to Dockside" lead="Your servers, in one quiet place.">
      {expired && !login.isPending ? (
        <div className="notice" data-tone="info" role="status">
          <Icon name="clock" />
          <div className="notice__body">Your session ended. Sign in again to continue.</div>
        </div>
      ) : null}
      <form className="stack" onSubmit={submit} noValidate>
        <Field
          label="Username"
          name="username"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
        />
        <Field
          label="Password"
          name="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        <FormError error={login.error} />
        <button className="btn btn--primary" type="submit" disabled={login.isPending || !username || !password}>
          {login.isPending ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </AuthFrame>
  );
}

export function SetupPage() {
  const [setupToken, setSetupToken] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const setup = useSessionMutation(
    '/api/v1/setup',
    (v: { setupToken: string; username: string; password: string }) => v,
  );
  const incomplete = [setupToken, username, password, confirm].some((value) => !value);
  const mismatch = confirm.length > 0 && confirm !== password;
  const short = password.length > 0 && password.length < PASSWORD_MIN;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!mismatch && !short) setup.mutate({ setupToken, username, password });
  };

  return (
    <AuthFrame title="Welcome to Dockside" lead="Create the first administrator account. No data leaves your server.">
      <form className="stack" onSubmit={submit} noValidate>
        <SetupIdentity
          setupToken={setupToken}
          username={username}
          setSetupToken={setSetupToken}
          setUsername={setUsername}
        />
        <Field
          label="Password"
          name="password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={short ? `Use at least ${PASSWORD_MIN} characters (${password.length} so far).` : null}
          hint={`At least ${PASSWORD_MIN} characters. A passphrase works well.`}
          required
        />
        <Field
          label="Confirm password"
          name="confirm"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          error={mismatch ? 'The passwords do not match.' : null}
          required
        />
        <FormError error={setup.error} />
        <button
          className="btn btn--primary"
          type="submit"
          disabled={setup.isPending || incomplete || mismatch || short}
        >
          {setup.isPending ? 'Creating account…' : 'Create admin account'}
        </button>
      </form>
    </AuthFrame>
  );
}

function SetupIdentity({
  setupToken,
  username,
  setSetupToken,
  setUsername,
}: {
  setupToken: string;
  username: string;
  setSetupToken: (value: string) => void;
  setUsername: (value: string) => void;
}) {
  return (
    <>
      {' '}
      <Field
        label="Setup token"
        name="setupToken"
        type="password"
        autoComplete="off"
        value={setupToken}
        onChange={(e) => setSetupToken(e.target.value)}
        hint={
          <>
            The <code>SETUP_TOKEN</code> value from your <code>.env</code> file.
          </>
        }
        required
      />
      <Field
        label="Admin username"
        name="username"
        autoComplete="username"
        autoCapitalize="none"
        spellCheck={false}
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        hint="3–32 characters: lowercase letters, digits, dot, dash, underscore."
        required
      />
    </>
  );
}

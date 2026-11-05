import {
  SessionInfoSchema,
  can,
  type FeatureFlags,
  type Permission,
  type SessionInfo,
  type UserSummary,
} from '@dockside/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, setCsrfToken, setUnauthenticatedHandler } from '../../lib/api';

export const SESSION_KEY = ['session'] as const;

export async function fetchSession(): Promise<SessionInfo> {
  const session = await api.get('/api/v1/session', SessionInfoSchema);
  setCsrfToken(session.csrfToken);
  return session;
}

export interface AuthedSession {
  user: UserSummary;
  features: FeatureFlags;
  can: (permission: Permission) => boolean;
}

const AuthContext = createContext<AuthedSession | null>(null);

export function AuthProvider({ session, children }: { session: SessionInfo; children: ReactNode }) {
  const value = useMemo<AuthedSession | null>(() => {
    if (!session.user || !session.features) return null;
    const { role } = session.user;
    return { user: session.user, features: session.features, can: (permission) => can(role, permission) };
  }, [session]);
  if (!value) return null;
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthedSession {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside an authenticated tree.');
  return value;
}

/** Session query plus "your session ended" tracking for the login screen. */
export function useSessionState() {
  const client = useQueryClient();
  const [expired, setExpired] = useState(false);
  const query = useQuery({ queryKey: SESSION_KEY, queryFn: fetchSession, retry: false, staleTime: 30_000 });

  useEffect(() => {
    setUnauthenticatedHandler(() => {
      setExpired(true);
      setCsrfToken(null);
      void client.invalidateQueries({ queryKey: SESSION_KEY });
    });
    return () => setUnauthenticatedHandler(null);
  }, [client]);

  const clearExpired = useCallback(() => setExpired(false), []);
  return { query, expired, clearExpired };
}

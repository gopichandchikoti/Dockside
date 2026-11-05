import { Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { ErrorBlock, LoadingBlock } from './components/States';
import { LoginPage, SetupPage } from './features/session/AuthPages';
import { AuthProvider, useSessionState } from './features/session/SessionProvider';
import { SettingsPage } from './features/settings/SettingsPage';
import { OverviewPage } from './features/overview/OverviewPage';

export function App() {
  const { query, expired } = useSessionState();

  if (query.isPending) {
    return (
      <div className="auth">
        <div className="auth__panel">
          <LoadingBlock label="Connecting to Dockside" rows={2} />
        </div>
      </div>
    );
  }
  if (query.isError) {
    return (
      <div className="auth">
        <div className="auth__panel">
          <ErrorBlock title="Cannot reach Dockside" error={query.error} onRetry={() => void query.refetch()} />
        </div>
      </div>
    );
  }

  const session = query.data;
  if (session.setupRequired) return <SetupPage />;
  if (!session.user) return <LoginPage expired={expired} />;

  return (
    <AuthProvider session={session}>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<OverviewPage />} />
          <Route path="hosts/:id" element={<HostPage />} />
          <Route path="containers" element={<ContainersPage />} />
          <Route path="checks" element={<ChecksPage />} />
          <Route path="alerts" element={<AlertsPage />} />
          <Route path="admin/users" element={<UsersPage />} />
          <Route path="admin/audit" element={<AuditPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="*" element={<OverviewPage />} />
        </Route>
      </Routes>
    </AuthProvider>
  );
}
import { HostPage } from './features/hosts/HostPage';
import { ContainersPage } from './features/containers/ContainersPage';
import { ChecksPage } from './features/checks/ChecksPage';
import { AlertsPage } from './features/alerts/AlertsPage';
import { UsersPage } from './features/admin/UsersPage';
import { AuditPage } from './features/admin/AuditPage';

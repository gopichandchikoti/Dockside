import { CreateUserRequestSchema, ROLES, UserSummarySchema, type Role, type UserSummary } from '@dockside/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { z } from 'zod';
import { ConfirmButton } from '../../components/ConfirmButton';
import { DataTable, type Column } from '../../components/DataTable';
import { Field } from '../../components/Field';
import { FormError, QueryState } from '../../components/QueryState';
import { PageHead } from '../../components/States';
import { api } from '../../lib/api';

export function UsersPage() {
  const query = useQuery({ queryKey: ['users'], queryFn: () => api.get('/api/v1/users', z.array(UserSummarySchema)) });
  const columns: Column<UserSummary>[] = [
    { key: 'name', label: 'User', render: (u) => u.username },
    { key: 'role', label: 'Role', render: (u) => <UserRole user={u} refresh={query.refetch} /> },
    { key: 'status', label: 'Status', render: (u) => (u.disabled ? '△ Disabled' : '✓ Enabled') },
    {
      key: 'action',
      label: 'Actions',
      render: (u) => (
        <ConfirmButton
          label={u.disabled ? 'Enable user' : 'Disable user'}
          message={`Change access for ${u.username}? Existing sessions will end.`}
          onConfirm={async () => {
            await api.patch(`/api/v1/users/${u.id}`, { disabled: !u.disabled }, UserSummarySchema);
            await query.refetch();
          }}
        />
      ),
    },
  ];
  return (
    <>
      <Link to="/settings">← Settings</Link>
      <PageHead title="Users" sub="Roles apply to the entire fleet. At least one enabled administrator must remain." />
      <QueryState query={query}>
        {query.data ? <DataTable caption="User administration" rows={query.data} columns={columns} /> : null}
      </QueryState>
      <CreateUser refresh={query.refetch} />
    </>
  );
}
function UserRole({ user, refresh }: { user: UserSummary; refresh: () => Promise<unknown> }) {
  const [role, setRole] = useState<Role>(user.role);
  return (
    <div className="row">
      <label>
        <span className="sr-only">Role for {user.username}</span>
        <select className="select" value={role} onChange={(e) => setRole(e.target.value as Role)}>
          {ROLES.map((r) => (
            <option key={r}>{r}</option>
          ))}
        </select>
      </label>
      <ConfirmButton
        label="Apply role"
        disabled={role === user.role}
        message={`Set ${user.username} to ${role}? Their sessions will end.`}
        onConfirm={async () => {
          await api.patch(`/api/v1/users/${user.id}`, { role }, UserSummarySchema);
          await refresh();
        }}
      />
    </div>
  );
}
function CreateUser({ refresh }: { refresh: () => Promise<unknown> }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<Role>('viewer');
  const save = useMutation({
    mutationFn: () =>
      api.post('/api/v1/users', CreateUserRequestSchema.parse({ username, password, role }), UserSummarySchema),
    onSuccess: async () => {
      setUsername('');
      setPassword('');
      await refresh();
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };
  return (
    <section className="section">
      <h2>Add user</h2>
      <form className="stack" onSubmit={submit}>
        <div className="form-grid">
          <Field
            label="Username"
            autoComplete="off"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
          <Field
            label="Initial password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            hint="At least 12 characters."
          />
          <label className="field">
            <span className="field__label">Role</span>
            <select className="select" value={role} onChange={(e) => setRole(e.target.value as Role)}>
              {ROLES.map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
          </label>
        </div>
        <FormError error={save.error} />
        <div>
          <button className="btn btn--primary" disabled={save.isPending}>
            Create user
          </button>
        </div>
      </form>
    </section>
  );
}

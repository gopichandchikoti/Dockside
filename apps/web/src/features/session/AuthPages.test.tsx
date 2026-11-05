import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LoginPage, SetupPage } from './AuthPages';
import { SESSION_KEY } from './SessionProvider';
import { fixtureSession, jsonResponse, renderUI } from '../../test/fixtures';

beforeEach(() => vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(fixtureSession()))));
afterEach(() => vi.unstubAllGlobals());
describe('sign-in and first-run workflows', () => {
  it('validates empty login, signs in and stores the validated session', async () => {
    const { client } = renderUI(<LoginPage expired={false} />);
    const user = userEvent.setup();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeDisabled();
    await user.type(screen.getByLabelText('Username'), 'admin');
    await user.type(screen.getByLabelText('Password'), 'long test password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(client.getQueryData(SESSION_KEY)).toMatchObject({ user: { username: 'admin' } }));
  });
  it('shows session expiry and keeps the draft after rejected credentials', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(jsonResponse({ error: { code: 'unauthenticated', message: 'Invalid credentials' } }, 401)),
    );
    renderUI(<LoginPage expired />);
    expect(screen.getByRole('status')).toHaveTextContent('Your session ended');
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Username'), 'admin');
    await user.type(screen.getByLabelText('Password'), 'bad password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid credentials');
    expect(screen.getByLabelText('Username')).toHaveValue('admin');
  });
  it('requires confirmation, reports mismatch and short passwords, then creates the administrator', async () => {
    const { client } = renderUI(<SetupPage />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Setup token'), 'test-setup-token');
    await user.type(screen.getByLabelText('Admin username'), 'admin');
    await user.type(screen.getByLabelText('Password', { exact: true }), 'short');
    expect(screen.getByText(/5 so far/)).toBeVisible();
    await user.clear(screen.getByLabelText('Password', { exact: true }));
    await user.type(screen.getByLabelText('Password', { exact: true }), 'long test password');
    expect(screen.getByRole('button', { name: 'Create admin account' })).toBeDisabled();
    await user.type(screen.getByLabelText('Confirm password'), 'different');
    expect(screen.getByText('The passwords do not match.')).toBeVisible();
    await user.clear(screen.getByLabelText('Confirm password'));
    await user.type(screen.getByLabelText('Confirm password'), 'long test password');
    await user.click(screen.getByRole('button', { name: 'Create admin account' }));
    await waitFor(() => expect(client.getQueryData(SESSION_KEY)).toEqual(fixtureSession()));
  });
});

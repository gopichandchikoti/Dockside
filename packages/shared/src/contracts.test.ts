import { describe, expect, it } from 'vitest';
import { can, isRole, PERMISSIONS } from './roles';
import { HttpUrlSchema, HostInputSchema, CheckInputSchema, RuleInputSchema } from './monitoring';
import { LoginRequestSchema, PasswordSchema, UpdateUserRequestSchema, UsernameSchema } from './auth';
import { ApiErrorSchema } from './errors';

describe('permission and input contracts', () => {
  it('grants admins every permission and operators only operational mutations', () => {
    for (const permission of PERMISSIONS) expect(can('admin', permission)).toBe(true);
    expect(can('viewer', 'containers:logs')).toBe(false);
    expect(can('operator', 'containers:restart')).toBe(true);
    expect(can('operator', 'users:manage')).toBe(false);
    expect(can('viewer', 'hosts:read')).toBe(true);
    expect(isRole('admin')).toBe(true);
    expect(isRole(null)).toBe(false);
    expect(isRole('owner')).toBe(false);
  });
  it.each([
    'file:///etc/passwd',
    'http://user:pass@localhost',
    'https://x/#secret',
    'http://169.254.169.254/latest',
    'not a url',
  ])('rejects unsafe destination %s', (url) => {
    expect(HttpUrlSchema.safeParse(url).success).toBe(false);
  });
  it('allows private exporters but validates names, limits, check targets and alert IDs', () => {
    expect(HostInputSchema.parse({ name: ' LAN ', metricsUrl: 'http://192.168.1.2:9100/metrics' }).name).toBe('LAN');
    expect(HostInputSchema.safeParse({ name: '', metricsUrl: 'http://localhost' }).success).toBe(false);
    expect(CheckInputSchema.safeParse({ name: 'HTTP', kind: 'http', target: 'file:///etc' }).success).toBe(false);
    expect(CheckInputSchema.safeParse({ name: 'TCP', kind: 'tcp', target: 'localhost' }).success).toBe(false);
    expect(CheckInputSchema.safeParse({ name: 'TCP', kind: 'tcp', target: 'localhost', port: 80 }).success).toBe(true);
    expect(RuleInputSchema.safeParse({ name: 'CPU', hostId: '../bad' }).success).toBe(false);
  });
  it('validates authentication without permitting empty edits', () => {
    expect(UsernameSchema.parse(' ADMIN ')).toBe('admin');
    expect(PasswordSchema.safeParse('short').success).toBe(false);
    expect(PasswordSchema.safeParse('long enough password').success).toBe(true);
    expect(LoginRequestSchema.safeParse({ username: 'admin', password: '' }).success).toBe(false);
    expect(UpdateUserRequestSchema.safeParse({}).success).toBe(false);
    expect(UpdateUserRequestSchema.safeParse({ disabled: false }).success).toBe(true);
    expect(UpdateUserRequestSchema.safeParse({ role: 'viewer' }).success).toBe(true);
    expect(ApiErrorSchema.safeParse({ error: { code: 'internal', message: 'Failed', requestId: 'req' } }).success).toBe(
      true,
    );
  });
});

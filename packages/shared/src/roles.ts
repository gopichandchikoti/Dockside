export const ROLES = ['viewer', 'operator', 'admin'] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  'hosts:read',
  'hosts:manage',
  'metrics:read',
  'containers:read',
  'containers:logs',
  'containers:restart',
  'checks:read',
  'checks:manage',
  'checks:run',
  'alerts:read',
  'alerts:acknowledge',
  'alerts:silence',
  'alerts:manage',
  'audit:read',
  'users:manage',
  'settings:read',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const VIEWER: readonly Permission[] = [
  'hosts:read',
  'metrics:read',
  'containers:read',
  'checks:read',
  'alerts:read',
  'settings:read',
];

const OPERATOR: readonly Permission[] = [
  ...VIEWER,
  'containers:logs',
  'containers:restart',
  'checks:run',
  'alerts:acknowledge',
  'alerts:silence',
];

/** The single permission matrix. The API enforces it; the UI only uses it to hide controls. */
export const PERMISSION_MATRIX: Record<Role, ReadonlySet<Permission>> = {
  viewer: new Set(VIEWER),
  operator: new Set(OPERATOR),
  admin: new Set(PERMISSIONS),
};

export function can(role: Role, permission: Permission): boolean {
  return PERMISSION_MATRIX[role].has(permission);
}

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

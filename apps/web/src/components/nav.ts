import type { Permission } from '@dockside/shared';
import type { IconName } from './Icon';

export interface NavItem {
  to: string;
  label: string;
  icon: IconName;
  permission: Permission;
  end?: boolean;
}

/** Primary navigation. Items hide when the role lacks the permission; the API enforces it regardless. */
export const NAV_ITEMS: readonly NavItem[] = [
  { to: '/', label: 'Overview', icon: 'overview', permission: 'hosts:read', end: true },
  { to: '/containers', label: 'Containers', icon: 'container', permission: 'containers:read' },
  { to: '/checks', label: 'Checks', icon: 'pulse', permission: 'checks:read' },
  { to: '/alerts', label: 'Alerts', icon: 'bell', permission: 'alerts:read' },
  { to: '/settings', label: 'Settings', icon: 'settings', permission: 'settings:read' },
];

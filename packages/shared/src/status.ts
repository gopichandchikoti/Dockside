import { z } from 'zod';

export const APP_VERSION = '1.0.0';

export const COMPONENT_STATES = ['ok', 'degraded', 'fail', 'unconfigured'] as const;

export const ComponentStatusSchema = z.object({
  id: z.string(),
  label: z.string(),
  state: z.enum(COMPONENT_STATES),
  detail: z.string().nullable(),
});

export const PlatformStatusSchema = z.object({
  version: z.string(),
  startedAt: z.string(),
  uptimeSeconds: z.number(),
  schemaVersion: z.number(),
  components: z.array(ComponentStatusSchema),
});

export type ComponentState = (typeof COMPONENT_STATES)[number];
export type ComponentStatus = z.infer<typeof ComponentStatusSchema>;
export type PlatformStatus = z.infer<typeof PlatformStatusSchema>;

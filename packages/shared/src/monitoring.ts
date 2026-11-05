import { z } from 'zod';

export const METRICS = {
  cpu_percent: { label: 'CPU utilization', unit: '%' },
  memory_percent: { label: 'Memory utilization', unit: '%' },
  memory_used_bytes: { label: 'Memory used', unit: 'B' },
  filesystem_percent: { label: 'Highest filesystem utilization', unit: '%' },
  network_rx_bytes_per_second: { label: 'Network received', unit: 'B/s' },
  network_tx_bytes_per_second: { label: 'Network sent', unit: 'B/s' },
  disk_read_bytes_per_second: { label: 'Disk read', unit: 'B/s' },
  disk_write_bytes_per_second: { label: 'Disk written', unit: 'B/s' },
  uptime_seconds: { label: 'Uptime', unit: 's' },
  load1: { label: 'Load average · 1 minute', unit: 'load' },
  temperature_celsius: { label: 'Highest exposed temperature', unit: '°C' },
} as const;
export const MetricSchema = z.enum(Object.keys(METRICS) as [keyof typeof METRICS, ...(keyof typeof METRICS)[]]);
export type Metric = z.infer<typeof MetricSchema>;
export const RangeSchema = z.enum(['1h', '6h', '24h', '7d', '30d']);
export type TimeRange = z.infer<typeof RangeSchema>;
export const RANGE_SECONDS: Record<TimeRange, number> = {
  '1h': 3600,
  '6h': 21600,
  '24h': 86400,
  '7d': 604800,
  '30d': 2592000,
};

export const HttpUrlSchema = z
  .string()
  .max(2048)
  .refine((value) => {
    try {
      const url = new URL(value);
      return (
        ['http:', 'https:'].includes(url.protocol) &&
        !url.username &&
        !url.password &&
        !url.hash &&
        !['169.254.169.254', 'metadata.google.internal', '100.100.100.200'].includes(url.hostname)
      );
    } catch {
      return false;
    }
  }, 'Use an HTTP(S) URL without credentials, fragments or a cloud metadata address.');

export const HostInputSchema = z
  .object({
    name: z.string().trim().min(1).max(64),
    metricsUrl: HttpUrlSchema,
    tags: z.array(z.string().trim().min(1).max(32)).max(12).default([]),
    isSample: z.boolean().default(false),
  })
  .strict();
export const FilesystemSchema = z.object({
  mount: z.string(),
  device: z.string(),
  type: z.string(),
  sizeBytes: z.number(),
  availableBytes: z.number(),
});
export const InterfaceSchema = z.object({
  name: z.string(),
  receivedBytesPerSecond: z.number().nullable(),
  sentBytesPerSecond: z.number().nullable(),
});
export const SensorSchema = z.object({ name: z.string(), celsius: z.number() });
export const HostSchema = z.object({
  id: z.string(),
  name: z.string(),
  metricsUrl: z.string(),
  tags: z.array(z.string()),
  isSample: z.boolean(),
  status: z.enum(['online', 'stale', 'offline']),
  lastSuccessAt: z.string().nullable(),
  lastError: z.string().nullable(),
  failures: z.number(),
  droppedSeries: z.number(),
  latest: z.record(z.string(), z.number().nullable()),
  filesystems: z.array(FilesystemSchema),
  interfaces: z.array(InterfaceSchema),
  sensors: z.array(SensorSchema),
  sparkline: z.array(z.number().nullable()),
});
export type Host = z.infer<typeof HostSchema>;
export type HostInput = z.infer<typeof HostInputSchema>;
export const HostsSchema = z.array(HostSchema);
export const SeriesSchema = z.object({
  metric: MetricSchema,
  unit: z.string(),
  cadenceSeconds: z.number(),
  source: z.string(),
  points: z.array(z.tuple([z.number(), z.number().nullable()])),
});
export type Series = z.infer<typeof SeriesSchema>;

export const CheckInputSchema = z
  .object({
    name: z.string().trim().min(1).max(64),
    kind: z.enum(['http', 'tcp']),
    target: z.string().min(1).max(2048),
    port: z.number().int().min(1).max(65535).nullable().default(null),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.kind === 'http' && !HttpUrlSchema.safeParse(v.target).success)
      ctx.addIssue({ code: 'custom', path: ['target'], message: 'Use a valid HTTP(S) URL.' });
    if (v.kind === 'tcp' && (!/^[a-zA-Z0-9.:[\]-]+$/.test(v.target) || v.port === null))
      ctx.addIssue({ code: 'custom', path: ['target'], message: 'TCP checks need a hostname and port.' });
  });
export const CheckResultSchema = z.object({
  ts: z.string(),
  ok: z.boolean(),
  latencyMs: z.number(),
  detail: z.string(),
});
export const CheckSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(['http', 'tcp']),
  target: z.string(),
  port: z.number().nullable(),
  history: z.array(CheckResultSchema),
});
export const ChecksSchema = z.array(CheckSchema);
export type ServiceCheck = z.infer<typeof CheckSchema>;
export type CheckInput = z.infer<typeof CheckInputSchema>;

export const ContainerSchema = z.object({
  id: z.string(),
  name: z.string(),
  image: z.string(),
  state: z.string(),
  status: z.string(),
  restartCount: z.number().nullable(),
  cpuPercent: z.number().nullable(),
  memoryBytes: z.number().nullable(),
  logsHidden: z.boolean(),
});
export const ContainersSchema = z.array(ContainerSchema);
export type Container = z.infer<typeof ContainerSchema>;
export const LogsSchema = z.object({ text: z.string(), nextBefore: z.string().nullable(), truncated: z.boolean() });

export const RuleInputSchema = z
  .object({
    name: z.string().trim().min(1).max(64),
    hostId: z.uuid(),
    metric: MetricSchema,
    operator: z.enum(['gt', 'lt']),
    threshold: z.number().finite(),
    durationSeconds: z.number().int().min(0).max(86400),
    enabled: z.boolean().default(true),
  })
  .strict();
export const AlertStateSchema = z.enum(['ok', 'pending', 'firing', 'acknowledged', 'silenced']);
export const RuleSchema = RuleInputSchema.extend({
  id: z.string(),
  state: AlertStateSchema,
  pendingSince: z.number().nullable(),
  silencedUntil: z.number().nullable(),
  value: z.number().nullable(),
});
export const RulesSchema = z.array(RuleSchema);
export type AlertRule = z.infer<typeof RuleSchema>;
export type RuleInput = z.infer<typeof RuleInputSchema>;
export const EventSchema = z.object({
  id: z.number(),
  ruleId: z.string(),
  ts: z.string(),
  state: z.string(),
  message: z.string(),
});
export const EventsSchema = z.array(EventSchema);
export type AlertEvent = z.infer<typeof EventSchema>;
export const ChannelInputSchema = z
  .object({
    name: z.string().trim().min(1).max(64),
    kind: z.enum(['webhook', 'ntfy']),
    url: HttpUrlSchema,
    token: z.string().max(2048).default(''),
  })
  .strict();
export const ChannelSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(['webhook', 'ntfy']),
  url: z.literal('[encrypted]'),
  token: z.literal('[masked]'),
  lastDelivery: z.string().nullable(),
});
export const ChannelsSchema = z.array(ChannelSchema);
export type Channel = z.infer<typeof ChannelSchema>;
export type ChannelInput = z.infer<typeof ChannelInputSchema>;
export const AuditSchema = z.array(
  z.object({
    id: z.number(),
    ts: z.string(),
    actorName: z.string().nullable(),
    action: z.string(),
    outcome: z.enum(['success', 'denied', 'failure']),
    targetId: z.string().nullable(),
  }),
);

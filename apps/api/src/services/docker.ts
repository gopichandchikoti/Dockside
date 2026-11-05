import type { Container } from '@dockside/shared';
import { z, type ZodType } from 'zod';
import type { AppConfig } from '../config';
import { containerCpu, demultiplexLogs, previousLogCursor } from '../domain/docker';
import { errors } from '../errors';
import { boundedRequest } from './http';

const ListedSchema = z.object({
  Id: z.string().regex(/^[a-f0-9]{12,64}$/),
  Names: z.array(z.string()),
  Image: z.string(),
  State: z.string(),
  Status: z.string(),
  Labels: z.record(z.string(), z.string()).nullable(),
});
const CpuSchema = z.object({
  cpu_usage: z.object({ total_usage: z.number().optional() }).optional(),
  system_cpu_usage: z.number().optional(),
  online_cpus: z.number().optional(),
});
const StatsSchema = z.object({
  cpu_stats: CpuSchema.optional(),
  precpu_stats: CpuSchema.optional(),
  memory_stats: z.object({ usage: z.number().optional() }).optional(),
});
const InspectSchema = z.object({
  RestartCount: z.number(),
  Config: z
    .object({
      Labels: z.record(z.string(), z.string()).nullable().optional(),
    })
    .optional(),
});
type Listed = z.infer<typeof ListedSchema>;
const isHidden = (labels: Record<string, string> | null | undefined) => labels?.['dockside.hide'] === 'true';
function decodePayload<T>(schema: ZodType<T>, body: Buffer): T | null {
  try {
    const input: unknown = JSON.parse(body.toString('utf8'));
    const parsed = schema.safeParse(input);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export class DockerService {
  constructor(private readonly config: AppConfig) {}
  private endpoint(path: string): string {
    if (!this.config.dockerEndpoint)
      throw errors.disabled('Docker is not configured. Set DOCKER_ENDPOINT to a private proxy.');
    return `${this.config.dockerEndpoint.replace(/\/$/, '')}${path}`;
  }
  private async request(path: string, method = 'GET'): Promise<Buffer> {
    try {
      const response = await boundedRequest(this.endpoint(path), { method });
      if (response.status < 200 || response.status >= 300) throw new Error('Docker rejected the request.');
      return response.body;
    } catch (error) {
      if (!this.config.dockerEndpoint) throw error;
      throw errors.upstream('Docker is unreachable or the proxy rejected the request.');
    }
  }
  private async rawList(): Promise<Listed[]> {
    const data = decodePayload(z.array(ListedSchema).max(1000), await this.request('/containers/json?all=true'));
    if (!data) throw errors.upstream('Docker returned an invalid container list.');
    return data.filter((c) => !isHidden(c.Labels));
  }
  async list(): Promise<Container[]> {
    const listed = await this.rawList();
    return Promise.all(listed.slice(0, 100).map((c) => this.details(c)));
  }
  private async details(c: Listed): Promise<Container> {
    const base: Container = {
      id: c.Id,
      name: c.Names[0]?.replace(/^\//, '') ?? c.Id.slice(0, 12),
      image: c.Image,
      state: c.State,
      status: c.Status,
      cpuPercent: null,
      memoryBytes: null,
      restartCount: null,
      logsHidden: false,
    };
    const [inspect, stats] = await Promise.allSettled([
      this.request(`/containers/${c.Id}/json`),
      this.request(`/containers/${c.Id}/stats?stream=false&one-shot=true`),
    ]);
    if (inspect.status === 'fulfilled') {
      const data = decodePayload(InspectSchema, inspect.value);
      if (data) base.restartCount = data.RestartCount;
    }
    if (stats.status === 'fulfilled') {
      const data = decodePayload(StatsSchema, stats.value);
      if (data) {
        base.cpuPercent = containerCpu(data);
        base.memoryBytes = data.memory_stats?.usage ?? null;
      }
    }
    return base;
  }
  private async visible(id: string): Promise<void> {
    if (!/^[a-f0-9]{12,64}$/.test(id)) throw errors.notFound('Container');
    const found = (await this.rawList()).some((c) => c.Id === id);
    if (!found) throw errors.notFound('Container');
    const inspect = decodePayload(InspectSchema, await this.request(`/containers/${id}/json`));
    if (!inspect) throw errors.upstream('Docker returned invalid container metadata.');
    if (isHidden(inspect.Config?.Labels)) throw errors.notFound('Container');
  }
  async logs(id: string, before?: string): Promise<{ text: string; nextBefore: string | null; truncated: boolean }> {
    await this.visible(id);
    const query = new URLSearchParams({
      stdout: 'true',
      stderr: 'true',
      timestamps: 'true',
      tail: String(this.config.logTailMax),
      follow: 'false',
    });
    if (before) query.set('until', before);
    const raw = demultiplexLogs(await this.request(`/containers/${id}/logs?${query.toString()}`));
    const lines = raw.trimEnd().split('\n');
    const text = lines.slice(-this.config.logTailMax).join('\n');
    return {
      text,
      nextBefore: lines.length >= this.config.logTailMax ? previousLogCursor(text) : null,
      truncated: lines.length >= this.config.logTailMax,
    };
  }
  async restart(id: string): Promise<void> {
    if (!this.config.containerActionsEnabled) throw errors.disabled('Container restart actions are disabled.');
    await this.visible(id);
    await this.request(`/containers/${id}/restart?t=10`, 'POST');
  }
}

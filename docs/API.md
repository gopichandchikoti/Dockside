# API contracts and permissions

All data routes are under `/api/v1`. Bodies are JSON (64 KiB maximum). Successful reads return the shared Zod DTO
directly; errors use `{error:{code,message,requestId,details?}}`. UTC ISO strings are used for events and sessions.
Host/rule/check/user IDs are UUIDs; Docker IDs are 12–64 lowercase hex characters, checked against the visible list.
Every enabled user sees the same fleet. There is no cross-tenant or host-owner isolation contract.

## Authentication

`GET /session` returns setup state, user or null, CSRF token or null and server feature flags.
`POST /setup` requires `{setupToken,username,password}` and only works with zero users.
`POST /login` requires `{username,password}`. `POST /logout` ends the session.
`POST /me/password` requires `{currentPassword,newPassword}` and revokes other sessions.

Cookie: HttpOnly, SameSite Strict, path `/`; with a TLS proxy it becomes Secure `__Host-dockside`.
Authenticated non-safe requests require `X-CSRF-Token`. Sessions expire after 2h idle or 12h absolute.
Global rate limit is 600/min; auth routes are 10/min. Five password failures cause a five-minute account lock.
No password hash, session ID hash, encryption key or channel secret is returned to clients.

## Routes

| Method and path                    | Request / response                                                           | Permission         |
| ---------------------------------- | ---------------------------------------------------------------------------- | ------------------ |
| GET /hosts, /hosts/:id             | Host status, metadata, latest readings, tags and sparkline                   | hosts:read         |
| POST /hosts                        | `{name,metricsUrl,tags?,isSample?}` → 201 Host; initial collection attempted | hosts:manage       |
| PATCH /hosts/:id                   | Full host configuration as above; resets current baseline                    | hosts:manage       |
| DELETE /hosts/:id                  | 204; cascades measurements/rules                                             | hosts:manage       |
| GET /hosts/:id/metrics             | `metric=<shared metric key>&range=1h\|6h\|24h\|7d\|30d`                      | metrics:read       |
| GET /containers                    | Up to 100 enriched visible container DTOs                                    | containers:read    |
| GET /containers/:id/logs           | Optional `before=<epoch seconds with 9 fractional digits>`                   | containers:logs    |
| POST /containers/:id/restart       | `{confirm:true}`; separately enabled on server/proxy                         | containers:restart |
| GET /checks                        | Configurations with last 100 results                                         | checks:read        |
| POST /checks                       | `{name,kind:http\|tcp,target,port?}` → 201                                   | checks:manage      |
| DELETE /checks/:id                 | 204; cascades history                                                        | checks:manage      |
| POST /checks/:id/run               | Updated check/history                                                        | checks:run         |
| GET /alerts/rules                  | Rules and current state/value                                                | alerts:read        |
| POST /alerts/rules                 | `{name,hostId,metric,operator:gt\|lt,threshold,durationSeconds,enabled?}`    | alerts:manage      |
| PATCH /alerts/rules/:id            | Full configuration; resets evaluation state                                  | alerts:manage      |
| DELETE /alerts/rules/:id           | 204; cascades events                                                         | alerts:manage      |
| POST /alerts/rules/:id/acknowledge | Only firing/already acknowledged rules                                       | alerts:acknowledge |
| POST /alerts/rules/:id/silence     | `{seconds:60..604800}`                                                       | alerts:silence     |
| GET /alerts/events                 | Last 100; optional `before=<positive integer ID>`                            | alerts:read        |
| GET, POST /alerts/channels         | Create `{name,kind:webhook\|ntfy,url,token?}`; reads mask destination/token  | alerts:manage      |
| DELETE /alerts/channels/:id        | 204                                                                          | alerts:manage      |
| GET, POST /users                   | Create `{username,password,role}`; summaries omit hashes                     | users:manage       |
| PATCH /users/:id                   | `{role?,disabled?}`, not empty; revokes sessions                             | users:manage       |
| GET /audit                         | Last 100; optional `before=<positive integer ID>`                            | audit:read         |
| GET /status                        | Authenticated version/schema/component details                               | session            |

`/healthz` and `/readyz` are public and do not include private component details. Readiness status can be degraded
without terminating the process. The UI root and self-hosted static assets are public; private data remains guarded.

## Time-series and logs

Metrics return `{metric,unit,cadenceSeconds,source,points:[[epochMs,value|null],...]}`. Raw cadence follows the
configured scrape interval; 7/30-day ranges use five-minute means. Missing buckets stay null. Source includes a
sample marker when the host is flagged. Rates skip initial samples, resets and gaps over three scrape intervals.
Explicit exporter timestamps must be within that freshness window; ingestion timestamps own storage cadence.

Log pages return `{text,nextBefore:string|null,truncated:boolean}`. Both Docker multiplexed frames and plain TTY
output are supported. Responses are limited to 5 MiB and capped again to `LOG_TAIL_MAX` lines. Cursor generation
subtracts one nanosecond from the oldest timestamp. Output is rendered as text, never trusted HTML.

## Permission matrix

| Ability                                                   | Viewer | Operator | Admin |
| --------------------------------------------------------- | ------ | -------- | ----- |
| Read hosts, metrics, containers, checks, alerts, settings | Yes    | Yes      | Yes   |
| Read logs, request enabled restart, run checks            | No     | Yes      | Yes   |
| Acknowledge and silence alerts                            | No     | Yes      | Yes   |
| Manage hosts/checks/rules/channels/users, read audit      | No     | No       | Yes   |

The authoritative full matrix is `packages/shared/src/roles.ts`. API guards audit forbidden requests; CSRF denials,
log access, restart and configuration changes are audited. UI hiding is only a convenience.

## Failure and consistency semantics

Writes validate all input. Mutations preserve drafts on rejection; there are no fake-success fallbacks.
No idempotency-key API is offered: retrying POST creates can create duplicate named configurations. PATCH is a full
configuration replacement and last writer wins. Updates changing a metric source reset current state but retain
its existing host history. Database multi-row changes and migrations use transactions; host/check deletes cascade.
Remote side effects such as Docker restart and notifications cannot be transactionally rolled back with SQLite.
Notification retries may therefore result in duplicate provider deliveries; consumers should treat them accordingly.

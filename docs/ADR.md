# Decisions

## ADR-001 · Continue the existing TypeScript monorepo

React 19, Vite, Fastify 5, Zod and React Query already own the working foundation. Continue these boundaries.
Server validation and shared contracts prevent the UI from becoming the security boundary. SQLite WAL fits a
small private console without a second database service. PostgreSQL is an unimplemented optional alternative.
Exit strategy: preserve wire contracts while replacing service persistence adapters and adding migrations.

Authentication, sessions and CSRF were pulled forward into milestone 1 so no data endpoint ships unauthenticated.
Milestone 4 therefore completes administration, permissions, audit and alerts. The owner explicitly requested
that changes remain uncommitted; the spec's Git milestone gates are waived for this working tree. Nothing is pushed.

## ADR-002 · A harbour office, with light and dark shifts

The chosen direction uses warm paper, harbour ink, tide blue controls, buoy orange identity, Instrument Sans,
JetBrains Mono, original stroke icons, ruled bands and tables. Status always has a glyph or word in addition to
colour. The rejected direction was a dense, dark-only NOC wall with neon decoration: less suitable for occasional
household operators, daylight use and narrow screens. No marketing landing page precedes the actual console.

Primary personas: server owner configuring a fleet, operator investigating a failure, and read-only household
viewer. Main flow: overview → host → metrics/checks/container logs → incident acknowledgement. Administrative
links sit in Settings. Five mobile destinations stay usable at 320px. Forms retain rejected drafts; server state
comes from React Query; motion/theme/refresh preferences belong to the browser.

### Reference matrix

The handoff described earlier text fetches. These pages were rechecked on **2026-11-04 as extracted text**, not
visual browser renders. These observations did not constitute copying a design or importing reference code.

| URL                                                | Observed pattern and fit                                                         | Strength / weakness                                                                             | License and accessibility                                                                                  | Performance decision                           |
| -------------------------------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| [Realtime Colors](https://www.realtimecolors.com/) | Previews a palette and typography in context; useful as a palette-testing method | Realistic colour roles; generic example sections do not fit the operational screen map          | No code copied; prior handoff recorded restrictive source terms. Actual app contrast is checked separately | Method only; no runtime dependency             |
| [Motion](https://motion.dev/)                      | Layout/gesture animation APIs                                                    | Useful for complex transitions; adds a dependency without a current job here                    | Landing page says free/open source; reduced-motion handling is implemented locally and tested              | Native CSS is sufficient; not installed        |
| [21st.dev](https://21st.dev/)                      | Copy-in catalogue of components/themes                                           | Broad state/control inspiration; component-specific provenance would need checking before reuse | No component code/assets adopted; no blanket catalogue license assumed                                     | Original components preserve the current stack |
| [Recent](https://recent.design/)                   | Categorized, image-led design gallery                                            | General rhythm/typography inspiration; not an operational monitoring reference                  | Gallery screenshots remain their owners' material; none copied                                             | No runtime dependency or decorative media      |

## ADR-003 · Network boundaries and read-only Docker defaults

Administrator-selected LAN URLs are a product requirement. HTTP adapters allow private addresses while rejecting
credentials, obvious cloud metadata destinations and redirects, with five-second deadlines and byte caps. They
do not provide DNS-rebinding isolation; use host egress policy and trusted administrators. No public unauthenticated
URL fetcher is exposed. The custom HAProxy policy restricts the internal Docker socket to the exact read paths
used by this application and optional restart. It is narrower than granting every container POST operation.

Node exporter shares host network/PID namespaces for real host interface counters. Its listener is bound to a
private Docker bridge address. A bridge-container exporter would otherwise report its own network namespace.
Custom/rootless Docker networking needs explicit deployment adjustment and is not verified here.

## ADR-004 · Quality limits and dependencies

Keep the inherited 70-line maximum for functions as a documented exception to the rulebook's **50-line target**:
declarative JSX can contain more markup without additional business logic. Large screen/table blocks were split
into focused components; complexity stays at 10, nesting at 3 and cognitive complexity at 15. Tests are exempt
from function/file length limits, while type/security/complexity checks remain enabled. No broad lint suppression
was added. Coverage thresholds were raised to 90% in all four metrics, rather than lowering the gate.

Security review upgraded `@fastify/static` to 10.1.8 and Vitest/coverage to 4.1.12. Root overrides pin glob 14.0.2
and minimatch 11.0.1 to remove audited transitive advisories. npm 10 initially failed while resolving the major
test-tool upgrade; npm 11.6.2 completed that transition. Subsequent ordinary `npm ci` is the reproducibility gate.
The patched static plugin uses Fastify replies in its header callback; packaged-serving tests cover that change.

## ADR-005 · Missing data and alert semantics

Store derived counter rates at ingest. Initial samples, resets, old exposition timestamps and gaps do not produce
invented rates. Filesystems are capacity metadata only; pseudo/sensitive mounts are excluded before persistence.
Charts retain null gaps and offer keyboard/table inspection. Notification configuration is encrypted at rest.
Missing samples never recover a firing incident. An expired silence with no fresh data stays visibly unresolved
until data returns; pending duration restarts after a gap. Notifications use bounded in-process concurrency,
timeouts and three attempts; they are not a durable delivery queue.

Primary protocol references checked during continuation:
[Prometheus exposition](https://prometheus.io/docs/instrumenting/exposition_formats/),
[Docker Engine API](https://docs.docker.com/reference/api/engine/version/v1.47/),
[Docker socket proxy rationale](https://github.com/Tecnativa/docker-socket-proxy).

# Feature matrix

| Feature                                                                 | Implementation                        | Verification / boundary                                                     |
| ----------------------------------------------------------------------- | ------------------------------------- | --------------------------------------------------------------------------- |
| First-run setup, login/logout, idle/absolute sessions, CSRF, lockout    | Implemented                           | API tests and packaged Edge journey                                         |
| Roles, last enabled admin, user administration and audit                | Implemented                           | Permission matrix by data route; real SQLite integration; UI tests          |
| CPU, memory, filesystem usage, uptime, load, network/disk throughput    | Implemented                           | Parser/rate/gap/reset/retention tests; sample browser journey               |
| Hosts, tags, filters, status, refresh and metadata                      | Implemented                           | Persistence, offline/reconnect, limits and UI workflow tests                |
| Accessible charts, source/cadence, null gaps and table alternative      | Implemented                           | Keyboard/unit/browser tests                                                 |
| Temperatures                                                            | Conditional on exporter               | Missing sensors explicitly explained; no invented sensor readings           |
| Raw and 5-minute metric retention                                       | Implemented                           | Default 3/90 days; integration-tested deletion                              |
| Docker list, CPU/RAM, restart counts                                    | Implemented for one configured engine | Local protocol fixtures; real Engine not tested                             |
| Logs, pagination, opt-out label and permissions                         | Implemented                           | Bounded reads and UI polling; no continuous SSE/WebSocket log stream        |
| Optional restart                                                        | Off by default; guarded and audited   | Disabled and enabled confirmation tests; real restart not executed          |
| HTTP/TCP checks and history/run-now                                     | Implemented                           | Real local HTTP/TCP sockets; history and UI tests                           |
| Host-scoped alerts, duration, ack, silence and recovery                 | Implemented                           | Fake-clock transitions, missing data and UI tests                           |
| Encrypted webhook/ntfy destinations, masked API values, timeout/retry   | Implemented                           | Local delivery/retry tests; real providers not tested                       |
| Light/dark, keyboard, reduced motion, small-screen layout               | Implemented                           | Automated Edge/axe and screenshots; physical devices/screen reader pending  |
| Labelled sample exporter and fake Docker API                            | Implemented                           | Isolated sample mode; never production measurement evidence                 |
| Docker Compose, non-root image, internal restricted proxy, optional TLS | Authored                              | Structural checks only until Linux/Docker verification                      |
| CI quality gates and artifact checks                                    | Authored                              | Workflow not executed on GitHub                                             |
| Release API bundle, web assets, manifest/hash and smoke script          | Implemented                           | File/source agreement, bootstrap, auth, CSRF and persistence across restart |
| PostgreSQL                                                              | Not implemented, optional             | SQLite-only v1                                                              |
| Multiple Docker endpoints / multi-tenant host isolation                 | Not implemented                       | One shared fleet and one Docker endpoint per console                        |
| Durable notification queue / guaranteed delivery                        | Not implemented                       | In-process, bounded, best-effort retries                                    |
| Telemetry / third-party client calls                                    | None enabled                          | Self-hosted fonts/assets; no analytics account                              |

# Known limitations

- Docker Compose startup on a clean Linux VM and the optional Caddy TLS profile are not verified here. Node
  exporter binds to `NODE_EXPORTER_BIND_ADDRESS` (default Docker bridge 172.17.0.1). Adjust it for custom networks.
  Rootless Docker and Windows Docker Desktop host metric semantics are outside the verified deployment target.
- CI is authored but has not run remotely. Local checks are evidence only for this workstation and toolchain.
- SQLite is the only persistence adapter. Node 22.13.1 emits an experimental SQLite warning. There is no HA mode,
  cluster coordination or optional PostgreSQL adapter. Back up the database and encryption key together.
- This is one private fleet shared by all users. It is not a multi-tenant service. Docker inspection uses one
  configured engine. UI listing enriches at most 100 containers; the client rejects lists over 1000 records.
- Metric input is the node_exporter-style Prometheus text format, not native histograms, remote-write or an
  arbitrary PromQL engine. There are 256-family/4096-series caps per scrape and a 5 MiB response cap. Dropped
  series are visible. Each host/check is limited to five seconds; large fleets can stretch the collection cycle.
- Raw samples default to three days. A 24-hour chart can therefore become partly empty if configured raw retention
  is shorter. Long ranges use five-minute means, including partial buckets, rather than raw peaks/min/max bands.
- Notifications are best effort, with up to 20 concurrent deliveries and three attempts per delivery. Overflow
  drops a notification and records channel status. There is no durable queue, provider receipt or delivery SLA.
- Expired silences without fresh measurements remain unresolved until data returns. A stale host does not
  generate a fabricated recovery. Use an external availability monitor for the Dockside process itself.
- Logs are bounded, paginated snapshots with optional refresh, not a continuous stream. Extremely long output
  exceeding the byte cap fails explicitly. Containers can hide themselves with `dockside.hide=true`; application
  log content may still contain secrets, so log permissions are restricted.
- Administrators may target private network addresses. URL checks are not DNS-rebinding isolation. Restrict
  outbound traffic and administrator access at the host/network boundary.
- Browser screenshots and axe checks use installed desktop Edge and emulated widths. They do not establish
  physical mobile, Firefox/Safari, assistive-technology or representative-device performance compliance.
- Edge emitted blocked `data:font/woff2` attempts under the strict `font-src 'self'` policy during automated QA.
  These are recorded separately in browser evidence; app fonts remain local and the CSP is not relaxed. Their
  originating browser/tool component has not been established. Do not describe the entire console as error-free.
- No SonarQube server, live penetration test, real notification-provider delivery or production backup/restore
  drill has run. Dependency/license metadata checks are not a substitute for those deployment reviews.

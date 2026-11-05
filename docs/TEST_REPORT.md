# Verification report

Verified locally on **2026-11-05**, Windows x64, Node 22.13.1 and installed Edge 156.
This is a locally verified release candidate. Clean Linux deployment and remote CI acceptance remain open.

## Completed

The authenticated console, host collector/history/charts, Docker inspection and bounded logs, checks, alerts,
notifications, users, audit and settings are implemented. Compose/TLS recipes, CI, operating documentation,
bootstrap, sample services, production builds and archive/hash/smoke tooling are supplied. See the feature matrix
for optional or limited capabilities. Changes remain uncommitted at the owner's explicit request.

## Tested

| Check                               | Actual result                                                                                                                 | Evidence                                             |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| npm ci                              | Pass; fresh isolated source copy installed successfully                                                                       | ../qa/clean-install.log                              |
| npm run verify                      | Pass: format, lint, strict types, coverage, web and API builds                                                                | ../qa/verify.log; ../qa/clean-verify.log             |
| Automated unit/integration/UI tests | 136 passed: shared 8, API 68, web 60                                                                                          | Verification logs and workspace coverage directories |
| Packaged Edge end-to-end            | 2 tests passed, including core journey and responsive/accessibility matrix                                                    | ../qa/e2e.log                                        |
| axe WCAG scans                      | 24 scans, zero violations; 6 screens x 2 themes x 2 widths                                                                    | ../qa/browser-evidence.json                          |
| Bootstrap                           | Created a private environment; a second invocation preserved its exact file hash                                              | Observed in isolated source copy                     |
| Dependency audit                    | Zero vulnerabilities in the final installed dependency graph                                                                  | ../qa/dependency-audit-final.json                    |
| Compose structure                   | Seven static checks passed; this does not execute Compose                                                                     | ../qa/deploy-static.json                             |
| Release archive                     | Per-file SHA-256 verified after extraction; packaged API became ready, UI/assets served, anonymous hosts request returned 401 | ../qa/release-smoke.json; ../release/latest.json     |

The final archive smoke test also verifies file sizes and agreement with the current build, documentation and
included scripts. It runs the extracted bootstrap twice without changing secrets, creates an administrator,
rejects a mutation without CSRF, saves and successfully runs an HTTP check, and verifies logout revokes access.
After a server restart, the administrator can sign in and the check configuration and successful history remain.
All records live in an isolated temporary database. See `qa/release-smoke.json` for the tested archive/hash and
`qa/clean-source-comparison.json` for comparison of the source copy used for clean verification.

Coverage is workspace-wide; thresholds stay at 90% for all four metrics. It is not a claim that every file or
branch is covered. The authentication permission guard has 95% branch coverage; the shared permission matrix
has full tested branch coverage.

| Workspace | Statements | Branches | Functions |  Lines |
| --------- | ---------: | -------: | --------: | -----: |
| Shared    |     93.84% |     100% |      100% | 93.84% |
| API       |     97.42% |   90.35% |    98.71% | 99.20% |
| Web       |     97.73% |   92.21% |    97.32% | 99.11% |

### Automated behavior matrix

| Case                                                                | Device/browser                   | Steps                                                                    | Expected                                          | Actual                                         | Pass/Fail | Evidence                                      |
| ------------------------------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------- | ---------------------------------------------- | --------- | --------------------------------------------- |
| First run, login and relaunch                                       | Windows / Edge                   | Create administrator, sign out, sign in                                  | Durable account and protected session             | Journey completed                              | Pass      | e2e.log; setup-desktop.png; login-desktop.png |
| Host and chart workflow                                             | Windows / Edge                   | Add sample exporter, open host, keyboard cursor, table view              | Valid host and accessible chart                   | Completed                                      | Pass      | e2e.log; host-*.png                           |
| Parser, gaps, reset, stale input, retention, reconnect, cardinality | Node / real SQLite               | Ingest normal and failure fixtures, advance clocks, prune                | Correct rates/nulls/status; bounded series        | Assertions passed                              | Pass      | API metrics/operations/hardening tests        |
| Authorization, ID checks, CSRF and audit                            | Node / real SQLite               | Anonymous/viewer/operator/admin requests by route                        | Deliberate 401/403, guarded mutations and audit   | Assertions passed                              | Pass      | API auth and permission tests                 |
| Containers, hidden labels and log boundaries                        | Node protocol fixtures / Edge    | List, inspect, read logs; attempt disabled restart                       | Hidden/log role boundaries; no restart by default | Assertions and journey passed                  | Pass      | API operations tests; e2e.log                 |
| Enabled restart confirmation                                        | Node protocol fixture / UI tests | Enable test config, reject false confirmation, confirm true              | Explicit confirmation and audit                   | Assertions passed; no real container restarted | Pass      | API hardening and web access-state tests      |
| HTTP/TCP checks and history                                         | Node / real local sockets; Edge  | Run successful and failed targets, inspect history                       | Durable success/failure and latency               | Passed                                         | Pass      | API operations tests; e2e.log                 |
| Alert trigger, recovery, missing data and silence                   | Node fake clock / SQLite; Edge   | Breach threshold, wait, acknowledge, lose/recover samples                | Correct state/events without invented recovery    | Passed                                         | Pass      | API hardening/operations; e2e.log             |
| Channel encryption and failure/retry                                | Node local fixture               | Save secret, evaluate, reject delivery three times                       | Masked reads, encrypted storage, bounded failure  | Passed                                         | Pass      | API hardening/operations tests                |
| Forms, permission controls and rejected drafts                      | jsdom / RTL                      | Create/edit/delete; reject API writes                                    | Errors visible; drafts retained; correct controls | Passed                                         | Pass      | Web screen/access/recovery tests              |
| Responsive and accessibility                                        | Edge at 320x800 and 1440x1000    | Scan overview, host, containers, checks, alerts, settings in both themes | No page overflow or axe violations                | 24 scans passed                                | Pass      | browser-evidence.json; 24 screen images       |
| Reduced motion and text scaling                                     | Edge / 320px                     | Reduce motion, inspect computed duration, set 200% root text             | Near-zero transitions; usable page reflow         | Passed                                         | Pass      | e2e.log; text-scaling-320.png                 |
| Offline and session recovery                                        | jsdom / RTL                      | Repeated network failures, restore service, expire session               | Notice, retry, preserved data and login route     | Passed                                         | Pass      | Web flow/recovery tests                       |

There are 29 captured PNGs under `qa/`. Sample data is visibly labelled. These captures do not establish real
Linux sensor readings or physical-device performance. The agent inspected desktop/mobile and text-scaling
screenshots; no human interactive manual-device test is claimed.

### Measured performance and console observations

One final local Edge navigation measured DOMContentLoaded at **29.1 ms** and load at **30.4 ms**. The navigation
entry's transferSize was 1,102 bytes (the HTML response only, not total app download). The production build reported
approximately 456.22 kB JavaScript / 139.05 kB gzip and 20.60 kB CSS / 6.90 kB gzip. These are workstation observations,
not LCP/INP/CLS p75, representative mobile hardware, a load test or an SLA.

The final browser run recorded 18 blocked data-font CSP messages and zero other console/runtime errors. Their
originating browser/tool component is unestablished. The strict self-only font policy was retained; the messages
remain in evidence rather than being called a clean console. Node's experimental SQLite warning and Rollup's
upstream Zod comment-annotation warnings also remain visible in build/test logs.

### Architecture documentation

The onboarding documentation is consolidated in the root [ARCHITECTURE.md](../ARCHITECTURE.md), linked from the
README, with the threat model preserved in that guide. Mermaid syntax and local file/heading links were checked
for the README and the single architecture guide. This establishes syntax and link validity, not a claim of
browser rendering in every Markdown viewer. See `qa/architecture-diagrams.json` and `qa/architecture-links.json`.
The sample preview also served the UI and readiness endpoint and showed first-run setup while private data
remained protected by a 401 response. Documentation and preview checks did not require rerunning unchanged
application unit tests.

## Not tested

Physical phones/tablets, Firefox/Safari, screen-reader use, live Docker Engine actions, real Linux exporters and
sensors, real ntfy/webhook providers, production load, backup/restore drills, SonarQube and live penetration testing.
License metadata/text was inventoried for 93 installed production packages; abstract-logging supplies MIT metadata
and a license reference without a top-level license text file in its published package. This is not a legal audit.

## Blocked acceptance gates

Docker CLI is absent on this workstation. Commands requiring a clean Linux VM remain unexecuted:

```sh
docker compose config --quiet
docker compose up --build -d
```

Caddy certificates/TLS and real Linux socket-group/network behavior are also unverified. The GitHub workflow is
authored but has not run remotely. Local manifests and structural YAML checks do not establish those passes.

## Known limitations

See [known limitations](KNOWN_LIMITATIONS.md): SQLite-only storage, one shared fleet/engine, best-effort in-process
notifications, bounded snapshot logs, exporter/series limits and administrator-controlled LAN egress. Those
boundaries are explicit rather than silently omitted. Local Git commits and pushes were intentionally not made.

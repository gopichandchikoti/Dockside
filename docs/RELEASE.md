# Release and operation

Version: **1.0.0**. Treat this as a locally verified release candidate until the clean Linux Compose and remote CI
gates have run. No commit, push or live deployment is part of this delivery.

## Build and artifacts

```sh
npm ci
npm run verify
npm run e2e
node scripts/check-deploy.mjs
npm run release
node scripts/smoke-release.mjs
```

Production outputs are exactly `apps/web/dist/` and `apps/api/dist/server.mjs`.
The release script creates `release/dockside-1.0.0-<UTC timestamp>.tar.gz`, a sibling `.sha256` file, and
`release/latest.json` with the **exact archive path, byte length, SHA-256, version and staged-directory path**.
The archive includes its own per-file `manifest.json`. The smoke script extracts that archive
into an isolated temporary directory, verifies every file size and hash, and compares the included build,
documentation and scripts to the current repository. A stale archive fails this comparison; rebuild and repackage
before rerunning it. The smoke command runs from the source repository.

The extracted bootstrap must create secrets and preserve them on a second run. The packaged server must serve
the UI/assets, reject anonymous data reads and mutations without CSRF, create an administrator, save and run an
HTTP check, and revoke a logged-out session. After restarting the same isolated server, login and saved check
history must still work. Readiness is checked by HTTP, not inferred from logs. The smoke test creates no accounts
or records in the real console database.

Extract with `tar -xzf <archive> -C <empty-directory>`. From that directory run `npm run bootstrap` and `npm start`.
The bundled release needs Node; it does not need `npm install` or a separate frontend server. Read the generated
setup token from `.env`. Set `WEB_DIST` if moving assets outside the included layout. This is a web/API bundle.

## Fresh source checkout checklist

1. Use Node >=22.13.0 and an npm version compatible with the committed-format lockfile.
2. Run `npm ci` from the root. Do not regenerate the lockfile or mix package managers.
3. Run bootstrap; privately inspect `.env`, not terminal logs, for setup values.
4. Run verify and E2E; make sure sample ports 8181/9187/9387 are free.
5. For real hosts, configure private exporter URLs and the optional restricted Docker endpoint.
6. On Linux, validate Compose and confirm real readings against the host before relying on alerts.

## Linux Compose

Prerequisites: rootful Docker/Compose, a local Linux Docker socket, a private bridge interface and a backup plan.
Set `DOCKER_GID` to the actual socket group (`stat -c '%g' /var/run/docker.sock`). The unprivileged proxy requires
that supplemental group. Set `NODE_EXPORTER_BIND_ADDRESS` to the private default Docker bridge address; the
default is 172.17.0.1. The API reaches it through `host.docker.internal:host-gateway`. Do not use a public bind.

```sh
npm run bootstrap
docker compose config --quiet
docker compose up --build -d
docker compose ps
curl --fail http://127.0.0.1:8080/readyz
```

The API runs as non-root with a read-only root filesystem and a writable data volume. Only the proxy mounts the
socket, read-only, on an internal network with no host port. A read-only socket mount alone cannot limit Engine
operations; `deploy/docker-proxy.cfg` is the actual method/path policy.

For TLS with Caddy, set `DOCKSIDE_DOMAIN`, `BEHIND_TLS_PROXY=true` and `TRUSTED_PROXY_HOPS=1` in `.env`, then:

```sh
docker compose --profile tls up --build -d
```

Use the HTTPS hostname thereafter: Secure cookies intentionally do not work through the direct HTTP console.
Point DNS at the server and allow the certificate challenge ports as appropriate. A VPN is another way to restrict
who can reach the console; keep TLS for remote browser access. Do not expose an exporter or Docker proxy publicly.

Restart requires both `CONTAINER_ACTIONS_ENABLED=true` and `DOCKER_PROXY_ALLOW_RESTART=1`, a redeployment,
operator/admin permission, and explicit UI confirmation. All other container mutations remain denied by the proxy.
To restore read-only operation, turn both flags off and redeploy.

## Backup, update, rollback and deletion

Stop the API before copying the SQLite database and any WAL/SHM sidecars. Keep the exact encryption key in a
separate private backup. Also preserve deployment configuration and a copy of the current release manifest.
Restrict backup access to administrators; there is no browser backup-download endpoint.

For updates, take a backup, stop the API, replace the bundle/image, then start and check `/readyz` and authenticated
status. Migrations are transactional and refuse unknown future schema IDs. An older application must use its
matching restored backup; there is no automatic down migration. Reverting code alone is not a database rollback.
Test restore on a separate instance before relying on the backup process.

Host deletion removes its samples, rollups, alert rules and their event history through foreign keys. Check deletion
removes its history. Channel deletion removes its encrypted configuration. User disabling revokes access and
sessions; the last enabled administrator is protected. Audit entries remain as the sensitive-action record.

## Environment contracts

`.env.example` documents every setting. `SECRETS_KEY` is required (32+ characters); setup token is needed only for
the first administrator. Boolean values are exactly `true`/`false`; blank optional values are ignored. Bootstrap
host name and URL must be set together. Retention, collection cadence, body/log limits and sample mode are
server configuration; user preferences do not change them. No key is included in the browser bundle.

The deployment and TLS commands above are pending on a clean Linux VM. See the verification report for what ran.

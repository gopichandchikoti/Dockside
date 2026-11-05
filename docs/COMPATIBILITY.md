# Compatibility assessment

Continuation and QA were performed on Windows x64 with Node 22.13.1, npm 10.9.2 and Git 2.47 from the supplied
environment. The reproducible dependency lock is npm's `package-lock.json`. React 19, TypeScript 5.9, Vite 7,
Fastify 5 and Vitest 4 are the selected stack; exact resolved versions are in the lockfile.

Installed Edge is the browser test target. Each browser evidence record includes its actual user agent.
Playwright's `browserName` is Chromium even when `channel=msedge`; that does not mean a separate Chrome test ran.
320px screenshots are desktop-browser viewport emulation, not physical-phone verification.

Docker and Compose are unavailable on this workstation. The Compose file targets rootful Linux Docker, including
host namespaces and read-only rootfs mounts. A structural YAML check is useful but is not Compose validation or
Linux startup evidence. Exact commands still required:

```sh
docker compose config --quiet
docker compose up --build -d
docker compose ps
curl --fail http://127.0.0.1:8080/readyz
```

The optional TLS profile, real Docker Engine API/log framing, physical Linux sensor availability, Linux socket
group permissions and real notification providers require deployment verification. Node 22.13.1 prints an
ExperimentalWarning for built-in `node:sqlite`; the warning is retained and documented.

No global toolchain, Docker/WSL installation, external account, subscription or deployment was performed.

# Development guide

## Supported development environment

Helm is currently developed and packaged for macOS. Use Node.js 20 or newer, npm, and Git. Native dependencies such as `better-sqlite3` may require the normal platform build toolchain when a prebuilt binary is unavailable.

## Repository layout

```text
server/   Express API, SQLite access, migrations, schedulers
web/      React application built with Vite
mcp/      MCP transports, tool schemas, and API adapter
test/     Node test-runner suites
scripts/  packaging and publication checks
docs/     design and contributor documentation
```

The root npm workspace installs all three packages.

## Install and verify

```sh
npm ci
npm run check
```

`npm run check` executes the complete Node test suite, builds the production web bundle, scans the candidate source for private identifiers and forbidden files, builds and inspects the portable archive twice for reproducibility, runs an independent secret scan, and audits production dependencies. Useful individual commands are:

```sh
npm test
npm run build
npm run package:portable
npm run security:scan-history
```

Before a release, install [Gitleaks](https://github.com/gitleaks/gitleaks)
(`brew install gitleaks` on macOS) and run `npm run security:gitleaks`. Then run
`npm run security:scan-history` as an independent detector over every blob in
the fresh public Git history. Do not add broad fixture allow-lists to make a
finding disappear; split synthetic canaries in test source and investigate any
real finding. `npm audit --omit=dev` must have no critical or high production
advisories. Record a precise, exposure-based exception if a future advisory
cannot be fixed immediately rather than claiming zero vulnerabilities.

The packaging command creates and checks a blank-data portable archive. Do not use an archive as a backup of live data.

## Run locally

Production-like local process:

```sh
npm run build
npm start
```

Then open `http://127.0.0.1:8787`.

Development watchers run separately:

```sh
npm run dev:server
npm run dev:web
```

The web development server proxies API calls to `http://127.0.0.1:8787`. Override that target with `VITE_API_TARGET` only when you understand the authentication and network implications.

The convenience scripts `./start.sh` and `./stop.sh` run the built server in the background and keep the PID/log under `server/data/`.

## Local state

A normal run can create files that must never be committed:

- `server/data/` for SQLite, WAL files, logs, and process state;
- local API, password, MCP, provider, and OAuth credential files at the repository or install root;
- generated `web/dist/`, archives, and staging output.

Use synthetic data in tests and examples. Never submit a real database, token, password hash, API key, OAuth credential, personal log, screenshot, or backup.

Set `DASHBOARD_DB_PATH` for an isolated database. Tests use isolated state and must not depend on a developer's live Helm installation.

## Environment variables

Common server settings:

| Variable | Purpose | Default |
| --- | --- | --- |
| `HOST` | API bind address | `127.0.0.1` |
| `PORT` | API port | `8787` |
| `DASHBOARD_DB_PATH` | alternate SQLite path | `server/data/dashboard.db` |
| `LLM_BACKEND` | `sdk` or `api` | `sdk` |
| `ANTHROPIC_API_KEY` | API backend and optional API-only calls | unset |
| `ANTHROPIC_MODEL` | model override | backend default |
| `HELM_CLAUDE_BIN` | path to the `claude` CLI used for the `sdk` backend's local auth-status probe | `claude` (PATH lookup) |
| `HELM_AUTH_STATUS_TTL_MS` | how long a verified `sdk` auth-status result is cached before re-probing | `30000` |
| `DASHBOARD_URL` | API base used by the MCP adapter | `http://127.0.0.1:8787` |
| `DASHBOARD_TOKEN` | MCP adapter API token override | local token file |
| `MCP_HTTP_HOST` | MCP HTTP bind address | `127.0.0.1` |
| `MCP_HTTP_PORT` | MCP HTTP port | `8788` |
| `MCP_HTTP_TOKEN` | MCP HTTP bearer token override | local token file |

Additional optional integrations define their own environment variables in source. Do not commit them or paste live values into issues.

## Change discipline

1. Add or update a failing test before changing behavior.
2. Make the smallest implementation change that passes it.
3. Run the focused test, then `npm run check`.
4. Run `git diff --check` and inspect the complete diff.
5. For publication work, run `npm run package:portable` and the public-export tests.

Changes to environment variable names, on-disk paths, migrations, auth behavior, API contracts, or MCP tool schemas are compatibility-sensitive. Document and test them deliberately.

## Pull requests

Follow [CONTRIBUTING.md](../CONTRIBUTING.md), the [Code of Conduct](../CODE_OF_CONDUCT.md), and the private vulnerability process in [SECURITY.md](../SECURITY.md). Keep unrelated refactors out of focused changes and redact operator data from all evidence.

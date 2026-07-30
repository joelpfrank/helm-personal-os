# MCP integration

Helm exposes its records and actions as Model Context Protocol tools. The MCP layer does not maintain a second database: tools call the authenticated Helm HTTP API, so browser and assistant operations share the same records and validation.

## Prerequisites

1. Install dependencies and start Helm.
2. Confirm `http://127.0.0.1:8787/api/health` responds.
3. Keep the generated API token private. The local MCP adapter reads it from `DASHBOARD_TOKEN` or the installation's token file.

## Local stdio transport

The preferred local transport is stdio:

```sh
node mcp/src/index.js
```

A compatible MCP host should launch that command from the Helm installation. The process communicates JSON-RPC over stdin/stdout and sends diagnostics to stderr. Tool calls are forwarded to `DASHBOARD_URL`, which defaults to `http://127.0.0.1:8787`.

[Hermes Agent](https://hermes-agent.nousresearch.com/docs) is an optional third-party MCP-compatible agent host; Helm does not require it. When the `hermes` command is available on PATH, the macOS installer attempts registration, answers the current tool-selection prompt, and verifies the persisted server with `hermes mcp test helm` (`--no-hermes` skips this). A failed verification is reported rather than presented as success. Manual copy-paste setup is:

```sh
hermes mcp add helm --command node --env DASHBOARD_URL=http://127.0.0.1:8787 --args /absolute/path/to/Helm/mcp/src/index.js
hermes mcp test helm
```

The first command may ask whether to enable all discovered tools. Keep `--args` last because Hermes treats everything after it as child-process arguments. [HERMES-INSTALL.md](../HERMES-INSTALL.md) contains the full generic stdio `mcpServers` JSON block and version-honest OpenClaw guidance. For the audited OpenClaw `2026.3.13` release, documentation advertises `mcp.servers` but the installed CLI has no verified `openclaw mcp` subcommand; configure the documented key manually or use a compatible stdio bridge, then verify discovery. Registration is local configuration, not publication of the service to a network.

## Streamable HTTP transport

An optional HTTP entry point is available:

```sh
node mcp/src/http.js
```

It binds to `127.0.0.1:8788` by default and serves:

- unauthenticated health status at `http://127.0.0.1:8788/health`;
- authenticated MCP requests at `http://127.0.0.1:8788/mcp`.

Authentication accepts a bearer token. A path-token form also exists for clients that cannot set authorization headers; treat that entire URL as a secret because URLs can leak through history, logs, screenshots, analytics, and proxy configuration.

Do not change `MCP_HTTP_HOST` to a non-loopback address or place this service behind a public route without supplying and operating appropriate TLS, authentication, filtering, logging, and incident controls. Helm does not provide a secure public deployment profile.

## Tool domains

The registered tools cover the same main domains as the app:

- boards, columns, cards, and tags;
- habits, outcomes, streaks, and calendars;
- exercises, routines, workouts, sets, history, and progression;
- calendar status, events, synchronization, and free slots;
- memories, food, activity, weight, and targets;
- vision, goals, obstacles, links, check-ins, and coach settings;
- custom modules and templates;
- saved agents, schedules, channels, and notifications.

Tool descriptions and JSON schemas define inputs. Server routes remain the authority for validation, authentication, persistence, and error responses.

## In-app use

The default Claude Agent SDK backend mounts Helm tools as an in-process MCP server. The visible coach receives a reduced tool surface; saved/background agents may receive the full Helm surface and operator-configured external MCP servers. This is separate from registering the stdio server in another assistant application.

## Security model

- The stdio adapter can perform any operation exposed by its registered Helm tools.
- The HTTP transport uses a token separate from the main application token.
- Tool names are not an authorization system; possession of valid credentials controls access.
- MCP arguments and returned records may be included in model context and leave the host when an AI-backed client uses them.
- A successful model response does not prove a mutation occurred; inspect the tool result or read the record back.

See [Privacy](../PRIVACY.md) and [Security](../SECURITY.md).

## Troubleshooting

- **Connection refused:** start Helm and check `http://127.0.0.1:8787/api/health`.
- **Missing token:** run Helm once to create local credentials, or set `DASHBOARD_TOKEN` for the adapter process.
- **Unauthorized:** confirm the adapter points at the same installation that created the token.
- **Wrong instance:** verify `DASHBOARD_URL` and the working directory used by the MCP host.
- **HTTP MCP unauthorized:** pass the MCP HTTP token, not the main application token.

Never paste live token values into issues or logs shared with others.

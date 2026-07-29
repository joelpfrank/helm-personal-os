# Architecture

Helm is a single-host web application with three npm workspaces: an Express/SQLite server, a React/Vite web client, and an MCP adapter. The default deployment serves the built single-page application and JSON API from one loopback listener.

## Runtime shape

```text
Browser on this Mac
       |
       | HTTP on 127.0.0.1:8787
       v
Express server ───────> SQLite + local credential/config files
       |
       +── serves web/dist
       +── runs migrations at startup
       +── runs optional calendar, agent, timer, and channel schedulers
       +── calls optional external providers

MCP client ──stdio──> mcp/src/index.js ──authenticated HTTP──> Express API
       |
       +── optional Streamable HTTP transport on 127.0.0.1:8788

In-app chat ──> LLM adapter ──> Claude Agent SDK or Anthropic Messages API
                         └────> in-process Helm MCP tools
```

## Components

### `web/`

A React single-page application built by Vite. Zustand stores and retained views cover boards, tasks, habits, food, workouts, calendar, coaching, chat, modules, and agent configuration. The simplified primary navigation exposes Tasks, Food, Habits, Workouts, and Coach; not every retained subsystem is currently reachable there. In production, Express serves `web/dist` and falls back to `index.html` for non-API routes.

### `server/`

An Express application with domain routers under `server/src/routes/`. `server/src/index.js` binds to `127.0.0.1:8787` unless `HOST` or `PORT` is deliberately overridden. It starts the HTTP server and optional background loops for calendar sync, scheduled agents, workout rest timers, and a configured messaging channel.

The server uses `better-sqlite3`. Migrations in `server/src/migrations/` run in filename order inside transactions before route modules use the schema. SQLite WAL mode and foreign keys are enabled. `DASHBOARD_DB_PATH` can direct a test or isolated instance to a different database.

### `mcp/`

The MCP workspace maps tool schemas to the authenticated server API. The stdio entry point is intended for local MCP clients. A separate Streamable HTTP entry point listens on `127.0.0.1:8788` by default and uses its own bearer token. See [MCP integration](MCP.md).

## Request and authentication flow

1. Static assets are readable without the API bearer token.
2. On first use, the browser asks the operator to create a local password.
3. A successful password flow supplies the API token to the browser client.
4. Protected `/api/*` routes require that token in the `Authorization` header. Health and narrowly scoped authentication/OAuth routes are exceptions.
5. MCP tools load the API token from `DASHBOARD_TOKEN` or the local token file and call the same API routes used by the web app.

This is a single-user authentication boundary, not multi-tenant authorization. The host, local files, process environment, backups, and reverse-proxy configuration remain operator responsibilities.

## Data model

The schema covers:

- boards, columns, cards, and tags;
- habits and tri-state daily outcomes;
- exercises, routines, workouts, sets, and rest-timer state;
- calendar events and synchronization state;
- conversations, messages, attachments, memories, and settings;
- meals, daily nutrition/activity totals, and targets;
- vision, goals, obstacles, links, check-ins, and coaching profile;
- custom modules and module items;
- saved agents, schedules, lessons, and channels.

Goal links connect goals to downstream records such as habits, cards, routines, events, workouts, food targets, and custom-module items. The coach briefing reads the actual task snapshot and recent check-ins rather than relying only on chat text.

## AI boundary

`server/src/lib/llm.js` normalizes two Anthropic-backed paths:

- `sdk` (default): the Claude Agent SDK uses a local Claude Code login when available. Helm removes the API key from that SDK subprocess, blocks local file/shell/edit tools, and provides Helm tools through an in-process MCP server.
- `api`: the Anthropic Messages API uses `ANTHROPIC_API_KEY` and supports streaming/tool-use responses.

The visible coach receives a reduced Helm tool surface. Saved/background agents retain the fuller Helm tool set and can use operator-configured external MCP servers. These controls reduce capability, but they are not an operating-system sandbox and do not make provider processing local.

## External boundaries

Optional features may contact Anthropic, Google Calendar, messaging providers, and operator-configured MCP services. Each adds its own credentials, policies, availability, and data-retention behavior. Core records remain usable without enabling those integrations.

## Deliberate constraints

- one operator and one local SQLite database;
- macOS-first service installation;
- no built-in TLS termination or public deployment profile;
- no claim of application-level database encryption;
- no high-availability, horizontal-scaling, or multi-device conflict-resolution design.

Related: [Privacy](../PRIVACY.md), [Security](../SECURITY.md), and [Development](DEVELOPMENT.md).

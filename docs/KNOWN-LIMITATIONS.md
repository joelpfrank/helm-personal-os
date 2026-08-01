# Known limitations

Helm is an early, local-first, single-operator project. The items below are accepted follow-up work, not claims that the behaviors are fixed. Keep Helm bound to loopback on a trusted host, protect its bearer token and local files, use least-privilege provider credentials, and review AI-initiated actions before relying on them.

## AI and coaching

- Web content supplied to an agent can contain prompt injection and can influence outbound requests. Treat fetched content as untrusted, avoid combining browsing with sensitive tools or credentials, and review proposed actions.
- Confirmation for destructive AI tool use is currently enforced partly through prompt instructions rather than a separate policy engine. Do not give the coach access to consequences you are unwilling to review.
- Meal macros, exercise progression, activity interpretation, and the health score are estimates or heuristics. They are not measurements or medical advice; verify important decisions independently. UI disclaimer coverage is not yet uniform across every health surface.
- Provider model identifiers and availability change over time. Helm has documented defaults and fallback behavior, but stored model choices can still need operator review after a provider lifecycle change.
- One model-selection regression is structurally weak/tautological and should be replaced with behavior-level coverage.

## Authentication and network boundaries

- Authentication has focused coverage but not an exhaustive negative test matrix for every route and transport. Keep the service on loopback and do not treat Helm as an internet-facing multi-user system.
- The first-run password has no account recovery, rate-limiting, or lockout policy. Use a strong local password and rely on host access controls.
- Bearer tokens in MCP HTTP path or URL configuration can leak through shell history, process arguments, logs, or copied URLs. Prefer stdio or protected configuration, and rotate a token if exposed.
- MCP HTTP transport uses a path token and CORS controls intended for loopback use; it is not hardened as a public cross-origin API. Non-default Helm ports also require explicit MCP endpoint configuration.
- Some outbound integrations do not yet apply consistent request timeouts, HTTP response checks, or network-error normalization. This includes notification delivery and selected provider fetches; a timeout or accepted request should not be assumed to mean the remote effect completed.
- Server-sent-event failures after response headers are sent have limited recovery semantics. Reconnect and verify durable state rather than relying only on the stream.
- Error logging is intentionally constrained, but coverage of redaction and normalization across every integration is incomplete. Protect local logs as potentially sensitive operational data.

## Data and UI behavior

- Some multi-record operations, including card/tag updates, are not fully atomic. Retry carefully after interruption and verify the resulting records.
- Very large habit-calendar date ranges can be expensive. Query bounded periods rather than extreme ranges.
- Rest-timer asynchronous failures do not yet have a dedicated UI error boundary. Refresh and verify the active workout if the timer surface becomes inconsistent.
- Calendar, saved-agent, settings, and other retained views or APIs are intentionally absent from the simplified five-surface web navigation. Some hidden view code remains in the repository and may become stale; activity and certain integration capabilities are API/MCP-only.
- CLI and synthetic-demo commands exist but are less discoverable than the main web workflow. Consult the README and development guide rather than assuming every capability appears in navigation.
- PWA metadata and some comments can lag product-surface changes; do not use them as the authoritative capability list.

## Installation and release operations

- The macOS upgrade path has a possible `launchctl` unload/start race, and service startup checks do not cover every slow-machine timing case. Back up data, use `--dry-run`, and verify `/api/health` after installation or upgrade.
- `npm audit` results vary with the registry and date. A clean release check records a point-in-time result, not a permanent guarantee.
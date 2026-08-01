# Roadmap

Helm is an early, local-first, single-user project. This roadmap records possible directions, not commitments, delivery dates, or guarantees. Accepted changes must preserve the project's privacy boundaries, testability, and honest documentation.

## Current foundation

The repository currently contains:

- goal-linked tasks, habits, food/activity records, workouts, calendar data, check-ins, memories, and custom modules;
- a web interface, authenticated JSON API, SQLite migrations, and MCP tools;
- optional Anthropic-backed coaching, Google Calendar sync, messaging, and scheduled-agent capabilities;
- a macOS portable installer and publication checks that exclude operator data and credentials;
- an optional external state-directory contract (`HELM_STATE_DIR`) that keeps the database, tokens, password, and credentials outside the replaceable code prefix, a copy-only migration utility for adopting it on an existing install, and a deterministic sandboxed convergence check that proves install-then-upgrade never rewrites external state.

## Near-term candidates

### Documentation and onboarding

- make first-run data boundaries and optional integrations easier to understand;
- improve guided setup with synthetic examples that are clearly removable;
- add versioned upgrade and backup/restore guidance backed by tests.

### Reliability and observability

- clearer diagnostics for database, scheduler, provider, and synchronization state;
- operator-visible recovery paths for deterministic integration failures;
- broader migration, interruption, idempotency, and archive-install coverage.

### Coaching quality

- better explanations of which stored evidence informed a suggestion;
- stronger read-back confirmation after consequential tool mutations;
- more operator control over context selection, retention, and coaching cadence.

### Accessibility and user experience

- continued keyboard, screen-reader, contrast, responsive-layout, and reduced-motion testing;
- clearer empty states and error recovery without hiding underlying data state.

## Longer-term research

The following require design and security work before they should be treated as product plans:

- supported installation outside macOS;
- encrypted export and restore workflows;
- carefully scoped multi-device access;
- additional model providers and local-model experiments;
- a stable, versioned external API and MCP compatibility policy.

## Explicit non-goals today

- hosted multi-tenant service;
- collaborative team permissions;
- public-internet deployment by default;
- medical diagnosis or automated professional advice;
- unattended authority over consequential external actions;
- claims of cross-platform support, high availability, or end-to-end encryption.

## How roadmap work is accepted

A roadmap item becomes current functionality only when source, tests, user-facing behavior, privacy/security documentation, and upgrade impact agree. Until then, it remains exploratory. Contributions should start with a narrowly testable problem statement and follow [CONTRIBUTING.md](../CONTRIBUTING.md).

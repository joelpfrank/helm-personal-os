# Changelog

All notable changes to Helm Personal OS are documented here.

This project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-07-29

### Added

- Local-first goals, vision, obstacles, check-ins, kanban tasks, habits, food, activity, workout, calendar, custom-module, and saved-agent records backed by SQLite.
- Evidence-grounded AI coaching through either a local Claude Code login or an Anthropic API key, with non-AI workflows remaining usable when no AI backend is configured.
- Five focused web surfaces for Tasks, Food, Habits, Workouts, and Coach, plus API and MCP access to retained capabilities.
- Deterministic synthetic demo workspace, four public screenshots, and an 85-second captioned silent product walkthrough.
- macOS portable installer with dry-run, overwrite protection, staged upgrades, rollback handling, and isolated installation tests.
- Public contribution, privacy, security, architecture, coaching, development, MCP, roadmap, and third-party-license documentation.
- Canonical `npm run check` gate covering tests, production build, demo validation, public-safety checks, secret scanning, reproducible package inspection, and production dependency audit.
- GitHub Actions CI, full-history Gitleaks scanning, CodeQL analysis, and Dependabot configuration.

### Security and privacy

- The release starts from fresh public Git history built through a fail-closed allow-list export; private databases, backups, credentials, logs, personal integrations, and deployment files are excluded.
- The server binds to loopback by default and uses bearer-token API authentication plus a first-run password for the browser UI.
- Provider errors are normalized so raw provider response bodies, stack traces, and credentials are not returned to the browser or persisted in chat history.

### Known limitations

- Helm 0.1.0 is an early, macOS-first, local/self-hosted release for one trusted operator; it is not hardened as a public multi-user service.
- Calendar, saved-agent, settings, and other retained capabilities are API/MCP-only or intentionally absent from the simplified five-surface navigation.
- Some destructive AI-tool confirmation relies partly on prompt instructions rather than an independent policy engine.
- Selected multi-record operations are not fully atomic, and some outbound integrations do not yet apply consistent timeout and response-verification behavior.
- Health and coaching outputs are estimates and are not medical, therapeutic, or professional advice.

See [Known limitations](docs/KNOWN-LIMITATIONS.md) for the complete release caveats.

[0.1.0]: https://github.com/joelpfrank/helm-personal-os/releases/tag/v0.1.0

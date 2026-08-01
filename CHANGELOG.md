# Changelog

All notable changes to Helm Personal OS are documented here.

Package manifests carry a placeholder [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
number because Node tooling requires one. The published release identity is the
plain label below, not that number.

## [v0]

Helm's first public release.

### Added

- Apple-informed, keyboard-accessible web surfaces for Tasks, Food, Habits,
  Workouts, Today, Coach, Vision, Goals, and provider setup.
- Two independent appearance axes: a selectable color theme (Neutral or Rose)
  and light/dark/system, each persisted in the browser. All four combinations
  define the full semantic role set and are contrast-checked against WCAG AA.
- Local-first goals, check-ins, kanban tasks, habits, meals, activity, workouts,
  calendar, custom-module, and saved-agent records backed by SQLite.
- Optional provider-neutral AI coaching through two subscription profiles that
  run on the provider's own first-party CLI — Claude Code (`claude auth login`)
  and Codex CLI (`codex login`) — or verified Anthropic, OpenAI, Google Gemini,
  and OpenRouter API profiles; no-AI mode keeps core workflows available. AI
  setup reports, per profile, whether that provider is actually installed and
  signed in on this machine, using bounded status checks that consume no
  inference and fail closed.
- Codex CLI turns run with a read-only sandbox and `--ephemeral`, take their
  prompt on stdin rather than the command line, and reach Helm records through
  the same MCP tool surface other MCP clients use, so no credential or prompt
  text is exposed in the process table.
- Write-only provider credential storage outside SQLite, provider-specific
  readiness, normalized tool/stream handling, and safe error boundaries.
- Deterministic synthetic demo data and media, with no operator records or paid
  provider calls.
- A transactional macOS installer with external state, dry-run, overwrite
  protection, staged upgrades, rollback, health verification, and optional MCP
  registration.
- Visitor, privacy, security, architecture, development, MCP, limitation, and
  case-study documentation.
- A release gate that passes for the recipient who receives it, not only in the
  maintainer checkout: the privacy and secret scans fall back to reading the
  files on disk when there is no Git index, and checks that depend on the Git
  index or on withheld maintainer-only files announce an explicit skip instead
  of failing someone on files they were never sent.
- A deterministic `Helm-portable-v0.zip` public-source artifact and checksum,
  built only from tracked allow-listed files and excluding internal release
  controls, data, credentials, dependencies, logs, and backups.

### Security and privacy

- The eventual public source will start from a fresh one-commit history built
  from the exact inspected portable artifact; publication remains gated.
- The server binds to loopback by default and uses bearer-token API
  authentication plus a first-run browser password.
- Remote AI processing is disclosed, API secrets never return after write, and
  provider failures do not expose raw bodies, stack traces, or credentials.
- Subscription profiles refuse a pasted credential with a 400 and an
  explanation. They previously returned an opaque 500, because the provider
  settings router raised an error shape the shared handler does not let choose
  its own status; unknown profiles and invalid selections were affected too.

### Known limitations

- Helm v0 is macOS-first and designed for one trusted operator on one trusted
  host; it is not a hosted or public multi-user service.
- Some retained capabilities remain API/MCP-only, and the reduced Coach tool
  surface is not an operating-system sandbox or complete policy engine.
- Local databases and backups are not application-level encrypted. Health and
  coaching outputs are estimates, not professional advice.

See [Known limitations](docs/KNOWN-LIMITATIONS.md) for the complete candidate caveats.
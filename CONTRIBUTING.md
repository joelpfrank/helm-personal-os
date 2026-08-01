# Contributing to Helm Personal OS

Thanks for your interest in improving Helm. This is a local-first personal
operating system (tasks, habits, health tracking, check-ins, and AI
coaching) — contributions are welcome, with a few ground rules to keep the
project safe to run and safe to publish.

## Ground rules

- **Never commit real personal data or secrets.** No real names, emails,
  phone numbers, locations, tokens, API keys, database files, logs, or
  backups — in code, tests, fixtures, issues, or pull requests. Use
  obviously-synthetic placeholders (e.g. `test@example.com`, `Test User`)
  everywhere a fixture needs a human-shaped value.
- **Test-first.** This repository practices strict test-first development:
  add or update a failing test before changing behavior, then make it pass.
  `node --test test/*.test.mjs` (or `npm test`) must be green before you
  open a pull request.
- **Keep the public-export safety test green.** `test/public-export.test.mjs`
  guards against private/operator-specific content leaking into the public
  source tree. If you add a new file class that legitimately shouldn't be
  scanned or exported, extend that test deliberately — don't work around it.
- **Don't rename compatibility-sensitive surfaces casually.** Environment
  variable names, on-disk token/database filenames, and existing HTTP/MCP
  API semantics are relied on by running installs. Changing them requires a
  clear justification and, where relevant, a migration note.

## Development workflow

Requirements: macOS, Node.js 20+, npm, and Git.

1. Fork and clone the repository.
2. `npm install` (installs all workspaces: `server`, `web`, `mcp`).
3. `npm test` — runs the full test suite.
4. `npm run build` — builds the production frontend bundle.
5. `npm run check` — runs the complete local release gate: tests, production
   build, public-source safety checks, reproducible package inspection, secret
   scan, and production dependency audit. This is the gate your pull request
   needs to pass.

## Reporting bugs and requesting features

Use the GitHub issue templates. Please redact any personal data (yours or
anyone else's) from logs, screenshots, or reproduction steps before posting.

## Security issues

Do **not** open a public issue for a security vulnerability — see
[SECURITY.md](SECURITY.md) for how to report it privately.

## Code of conduct

Participation in this project is governed by our
[Code of Conduct](CODE_OF_CONDUCT.md).

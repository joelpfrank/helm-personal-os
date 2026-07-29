# Privacy

Helm Personal OS is local-first, not offline-only. Core records are stored on the operator's machine, but optional integrations—especially AI coaching and calendar sync—can transmit selected data to external providers.

## Local storage

Helm stores application state in a local SQLite database under `server/data/` by default. This can include tasks, goals, vision, habits, meals, body measurements, workouts, check-ins, chat history, memories, calendar mirrors, and configuration. Authentication tokens, provider credentials, logs, generated archives, and backups may also exist on the host depending on setup. These paths are excluded from the public source repository and portable source archive.

The operator controls the host and is responsible for account access, disk encryption, filesystem permissions, backups, retention, secure deletion, and any network exposure. Anyone with sufficient access to the host or a backup may be able to read this data.

## AI provider boundary

Using Coach or another AI-backed feature sends the prompt and the context needed for that request to an external model provider. Context can include user messages and relevant Helm records such as goals, tasks, habits, health logs, check-ins, memories, or tool results. Do not place information in Helm that you are unwilling to send when invoking an AI feature.

The default Claude Agent SDK path uses local Claude Code or Claude subscription authentication. An alternative backend can use an `ANTHROPIC_API_KEY`. In both modes, request content leaves the local machine and is processed by Anthropic under the terms, privacy policy, data-use settings, and retention rules associated with the operator's account. The Agent SDK also documents collection of usage/feedback data and associated conversation data in some circumstances. See Anthropic's current legal and privacy documentation before use.

Core non-AI records and workflows can run locally, but self-hosting Helm does not make AI requests private to the host. Disable or avoid AI features if external processing is unacceptable.

## Google Calendar

Google Calendar integration is optional. When configured and authorized, Helm exchanges event and OAuth data with Google and stores a local event mirror plus authorization state. Google's terms and privacy policy apply. Revoking access at Google and disconnecting Helm are both recommended when the integration is no longer needed.

## MCP and other integrations

MCP servers and future optional integrations have their own data boundaries. A connected tool can receive the arguments Helm sends to it and may return data that Helm stores or includes in later AI context. Review each integration, its permissions, endpoint, and provider policy before enabling it. Do not expose MCP bearer tokens or token-bearing URLs.

## Logs, exports, and backups

Logs, screenshots, issue reports, database copies, exports, and backups can contain sensitive data even when the source repository does not. Redact them before sharing. The project does not operate a hosted Helm data service and cannot delete data from an operator's machine or third-party provider account.

## Security reports and contributions

Never submit real personal data, credentials, database files, or unredacted logs in a public issue, pull request, or test fixture. Follow [SECURITY.md](SECURITY.md) for private vulnerability reports.

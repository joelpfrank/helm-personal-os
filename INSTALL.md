# Install Helm on your Mac

This archive is a **blank, self-contained copy of Helm** — a personal
kanban + habits + coaching app with a built-in MCP server. It carries **no
data, tokens, passwords, or keys** from anyone else's installation. When you install it, it
generates its own fresh token and an empty database and runs only on your
own machine (`127.0.0.1`).

Helm is a standalone application. No agent host, editor, or assistant is
required to install or use it. If you later want an assistant to read or update
Helm through Model Context Protocol tools, see
[Agent integrations](AGENT-INTEGRATIONS.md) after you finish here.

## Direct install

Unzip `Helm-portable-v0.zip`, then:

```sh
cd Helm
./install-helm.sh --state-dir "$HOME/Library/Application Support/Helm"
# open the URL it prints (http://127.0.0.1:8787/?token=…)
```

The external state directory is recommended for new installations: the
database, local authentication files, and write-only provider credentials stay
outside the replaceable `~/Helm` code tree. A legacy install without
`--state-dir` remains supported, but keeps mutable state inside its prefix.

## What it does

- Requires **Node.js 20+** (install that first if you don't have it).
- Installs into **`~/Helm`** (change with `--prefix /some/path`).
- `npm ci`, builds the frontend, generates a **fresh token + blank database**.
- Installs a per-user **LaunchAgent** (`com.helm.app`) bound to **127.0.0.1**
  only — nothing is exposed to your network.
- Optionally registers Helm's MCP server with a supported agent host that is
  already on your PATH, and verifies that registration before reporting
  success. A failed verification returns nonzero with manual retry commands;
  standalone Helm remains installed either way. Pass `--no-hermes` to skip the
  optional integration step entirely. See
  [Agent integrations](AGENT-INTEGRATIONS.md) for the hosts this was verified
  against.
- Verifies `/api/health` before finishing.

It **won't overwrite** an existing install or data unless you pass `--upgrade`.

## Backup and upgrade

Use the same absolute `--state-dir` on every install, backup, and upgrade. For
a consistent backup, stop the LaunchAgent before copying SQLite state, then
start it again:

```sh
launchctl bootout "gui/$UID/com.helm.app"
cp -pR "$HOME/Library/Application Support/Helm" "$HOME/Helm-backup"
launchctl bootstrap "gui/$UID" "$HOME/Library/LaunchAgents/com.helm.app.plist"
```

Keep the backup outside both the application prefix and state directory. Verify
it exists before upgrading. Unzip the new archive into a separate folder and run:

```sh
./install-helm.sh --prefix "$HOME/Helm" \
  --state-dir "$HOME/Library/Application Support/Helm" --upgrade
curl -fsS http://127.0.0.1:8787/api/health
```

The installer builds before touching the destination, swaps code on the same
filesystem, preserves external state, and rolls back the prior code tree if a
post-swap install or health check fails. It does not replace a separate backup.

## Try it without changing anything

```sh
./install-helm.sh --dry-run          # prints the exact plan, touches nothing
```

## Optional: turn on the in-app AI Chat / coach

Helm works fully without any AI key — boards, habits, tasks, and MCP tools.
The **in-app Chat tab and coach** can use an existing Claude Code subscription
login on this Mac. An **Anthropic API key** is an optional alternative:

Save the key in a private local file, then run:

```sh
./install-helm.sh --anthropic-key /path/to/private-key-file
```

The key is stored in a `chmod 600` file and loaded only at launch — it is
**never written into the LaunchAgent plist**. Leave it out and everything
else still works; you can add it later and restart the service.

API profiles for Anthropic, OpenAI, Gemini, and OpenRouter can also be
configured through **Coach → AI setup**. Values cross a write-only local route,
are stored outside SQLite under the external state directory, and are never
returned to the browser. A readiness check is local and makes no inference
request. Sending a Coach message does leave your Mac: selected prompt context
is processed by the configured remote provider under that account's terms.

To delete a saved API credential, use **Disconnect** for that profile in AI
setup and verify it reports not configured. Environment variables remain an
operator-managed override and must be removed from the service environment
separately. Disconnect Claude Code with the provider-owned Claude CLI; Helm
does not read or delete CLI credential stores. Removing Helm code does not
delete the external state directory or third-party provider data.

## Optional: connect an assistant

Helm ships an MCP server, so a compatible assistant can read and update the
same records the browser shows. This is optional and off until you configure a
host yourself. Some hosts can also drive the installer non-interactively and
register that MCP server for you.

[Agent integrations](AGENT-INTEGRATIONS.md) is the single reference for that:
the exact registration commands, which host versions the behavior was verified
against and when, the permissions and privacy boundary you accept by connecting
a host, and troubleshooting for a registration that does not verify.

## Generic MCP hosts

For desktop agents and editors that support the common `mcpServers` stdio
format, add this block to that host's MCP configuration and replace the two
absolute paths. Configuration-file locations differ by host.

```json
{
  "mcpServers": {
    "helm": {
      "command": "/absolute/path/to/node",
      "args": ["/absolute/path/to/Helm/mcp/src/index.js"],
      "env": {
        "DASHBOARD_URL": "http://127.0.0.1:8787",
        "HELM_STATE_DIR": "/absolute/path/to/Helm-state"
      }
    }
  }
}
```

Restart or reload the host, confirm the `helm` server connects, and inspect
its discovered tools before making changes. The stdio adapter exposes all Helm
tools; arguments and returned records can enter the host model's context.

A host that does not document this JSON shape may use a different schema; do
not guess its file or keys. [Agent integrations](AGENT-INTEGRATIONS.md) records
which hosts were checked against this block, including one whose current online
documentation describes a command its released CLI does not have.

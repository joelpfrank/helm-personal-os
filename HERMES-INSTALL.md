# Install Helm on your Mac

This archive is a **blank, self-contained copy of Helm** — a personal
kanban + habits + coaching app with a built-in MCP server. It contains **no
data, tokens, passwords, or keys** from the sender. When you install it, it
generates its own fresh token and an empty database and runs only on your
own machine (`127.0.0.1`).

Helm works completely standalone — no Hermes required. [**Hermes Agent**](https://hermes-agent.nousresearch.com/docs) is an
optional third-party MCP-compatible agent host some operators use to drive
installs and register local MCP servers non-interactively; if you don't use
one, skip straight to the direct install below.

## Direct install

No Hermes needed — this works standalone:

```sh
cd Helm
./install-helm.sh                    # ~/Helm, 127.0.0.1, LaunchAgent, health check
# open the URL it prints (http://127.0.0.1:8787/?token=…)
```

## What it does

- Requires **Node.js 20+** (install that first if you don't have it).
- Installs into **`~/Helm`** (change with `--prefix /some/path`).
- `npm ci`, builds the frontend, generates a **fresh token + blank database**.
- Installs a per-user **LaunchAgent** (`com.helm.app`) bound to **127.0.0.1**
  only — nothing is exposed to your network.
- When Hermes is on your PATH, attempts to register the local MCP server,
  answers Hermes's tool-selection prompt, and verifies the result with
  `hermes mcp test helm`. A failed verification is reported with manual retry
  commands; pass `--no-hermes` to skip this optional step.
- Verifies `/api/health` before finishing.

It **won't overwrite** an existing install or data unless you pass `--upgrade`.

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

## Optional: register with Hermes Agent

If you use Hermes Agent and want it to drive the install and register Helm's
MCP server for you, unzip `Helm-portable.zip` and give Hermes this prompt
(adjust the path to where you unzipped):

> **"Install the Helm app from the unzipped folder. Run `./install-helm.sh`
> inside it. It sets up a private, local-only Helm at `~/Helm`, starts it on
> `127.0.0.1`, and attempts and verifies MCP registration. When it's done, open the
> authenticated local URL on this Mac. Do not repeat or send the private token
> in chat."**

Hermes runs the same `install-helm.sh` installer non-interactively. Current
Hermes versions may ask `Enable all 112 tools? [Y/n/select]`; the installer
answers that prompt and then tests the persisted server. It reports rather
than hides a failure. This is entirely optional — Helm already works without
Hermes.

### Manual Hermes registration

If automatic registration was skipped or did not verify, run these commands
after replacing `/absolute/path/to/Helm` with your installation path:

```sh
hermes mcp add helm --command node --env DASHBOARD_URL=http://127.0.0.1:8787 --args /absolute/path/to/Helm/mcp/src/index.js
hermes mcp test helm
```

Accept the `Enable all 112 tools?` prompt. The final command must report a
successful connection and discovered tools. These commands contain no Helm
token: the local adapter reads its token from the installation at runtime.

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
        "DASHBOARD_URL": "http://127.0.0.1:8787"
      }
    }
  }
}
```

Restart or reload the host, confirm the `helm` server connects, and inspect
its discovered tools before making changes. The stdio adapter exposes all Helm
tools; arguments and returned records can enter the host model's context.

## OpenClaw

OpenClaw's documentation for the audited `2026.3.13` release advertises an
`mcp.servers` configuration key, but that installed CLI has no verified
`openclaw mcp` subcommand. Do not rely on an untested command. If your exact
OpenClaw release supports native MCP configuration, edit its documented
`mcp.servers` setting manually using the same command, args, and environment
shown in the generic stdio block above. Otherwise use a compatible stdio MCP
bridge/host and point it at Helm with that block. Verify the server and tool
list in OpenClaw before relying on it.

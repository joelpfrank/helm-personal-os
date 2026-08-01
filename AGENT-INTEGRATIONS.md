# Agent integrations

Helm works as a standalone local app. An agent host is optional: connect one only when you want an assistant to read or update Helm through Model Context Protocol (MCP) tools.

Compatibility evidence on this page was last verified on **2026-07-30** against the Helm v0 launch candidate, Hermes Agent `0.18.2`, OpenClaw `2026.3.13`, and mcporter `0.9.0`. Commands from a newer host release may differ; check that release's own help before changing the examples.

## 1. Install Helm standalone

No Hermes, OpenClaw, editor, or desktop agent is required.

```sh
./install-helm.sh
```

The default service binds to `127.0.0.1:8787`. Complete the browser first-run flow and keep the generated local credentials private. If you intentionally want no Hermes integration attempt even when `hermes` is on `PATH`, run `./install-helm.sh --no-hermes`.

## 2. Automatic Hermes registration

When `hermes` is on `PATH`, `install-helm.sh` attempts registration only after the standalone installation and health check complete. The verified installer path:

1. asks `hermes config path` for the active configuration and snapshots it;
2. runs `hermes mcp add helm` with the absolute Node and adapter paths, answers the replacement/tool-selection prompts, and keeps `--args` last;
3. requires Hermes's saved-registration marker; and
4. runs `hermes mcp test helm`, requiring both `Connected` and a non-zero discovered-tool count.

This automatic behavior is verified with Hermes Agent `0.18.2`. If the CLI is absent, registration is skipped. If `--no-hermes` is supplied, registration is disabled. If an attempted registration cannot be verified, the installer restores the prior Hermes configuration, returns nonzero, and prints manual recovery commands. The completed standalone Helm installation remains installed; it is not rolled back just because the optional agent registration failed.

## 3. Manual Hermes registration

Replace the three absolute paths below. `HELM_STATE_DIR` must match the installer's external `--state-dir`. For the default/in-prefix state layout, remove the `HELM_STATE_DIR=...` argument entirely. Keep `--args` last because Hermes treats everything after it as child-process arguments.

```sh
hermes mcp add helm --command /absolute/path/to/node --env DASHBOARD_URL=http://127.0.0.1:8787 HELM_STATE_DIR=/absolute/path/to/Helm-state --args /absolute/path/to/Helm/mcp/src/index.js
hermes mcp list
hermes mcp test helm
```

Accept the prompt to enable all 112 discovered tools. Do not treat a saved entry alone as success: the final test must report a successful connection and a non-zero tool count. These commands contain no Helm token; the adapter reads the installation's local credential file at runtime.

## 4. Generic stdio MCP hosts

Compatible desktop agents and editors commonly accept an `mcpServers` JSON object. Replace the paths and save the object in the location documented by that host. If you use the default/in-prefix state layout, remove the `HELM_STATE_DIR` property and the comma before it.

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

Restart or reload the host, inspect its connected-server view, and confirm that it discovered 112 Helm tools before relying on it. A host that does not document this JSON shape may use a different configuration schema; do not guess its file or keys.

## 5. OpenClaw `2026.3.13`

The installed npm release `2026.3.13` (commit `61d171a`) was checked directly on 2026-07-30. Its `openclaw --help` output has no `mcp` subcommand, and the tagged source has no native managed-MCP registry. Do not add the `mcp.servers` key shown in today's rolling OpenClaw documentation to this older release, and do not invent an `openclaw mcp` command.

That exact release does bundle an official [mcporter skill](https://github.com/openclaw/openclaw/blob/v2026.3.13-1/skills/mcporter/SKILL.md). It becomes available when the `mcporter` binary is installed. The following bridge was exercised with synthetic local credentials and discovered all 112 Helm tools:

```sh
npm install --global mcporter
mkdir -p config
# Save the generic mcpServers JSON above as config/mcporter.json.
mcporter list helm --schema
```

Run those commands from the OpenClaw agent workspace so mcporter finds `./config/mcporter.json`. OpenClaw `2026.3.13` uses mcporter through its bundled skill and command execution; this is not native automatic tool injection. Ask the agent to use mcporter for Helm calls, and require the same read-back verification described below.

The [current OpenClaw MCP guide](https://docs.openclaw.ai/tools/mcp) now documents native managed MCP for newer releases, but the site follows the current product rather than `2026.3.13`. Before using that route after an upgrade, verify that the installed `openclaw --help` actually lists `mcp`, inspect that exact CLI's MCP help, and follow the matching release documentation. No minimum native-MCP version is claimed here because it was not established by the verified `2026.3.13` package.

## Permissions, privacy, and mutation verification

- The stdio adapter exposes all 112 Helm tools in this release, including read and mutation tools. Connect it only to a host you trust with the entire Helm workspace.
- Helm credentials remain local. Do not paste tokens into prompts, shared configuration, issues, or logs; the adapter reads its credential file when it starts.
- Local stdio transport does not make model processing local. Tool arguments and returned Helm records may enter model context and leave the host when its configured model provider is remote.
- A model's prose is not proof that a mutation succeeded. Check the structured tool result, then call the corresponding read/list/get tool and verify the persisted record.
- Keep `DASHBOARD_URL` loopback-only unless you separately operate appropriate secure transport and access controls.

## Troubleshooting and fail-closed behavior

- **`hermes` is not found:** Helm installs normally and skips automatic registration. Register later or use another compatible host.
- **Hermes refuses before mutation:** the installed CLI must support `hermes config path` so the installer can snapshot the correct profile's configuration before changing it. Use the printed manual commands only after confirming the active profile.
- **Registration times out, is cancelled, reports zero tools, or fails its test:** the installer returns nonzero, restores the prior Hermes configuration, and leaves standalone Helm installed for recovery.
- **Connection refused:** start Helm and confirm `http://127.0.0.1:8787/api/health` locally.
- **Missing or unauthorized credentials:** confirm `HELM_STATE_DIR` points to the state directory created for this installation, or remove it for the default/in-prefix layout. Never copy a token into the agent-host config to work around a path error.
- **Wrong instance:** check `DASHBOARD_URL`, the adapter path, and the state directory as one set.
- **Tools are missing after a successful connection:** inspect host-side tool filters and reconnect. Do not call a partial or zero-tool discovery verified.
- **OpenClaw documentation and CLI disagree:** trust the installed version's help. Use the verified mcporter bridge for `2026.3.13`, or upgrade and re-verify before using the newer native route.

For transport details, see [MCP integration](docs/MCP.md). For the full installer contract, see [Install Helm on your Mac](INSTALL.md).

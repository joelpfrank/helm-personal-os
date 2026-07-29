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
- Optionally registers the local MCP server with Hermes (`hermes mcp add helm …`)
  when the `hermes` command is on your PATH — pass `--no-hermes` to always skip
  this step.
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
> `127.0.0.1`, and registers its MCP server with you. When it's done, open the
> authenticated local URL on this Mac. Do not repeat or send the private token
> in chat."**

Hermes runs the same `install-helm.sh` installer non-interactively, then
registers a `helm` MCP server in your Hermes tools (skippable with
`--no-hermes`). This is entirely optional — everything above already works
without it.

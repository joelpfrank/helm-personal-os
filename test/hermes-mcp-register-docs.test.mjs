// M13 (docs half): Helm's integration documentation must describe the
// installer and each supported agent-host path without overstating what was
// verified. It also guards the transitive links shipped in the portable
// archive so a recipient never receives a guide that points to a missing file.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('HERMES-INSTALL.md — honest registration claim', () => {
  const source = () => read('HERMES-INSTALL.md');

  it('does not unconditionally promise Hermes registration succeeds', () => {
    const s = source();
    assert.doesNotMatch(s, /registers its MCP server with you\.?"/,
      'must not promise unconditional registration in the Hermes-driven prompt copy');
    assert.match(s, /verif(y|ies|ied)/i, 'must mention that registration is verified, not just attempted');
  });

  it('states that attempted automatic registration fails the installer nonzero while leaving standalone Helm installed', () => {
    for (const file of ['HERMES-INSTALL.md', 'AGENT-INTEGRATIONS.md', 'docs/MCP.md']) {
      const s = read(file);
      assert.match(s, /non[- ]?zero/i, `${file} must document the automation failure signal`);
      assert.match(s, /Helm remains installed|standalone Helm (?:installation )?remains/i,
        `${file} must document the recoverable standalone-install state`);
    }
  });
});

describe('HERMES-INSTALL.md — copy-paste manual Hermes registration', () => {
  const source = () => read('HERMES-INSTALL.md');

  it('gives a manual `hermes mcp add helm` command with --command/--env/--args in parser-safe order', () => {
    const s = source();
    assert.match(s, /hermes mcp add helm\s+--command\s+\S+\s+--env\s+DASHBOARD_URL=\S+\s+HELM_STATE_DIR=\S+\s+--args\s+\S+/,
      'must give a copy-paste hermes mcp add command for helm');
  });

  it('gives `hermes mcp test helm` to verify the registration manually', () => {
    assert.match(source(), /hermes mcp test helm/);
  });

  it('explains the tool-selection prompt so a manual run is not surprised by it', () => {
    assert.match(source(), /Enable all \d+ tools/i);
  });

  it('propagates HELM_STATE_DIR in every state-dir-aware manual and generic setup', () => {
    for (const file of ['HERMES-INSTALL.md', 'AGENT-INTEGRATIONS.md']) {
      const s = read(file);
      const manual = s.match(/hermes mcp add helm[^\n]+/g)?.join('\n') ?? '';
      assert.match(manual, /HELM_STATE_DIR=/, `${file} manual Hermes setup must preserve external state`);
      const blocks = [...s.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => m[1]);
      const parsed = JSON.parse(blocks.find((b) => b.includes('mcpServers')));
      assert.ok(parsed.mcpServers.helm.env.HELM_STATE_DIR,
        `${file} generic MCP setup must preserve external state`);
    }
    assert.match(read('docs/MCP.md').match(/hermes mcp add helm[^\n]+/)?.[0] ?? '', /HELM_STATE_DIR=/,
      'docs/MCP.md manual Hermes setup must preserve external state');
  });
});

describe('HERMES-INSTALL.md — generic stdio mcpServers JSON for other hosts', () => {
  const source = () => read('HERMES-INSTALL.md');

  it('contains a valid JSON mcpServers block wired to the local stdio entry point', () => {
    const s = source();
    const blocks = [...s.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => m[1]);
    const mcpBlock = blocks.find((b) => b.includes('mcpServers'));
    assert.ok(mcpBlock, 'expected a fenced JSON code block containing mcpServers');
    const parsed = JSON.parse(mcpBlock);
    assert.ok(parsed.mcpServers && parsed.mcpServers.helm, 'mcpServers.helm must be defined');
    assert.match(parsed.mcpServers.helm.command, /node$/);
    assert.ok(
      parsed.mcpServers.helm.args.some((a) => String(a).endsWith('mcp/src/index.js')),
      'args must point at mcp/src/index.js',
    );
    assert.ok(parsed.mcpServers.helm.env && parsed.mcpServers.helm.env.DASHBOARD_URL,
      'env.DASHBOARD_URL must be set');
  });
});

describe('HERMES-INSTALL.md — version-honest OpenClaw guidance', () => {
  const source = () => read('HERMES-INSTALL.md');

  it('names the audited OpenClaw version and its supported mcporter bridge', () => {
    const s = source();
    assert.match(s, /OpenClaw/);
    assert.match(s, /2026\.3\.13/);
    assert.match(s, /mcporter/);
  });

  it('does not print an untested `openclaw mcp` CLI command', () => {
    const s = source();
    assert.doesNotMatch(s, /^\s*openclaw mcp/im,
      'must not present an openclaw mcp subcommand as a working command; the CLI has no verified one');
  });

  it('says the CLI lacks a verified subcommand and points to the verified bridge instead', () => {
    const s = source();
    const idx = s.search(/^## OpenClaw$/m);
    assert.ok(idx >= 0);
    const section = s.slice(idx, idx + 1800);
    assert.match(section, /lacks|has no\s+verified\s+`openclaw mcp`|not (been )?verified|untested/i);
    assert.match(section, /mcporter/i);
  });
});

describe('docs/MCP.md — host-specific setup remains discoverable', () => {
  const source = () => read('docs/MCP.md');

  it('contains copy-paste Hermes setup and identifies generic and OpenClaw guidance', () => {
    const s = source();
    assert.match(s, /hermes mcp add helm/);
    assert.match(s, /hermes mcp test helm/);
    assert.match(s, /mcpServers/);
    assert.match(s, /OpenClaw/);
    assert.match(s, /2026\.3\.13/);
    assert.doesNotMatch(s, /^\s*openclaw mcp/im);
  });
});

describe('agent integration guide — prominent, complete, and portable', () => {
  const guide = () => read('AGENT-INTEGRATIONS.md');

  it('is linked from every primary stranger-install entry point', () => {
    for (const file of ['README.md', 'HERMES-INSTALL.md', 'docs/MCP.md']) {
      assert.match(
        read(file),
        /\[Agent integrations\]\((?:\.\.\/)?AGENT-INTEGRATIONS\.md\)/,
        `${file} must prominently link the canonical agent-integration guide`,
      );
    }
  });

  it('covers standalone, automatic and manual Hermes, generic stdio, and version-honest OpenClaw setup', () => {
    const s = guide();
    assert.match(s, /standalone/i);
    assert.match(s, /automatic Hermes registration/i);
    assert.match(s, /manual Hermes registration/i);
    assert.match(s, /hermes mcp add helm/);
    assert.match(s, /hermes mcp test helm/);
    assert.match(s, /mcpServers/);
    assert.match(s, /OpenClaw/);
    assert.match(s, /2026\.3\.13/);
    assert.match(s, /mcporter/);
    assert.doesNotMatch(s, /^\s*openclaw mcp/im);
  });

  it('states the full-tool, local-credential, model-context, and mutation-readback boundaries', () => {
    const s = guide();
    assert.match(s, /all\s+112\s+Helm tools/i);
    assert.match(s, /credentials? (?:remain|stay) local/i);
    assert.match(s, /model context.*leave/i);
    assert.match(s, /read(?:-| )back/i);
  });

  it('keeps every local link from packaged Markdown inside the actual portable archive', () => {
    execFileSync('bash', ['scripts/package-helm.sh'], { cwd: ROOT, stdio: 'pipe' });
    const members = new Set(
      execFileSync('unzip', ['-Z1', 'dist/Helm-portable.zip'], { cwd: ROOT, encoding: 'utf8' })
        .trim().split('\n'),
    );
    const docs = ['AGENT-INTEGRATIONS.md', 'HERMES-INSTALL.md', 'docs/MCP.md'];
    for (const sourcePath of docs) {
      assert.ok(members.has(`Helm/${sourcePath}`), `${sourcePath} must be packaged`);
      for (const match of read(sourcePath).matchAll(/(?<!!)\[[^\]]+\]\(([^)]+)\)/g)) {
        const target = match[1].split('#', 1)[0];
        if (!target || /^[a-z]+:/i.test(target)) continue;
        const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(sourcePath), target));
        assert.ok(
          members.has(`Helm/${resolved}`),
          `${sourcePath} links to ${resolved}, which must be present in the portable archive`,
        );
      }
    }
  });
});

// M13 (docs half): HERMES-INSTALL.md previously implied Hermes registration
// during install is automatic and unconditional. It now must (1) describe
// registration honestly (attempted + verified, failure reported, not
// guaranteed), (2) give copy-paste manual `hermes mcp add` / `hermes mcp
// test helm` steps for when it doesn't, (3) give a generic stdio
// `mcpServers` JSON block for any compatible MCP host, and (4) give
// version-honest OpenClaw guidance: the installed/audited OpenClaw is
// 2026.3.13, whose docs advertise an `mcp.servers` config key but whose CLI
// has no verified `openclaw mcp` subcommand — so we document manual config
// only and must not print an untested `openclaw mcp ...` command.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
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
});

describe('HERMES-INSTALL.md — copy-paste manual Hermes registration', () => {
  const source = () => read('HERMES-INSTALL.md');

  it('gives a manual `hermes mcp add helm` command with --command/--env/--args in parser-safe order', () => {
    const s = source();
    assert.match(s, /hermes mcp add helm\s+--command\s+\S+\s+--env\s+DASHBOARD_URL=\S+\s+--args\s+\S+/,
      'must give a copy-paste hermes mcp add command for helm');
  });

  it('gives `hermes mcp test helm` to verify the registration manually', () => {
    assert.match(source(), /hermes mcp test helm/);
  });

  it('explains the tool-selection prompt so a manual run is not surprised by it', () => {
    assert.match(source(), /Enable all \d+ tools/i);
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

  it('names the audited OpenClaw version and its documented config key', () => {
    const s = source();
    assert.match(s, /OpenClaw/);
    assert.match(s, /2026\.3\.13/);
    assert.match(s, /mcp\.servers/);
  });

  it('does not print an untested `openclaw mcp` CLI command', () => {
    const s = source();
    assert.doesNotMatch(s, /^\s*openclaw mcp/im,
      'must not present an openclaw mcp subcommand as a working command; the CLI has no verified one');
  });

  it('says the CLI lacks a verified subcommand and points to manual config instead', () => {
    const s = source();
    const idx = s.search(/OpenClaw/);
    assert.ok(idx >= 0);
    const section = s.slice(idx, idx + 1200);
    assert.match(section, /lacks|no.*openclaw mcp|not (been )?verified|untested/i);
    assert.match(section, /manual|by hand|edit/i);
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

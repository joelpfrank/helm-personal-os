// Helm's install and integration documentation must describe the installer and
// each supported agent-host path without overstating what was verified, and
// must never leave a recipient holding a guide that points at a file they were
// not sent. These cases assert contracts a reader or a script would actually
// break on — parseable configuration, host claims tied to a checked version,
// and links resolved against the real archive — rather than restating prose.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { gitOnly } from '../scripts/lib/tree-context.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const jsonBlocks = (source) =>
  [...source.matchAll(/```json\n([\s\S]*?)```/g)].map((match) => match[1]);

describe('install and agent-integration documentation', () => {
  it('presents Helm as standalone rather than as requiring an agent host', () => {
    const install = read('INSTALL.md');
    assert.match(install, /^# Install Helm on your Mac$/m);
    assert.match(install, /standalone/i);
    assert.match(install, /--no-hermes/);
    // An agent host is opt-in, so no document may make one a prerequisite.
    for (const file of ['INSTALL.md', 'README.md', 'docs/MCP.md']) {
      assert.doesNotMatch(read(file), /requires? Hermes/i, `${file} must not make Hermes a prerequisite`);
    }
    const directInstall = install.search(/^## Direct install$/m);
    const connectAssistant = install.search(/^## Optional: connect an assistant$/m);
    assert.ok(directInstall > 0 && connectAssistant > directInstall,
      'installing Helm must come before connecting an assistant');
  });

  it('documents registration as verified, failing nonzero while standalone Helm survives', () => {
    for (const file of ['INSTALL.md', 'AGENT-INTEGRATIONS.md', 'docs/MCP.md']) {
      const source = read(file);
      assert.match(source, /verif(y|ies|ied)/i, `${file} must say registration is verified, not just attempted`);
      assert.match(source, /non[- ]?zero/i, `${file} must document the automation failure signal`);
      assert.match(source, /Helm remains installed|standalone Helm (?:installation )?remains/i,
        `${file} must document the recoverable standalone-install state`);
    }
    assert.doesNotMatch(read('INSTALL.md'), /registers its MCP server with you\.?"/,
      'must not promise unconditional registration');
  });

  it('gives copy-paste registration that parses and preserves external state', () => {
    // A reader pastes these verbatim, so they are checked as machine input:
    // the JSON must parse and point at the real stdio entry point, and every
    // state-dir-aware example must carry HELM_STATE_DIR or an external install
    // silently falls back to a different database.
    for (const file of ['INSTALL.md', 'AGENT-INTEGRATIONS.md']) {
      const block = jsonBlocks(read(file)).find((candidate) => candidate.includes('mcpServers'));
      assert.ok(block, `${file} must contain a fenced JSON mcpServers block`);
      const { mcpServers } = JSON.parse(block);
      assert.ok(mcpServers?.helm, `${file} must define mcpServers.helm`);
      assert.match(mcpServers.helm.command, /node$/);
      assert.ok(mcpServers.helm.args.some((argument) => String(argument).endsWith('mcp/src/index.js')),
        `${file} args must point at mcp/src/index.js`);
      assert.ok(mcpServers.helm.env?.DASHBOARD_URL, `${file} must set env.DASHBOARD_URL`);
      assert.ok(mcpServers.helm.env?.HELM_STATE_DIR, `${file} generic setup must preserve external state`);
    }
    for (const file of ['AGENT-INTEGRATIONS.md', 'docs/MCP.md']) {
      const commands = read(file).match(/hermes mcp add helm[^\n]+/g)?.join('\n') ?? '';
      // Hermes treats everything after --args as child-process arguments, so
      // the flag order below is the contract, not formatting.
      assert.match(commands,
        /hermes mcp add helm\s+--command\s+\S+\s+--env\s+DASHBOARD_URL=\S+\s+HELM_STATE_DIR=\S+\s+--args\s+\S+/,
        `${file} must give a parser-safe manual registration command`);
      assert.match(read(file), /hermes mcp test helm/, `${file} must give the verification command`);
    }
    assert.match(read('AGENT-INTEGRATIONS.md'), /enable all \d+ discovered tools/i,
      'the guide must warn about the tool-selection prompt a manual run will hit');
  });

  it('ties every host claim to the version that was actually checked', () => {
    const guide = read('AGENT-INTEGRATIONS.md');
    for (const claim of [
      /Hermes Agent `0\.18\.2`/,
      /OpenClaw `?2026\.3\.13`?/,
      /mcporter/,
      /all\s+112\s+Helm tools/i,
      /credentials? (?:remain|stay) local/i,
      /model context.*leave/i,
      /read(?:-| )back/i,
    ]) {
      assert.match(guide, claim);
    }
    // The current online OpenClaw documentation describes an `openclaw mcp`
    // command the audited release does not have. Printing it as a working
    // command is the specific failure this guards.
    for (const file of ['AGENT-INTEGRATIONS.md', 'docs/MCP.md', 'INSTALL.md']) {
      assert.doesNotMatch(read(file), /^\s*openclaw mcp/im,
        `${file} must not present an unverified openclaw mcp command`);
    }
    const section = guide.slice(guide.search(/^## 5\. OpenClaw/m));
    assert.match(section, /has no `mcp` subcommand|no native managed-MCP|lacks|not (been )?verified/i);
    assert.match(section, /mcporter/i);
    for (const file of ['README.md', 'INSTALL.md', 'docs/MCP.md']) {
      assert.match(read(file), /\[Agent integrations\]\((?:\.\.\/)?AGENT-INTEGRATIONS\.md\)/,
        `${file} must link the canonical agent-integration guide`);
    }
  });

  it('resolves every local link in packaged Markdown inside the actual portable archive', {
    // The packager builds the archive from the Git index, so it can only run in
    // a checkout. A recipient already holds the archive this proves correct.
    skip: gitOnly('rebuilding the portable archive'),
  }, () => {
    execFileSync('bash', ['scripts/package-helm.sh'], { cwd: ROOT, stdio: 'pipe' });
    const members = new Set(
      execFileSync('unzip', ['-Z1', 'dist/Helm-portable-v0.zip'], { cwd: ROOT, encoding: 'utf8' })
        .trim().split('\n'),
    );
    // Every shipped Markdown file, not a hand-kept list: a document withheld
    // from the export takes its inbound links with it, and the file that still
    // points at it is the one a recipient opens.
    const documents = [...members]
      .filter((member) => member.endsWith('.md'))
      .map((member) => member.slice('Helm/'.length));
    assert.ok(documents.includes('README.md'), 'the packaged archive must contain the README');
    for (const document of documents) {
      for (const match of read(document).matchAll(/(?<!!)\[[^\]]+\]\(([^)]+)\)/g)) {
        const target = match[1].split('#', 1)[0];
        if (!target || /^[a-z]+:/i.test(target)) continue;
        const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(document), target));
        assert.ok(
          members.has(`Helm/${resolved}`),
          `${document} links to ${resolved}, which must be present in the portable archive`,
        );
      }
    }
  });
});

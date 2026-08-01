#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { isEntrypoint, isGitWorkingTree, walkWorkingTree } from './lib/tree-context.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const SECRET_PATTERNS = [
  { label: 'private key', pattern: new RegExp('-----BEGIN (?:[A-Z ]+ )?PRI' + 'VATE KEY-----') },
  { label: 'GitHub token', pattern: new RegExp('gh' + '[pousr]_[A-Za-z0-9]{20,}') },
  { label: 'Anthropic API key', pattern: new RegExp('s' + 'k-ant-api03-[A-Za-z0-9_-]{16,}') },
  { label: 'AWS access key', pattern: new RegExp('AK' + 'IA[0-9A-Z]{16}') },
  { label: 'Stripe live key', pattern: new RegExp('s' + 'k_live_[A-Za-z0-9]{16,}') },
  { label: 'Slack token', pattern: new RegExp('xox' + '[abprs]-[A-Za-z0-9-]{16,}') },
  {
    label: 'credential assignment',
    pattern: new RegExp(
      '(?:api[_-]?(?:key|token)|access[_-]?token|auth[_-]?token|client[_-]?secret|password|secret)' +
      '[\\t ]*[:=][\\t ]*["\\\']?[A-Za-z0-9_./+=:-]{20,}',
      'i',
    ),
  },
];

function git(args, options = {}) {
  return execFileSync('git', args, {
    cwd: ROOT,
    encoding: options.encoding ?? 'utf8',
    input: options.input,
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

export function findSecretContent(buffer) {
  const text = buffer.toString('utf8');
  for (const { label, pattern } of SECRET_PATTERNS) {
    if (pattern.test(text)) return label;
  }
  return null;
}

function scanCurrentTree() {
  // An unpacked archive has no Git index, but every file the recipient received
  // is on disk. Scan that rather than fail their first command.
  const tracked = isGitWorkingTree(ROOT);
  const paths = tracked
    ? git(['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { encoding: 'buffer' })
      .toString('utf8')
      .split('\0')
      .filter(Boolean)
    : walkWorkingTree(ROOT);
  const findings = [];
  for (const relative of paths) {
    const absolute = path.join(ROOT, relative);
    if (!fs.existsSync(absolute)) continue;
    const finding = findSecretContent(fs.readFileSync(absolute));
    if (finding) findings.push(`${relative}: ${finding}`);
  }
  return {
    findings,
    scanned: paths.length,
    scope: tracked ? 'candidate working tree' : 'unpacked working tree, no Git index',
  };
}

function scanHistory() {
  const records = git(['rev-list', '--objects', '--all'])
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const separator = line.indexOf(' ');
      return separator === -1
        ? { object: line, path: '(unknown path)' }
        : { object: line.slice(0, separator), path: line.slice(separator + 1) };
    });
  const unique = new Map(records.map((record) => [record.object, record.path]));
  const objectIds = [...unique.keys()];
  const types = git(['cat-file', '--batch-check=%(objectname) %(objecttype)'], {
    input: `${objectIds.join('\n')}\n`,
  });
  const blobIds = types
    .split('\n')
    .filter((line) => line.endsWith(' blob'))
    .map((line) => line.slice(0, line.indexOf(' ')));
  const findings = [];
  for (const object of blobIds) {
    const content = git(['cat-file', 'blob', object], { encoding: 'buffer' });
    const finding = findSecretContent(content);
    if (finding) findings.push(`${object} ${unique.get(object) ?? '(unknown path)'}: ${finding}`);
  }
  return { findings, scanned: blobIds.length, scope: 'complete Git history' };
}

function main() {
  const history = process.argv.includes('--history');
  if (history && !isGitWorkingTree(ROOT)) {
    console.log('independent secret scan: history scan skipped, this tree has no Git index');
    return;
  }
  const result = history ? scanHistory() : scanCurrentTree();
  if (result.findings.length > 0) {
    console.error(`independent secret scan failed (${result.scope}):\n${result.findings.join('\n')}`);
    process.exitCode = 1;
    return;
  }
  console.log(`independent secret scan: ${result.scanned} blobs clean (${result.scope})`);
}

if (isEntrypoint(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

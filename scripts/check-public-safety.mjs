#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ARCHIVE = path.join(ROOT, 'dist', 'Helm-portable.zip');
const CHECKSUM = `${ARCHIVE}.sha256`;

const FORBIDDEN_PATH_PATTERNS = [
  /(^|\/)(?:[.]git|[.]hermes|node_modules|dist|coverage|backups?|logs?|vendor|generated)(\/|$)/i,
  /(^|\/)server\/data(\/|$)/i,
  /(^|\/)[.]env(?:$|[.](?!example$))/i,
  /(^|\/)(?:[.]dashboard-(?:token|password)|[.]mcp-http-token|[.]anthropic-key|[.]google-credentials[.]json)$/i,
  /[.](?:db|sqlite|sqlite3)(?:-wal|-shm)?$/i,
  /[.](?:log|pem|p12|pfx|key)$/i,
];

const SENSITIVE_CONTENT_PATTERNS = [
  { label: 'macOS user path', pattern: new RegExp('/Us' + 'ers/[A-Za-z0-9._-]+(?:/|$)') },
  { label: 'Unix user path', pattern: new RegExp('/ho' + 'me/[A-Za-z0-9._-]+(?:/|$)') },
  { label: 'private system path', pattern: new RegExp('/(?:opt|srv|var|tmp)/pri' + 'vate(?:/|$)') },
  { label: 'email address', pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+[.][A-Za-z]{2,}/i },
  { label: 'international phone number', pattern: /(^|[^0-9])[+][1-9][0-9]{9,14}([^0-9]|$)/ },
  {
    label: 'private hostname',
    pattern: new RegExp('(^|[^A-Za-z0-9.-])[A-Za-z0-9-]+(?:[.][A-Za-z0-9-]+)*[.]lo' + 'cal([^A-Za-z0-9.-]|$)', 'i'),
  },
];

const PORTABLE_ROOT_FILES = new Set([
  'HERMES-INSTALL.md',
  'LICENSE',
  'PRIVACY.md',
  'THIRD_PARTY_LICENSES.md',
  'install-helm.sh',
  'package-lock.json',
  'package.json',
]);
const PORTABLE_PREFIXES = ['mcp/', 'server/', 'web/'];
const PORTABLE_EXACT_FILES = new Set([
  'launchd/com.helm.app.plist.template',
  'launchd/helm-launch.sh',
  'scripts/create-demo-workspace.mjs',
]);

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: ROOT,
    encoding: options.encoding ?? 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    stdio: options.stdio ?? ['ignore', 'pipe', 'pipe'],
  });
}

export function findForbiddenPath(relativePath) {
  const normalized = relativePath.replaceAll('\\', '/');
  for (const pattern of FORBIDDEN_PATH_PATTERNS) {
    if (pattern.test(normalized)) return pattern.source;
  }
  return null;
}

export function findSensitiveContent(buffer) {
  const text = buffer
    .toString('utf8')
    .replace(new RegExp('test@' + 'example[.]com', 'gi'), '');
  for (const { label, pattern } of SENSITIVE_CONTENT_PATTERNS) {
    if (pattern.test(text)) return label;
  }
  return null;
}

export function portableArchivePathAllowed(member) {
  if (!member || member.includes('\\') || member.startsWith('/') || member.includes('\0')) return false;
  const parts = member.split('/');
  if (parts[0] !== 'Helm' || parts.some((part) => part === '..' || part === '')) return false;
  const relative = parts.slice(1).join('/');
  if (!relative || findForbiddenPath(relative)) return false;
  if (relative === 'mcp/README.md') return false;
  return PORTABLE_ROOT_FILES.has(relative) ||
    PORTABLE_EXACT_FILES.has(relative) ||
    PORTABLE_PREFIXES.some((prefix) => relative.startsWith(prefix));
}

export function summarizeAudit(report) {
  const vulnerabilities = report?.metadata?.vulnerabilities ?? {};
  const summary = {
    critical: Number(vulnerabilities.critical ?? 0),
    high: Number(vulnerabilities.high ?? 0),
    moderate: Number(vulnerabilities.moderate ?? 0),
    low: Number(vulnerabilities.low ?? 0),
  };
  return { ...summary, acceptable: summary.critical === 0 && summary.high === 0 };
}

function candidateFiles() {
  return run('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { encoding: 'buffer' })
    .toString('utf8')
    .split('\0')
    .filter(Boolean);
}

function trackedFiles() {
  return run('git', ['ls-files', '-z'], { encoding: 'buffer' })
    .toString('utf8')
    .split('\0')
    .filter(Boolean);
}

function checkTrackedSource() {
  const findings = [];
  const files = candidateFiles();
  for (const relative of files) {
    if (relative.includes('\n') || relative.includes('\r')) {
      findings.push(`${JSON.stringify(relative)}: control character in tracked path`);
      continue;
    }
    const forbidden = findForbiddenPath(relative);
    if (forbidden) findings.push(`${relative}: forbidden tracked path`);
    const absolute = path.join(ROOT, relative);
    if (!fs.existsSync(absolute)) {
      findings.push(`${relative}: tracked file is missing from the working tree`);
      continue;
    }
    const stat = fs.lstatSync(absolute);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      findings.push(`${relative}: tracked entry must be a regular non-symlink file`);
      continue;
    }
    const sensitive = findSensitiveContent(fs.readFileSync(absolute));
    if (sensitive) findings.push(`${relative}: ${sensitive}`);
  }
  if (findings.length > 0) {
    throw new Error(`public source safety scan failed:\n${findings.join('\n')}`);
  }
  return files.length;
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function buildPortableArchive() {
  run('bash', ['scripts/package-helm.sh']);
  const first = sha256(ARCHIVE);
  run('bash', ['scripts/package-helm.sh']);
  const second = sha256(ARCHIVE);
  if (first !== second) throw new Error(`portable package is not deterministic: ${first} != ${second}`);

  const checksumText = fs.readFileSync(CHECKSUM, 'utf8');
  const checksumMatch = checksumText.match(/^([a-f0-9]{64})  Helm-portable[.]zip\n$/);
  if (!checksumMatch || checksumMatch[1] !== second) throw new Error('portable package checksum file is invalid');

  const members = run('unzip', ['-Z1', ARCHIVE]).trimEnd().split('\n').filter(Boolean);
  if (members.length === 0) throw new Error('portable package is empty');
  const unsafe = members.filter((member) => !portableArchivePathAllowed(member));
  if (unsafe.length > 0) throw new Error(`unsafe portable package members:\n${unsafe.join('\n')}`);
  const expectedMembers = trackedFiles()
    .map((relative) => `Helm/${relative}`)
    .filter((member) => portableArchivePathAllowed(member))
    .sort();
  const actualMembers = [...members].sort();
  if (JSON.stringify(actualMembers) !== JSON.stringify(expectedMembers)) {
    const missing = expectedMembers.filter((member) => !actualMembers.includes(member));
    const extra = actualMembers.filter((member) => !expectedMembers.includes(member));
    throw new Error(
      `portable package content differs from the exact allow-list` +
      `\nmissing: ${missing.join(', ') || '(none)'}` +
      `\nextra: ${extra.join(', ') || '(none)'}`,
    );
  }
  for (const required of [
    'Helm/LICENSE',
    'Helm/PRIVACY.md',
    'Helm/THIRD_PARTY_LICENSES.md',
    'Helm/install-helm.sh',
    'Helm/package.json',
    'Helm/server/src/index.js',
    'Helm/web/src/main.jsx',
    'Helm/mcp/src/index.js',
  ]) {
    if (!members.includes(required)) throw new Error(`portable package is missing ${required}`);
  }
  return { checksum: second, members: members.length };
}

function main() {
  const tracked = checkTrackedSource();
  const packaged = buildPortableArchive();
  console.log(`public safety: ${tracked} candidate files scanned`);
  console.log(`portable package: ${packaged.members} members, sha256 ${packaged.checksum}`);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

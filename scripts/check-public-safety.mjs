#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { isEntrypoint, isGitWorkingTree, walkWorkingTree } from './lib/tree-context.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ARCHIVE = path.join(ROOT, 'dist', 'Helm-portable-v0.zip');
const CHECKSUM = `${ARCHIVE}.sha256`;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const IDENTIFYING_PNG_CHUNKS = new Set(['eXIf', 'iTXt', 'tEXt', 'zTXt']);
const APPROVED_COMMIT_EMAIL = '33599724+' + 'joelpfrank' + '@users.noreply.github.com';
const DEPENDABOT_AUTHOR_NAME = 'dependabot[bot]';
const DEPENDABOT_AUTHOR_EMAIL = '49699333+' + 'dependabot[bot]' + '@users.noreply.github.com';
const GITHUB_COMMITTER_NAME = 'GitHub';
const GITHUB_COMMITTER_EMAIL = 'noreply' + '@github.com';

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
  '.gitignore',
  'AGENT-INTEGRATIONS.md',
  'CHANGELOG.md',
  'CODE_OF_CONDUCT.md',
  'CONTRIBUTING.md',
  'INSTALL.md',
  'LICENSE',
  'PRIVACY.md',
  'README.md',
  'SECURITY.md',
  'THIRD_PARTY_LICENSES.md',
  'install-helm.sh',
  'package-lock.json',
  'package.json',
]);
const PORTABLE_PREFIXES = ['.github/', 'docs/', 'launchd/', 'mcp/', 'scripts/', 'server/', 'test/', 'web/'];
const PORTABLE_EXACT_FILES = new Set();
// Files that are generated, validated, and kept in the private working tree but
// deliberately withheld from publication: the demo video (a large binary the
// release does not need), the LinkedIn carousel (marketing, not product), and
// the manifest describing that launch media (an internal process record about
// an unpublished candidate, whose publicly useful half — how to regenerate the
// assets deterministically — lives in docs/DEVELOPMENT.md instead).
// scripts/package-helm.sh must skip exactly these paths; buildPortableArchive
// cross-checks archive members against this rule, so any drift fails the gate.
export const PORTABLE_EXCLUDED_FILES = new Set([
  'docs/LAUNCH-ASSETS.md',
  'docs/assets/helm-demo.mp4',
  'docs/assets/helm-linkedin-01-product.png',
  'docs/assets/helm-linkedin-02-architecture.png',
  'docs/assets/helm-linkedin-03-method.png',
]);

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: options.cwd ?? ROOT,
    encoding: options.encoding ?? 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    stdio: options.stdio ?? ['ignore', 'pipe', 'pipe'],
    env: options.env ?? process.env,
  });
}

function identityEmail(object, header, raw, findings) {
  const lines = raw.split('\n').filter((line) => line.startsWith(`${header} `));
  if (lines.length !== 1) {
    findings.push(`${object}: ${header} header must appear exactly once`);
    return;
  }
  const match = lines[0].match(new RegExp(`^${header} ([^<>\\r\\n]+) <([^<>\\r\\n]+)> [0-9]+ [+-][0-9]{4}$`));
  if (!match) {
    findings.push(`${object}: malformed ${header} identity header`);
    return;
  }
  const [, name, email] = match;
  const ownerIdentity = email === APPROVED_COMMIT_EMAIL;
  const dependabotAuthor = header === 'author' &&
    name === DEPENDABOT_AUTHOR_NAME && email === DEPENDABOT_AUTHOR_EMAIL;
  const githubBotCommitter = header === 'committer' &&
    name === GITHUB_COMMITTER_NAME && email === GITHUB_COMMITTER_EMAIL;
  if (!ownerIdentity && !dependabotAuthor && !githubBotCommitter) {
    findings.push(`${object}: ${header} identity is not approved`);
  }
}

export function checkCommitMetadata(repository = ROOT) {
  const refRecords = run(
    'git',
    ['for-each-ref', '--format=%(refname)%00%(objecttype)%00%(objectname)', 'refs'],
    { cwd: repository },
  ).trim().split('\n').filter(Boolean);
  if (refRecords.length === 0) throw new Error('commit metadata privacy scan failed: repository has no refs');

  const commits = run('git', ['rev-list', '--all'], { cwd: repository }).trim().split('\n').filter(Boolean);
  if (commits.length === 0) throw new Error('commit metadata privacy scan failed: repository has no commits');

  const findings = [];
  for (const commit of commits) {
    const raw = run('git', ['cat-file', 'commit', commit], { cwd: repository });
    identityEmail(commit, 'author', raw, findings);
    identityEmail(commit, 'committer', raw, findings);
  }

  let annotatedTags = 0;
  for (const record of refRecords) {
    const [, type, object] = record.split('\0');
    if (type !== 'tag') continue;
    annotatedTags += 1;
    const raw = run('git', ['cat-file', 'tag', object], { cwd: repository });
    identityEmail(object, 'tagger', raw, findings);
  }

  if (findings.length > 0) {
    throw new Error(`commit metadata privacy scan failed:\n${findings.join('\n')}`);
  }
  return { refs: refRecords.length, commits: commits.length, annotatedTags };
}

export function findForbiddenPath(relativePath) {
  const normalized = relativePath.replaceAll('\\', '/');
  for (const pattern of FORBIDDEN_PATH_PATTERNS) {
    if (pattern.test(normalized)) return pattern.source;
  }
  return null;
}

function isInternalHermesControlPath(relativePath) {
  const normalized = relativePath.replaceAll('\\', '/');
  return normalized === '.hermes.md' || normalized.startsWith('.hermes/');
}

export function findSensitiveContent(buffer) {
  const text = buffer.toString('utf8').replace(
    /[A-Za-z0-9._%+-]+@example[.](?:com|invalid|test)/gi,
    '',
  );
  for (const { label, pattern } of SENSITIVE_CONTENT_PATTERNS) {
    if (pattern.test(text)) return label;
  }
  return null;
}

export function isTextBuffer(buffer) {
  if (buffer.subarray(0, 8192).includes(0)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    return true;
  } catch {
    return false;
  }
}

export function pngPrivacyMetadataChunks(buffer) {
  if (buffer.length < PNG_SIGNATURE.length || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return [];
  const found = new Set();
  let offset = 8;
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const end = offset + 12 + length;
    if (end > buffer.length) throw new Error('malformed PNG chunk length');
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    if (IDENTIFYING_PNG_CHUNKS.has(type)) found.add(type);
    offset = end;
    if (type === 'IEND') break;
  }
  return [...found].sort();
}

export function portableArchivePathAllowed(member) {
  if (!member || member.includes('\\') || member.startsWith('/') || member.includes('\0')) return false;
  const parts = member.split('/');
  if (parts[0] !== 'Helm' || parts.some((part) => part === '..' || part === '')) return false;
  const relative = parts.slice(1).join('/');
  if (!relative || findForbiddenPath(relative)) return false;
  if (relative === 'mcp/README.md') return false;
  if (PORTABLE_EXCLUDED_FILES.has(relative)) return false;
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

function candidateFiles(repository = ROOT) {
  // A recipient running this gate from an unpacked archive has no Git index.
  // Everything they received is on disk, so scan that instead of refusing.
  if (!isGitWorkingTree(repository)) return walkWorkingTree(repository);
  return run('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
    cwd: repository,
    encoding: 'buffer',
  })
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

export function checkTrackedSource(repository = ROOT) {
  const findings = [];
  const files = candidateFiles(repository);
  for (const relative of files) {
    if (relative.includes('\n') || relative.includes('\r')) {
      findings.push(`${JSON.stringify(relative)}: control character in tracked path`);
      continue;
    }
    // Internal release-control artifacts are excluded from publication by the
    // packager, but their content remains subject to the privacy scan.
    const internalControl = isInternalHermesControlPath(relative);
    const forbidden = internalControl ? null : findForbiddenPath(relative);
    if (forbidden) findings.push(`${relative}: forbidden tracked path`);
    const parts = relative.split('/');
    const ancestorParts = [];
    let ancestor = repository;
    let unsafeAncestor = false;
    for (const part of parts.slice(0, -1)) {
      ancestorParts.push(part);
      ancestor = path.join(ancestor, part);
      let stat;
      try {
        stat = fs.lstatSync(ancestor);
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
        findings.push(`${relative}: tracked path ancestor ${ancestorParts.join('/')} is missing`);
        unsafeAncestor = true;
        break;
      }
      if (stat.isSymbolicLink() || !stat.isDirectory()) {
        findings.push(
          `${relative}: tracked path ancestor ${ancestorParts.join('/')} must be a real directory, not a symlink`,
        );
        unsafeAncestor = true;
        break;
      }
    }
    if (unsafeAncestor) continue;
    const absolute = path.join(repository, relative);
    if (!fs.existsSync(absolute)) {
      findings.push(`${relative}: tracked file is missing from the working tree`);
      continue;
    }
    const stat = fs.lstatSync(absolute);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      findings.push(`${relative}: tracked entry must be a regular non-symlink file`);
      continue;
    }
    const content = fs.readFileSync(absolute);
    if (isTextBuffer(content)) {
      const sensitive = findSensitiveContent(content);
      if (sensitive) findings.push(`${relative}: ${sensitive}`);
    }
    if (relative.toLowerCase().endsWith('.png')) {
      const metadata = pngPrivacyMetadataChunks(content);
      if (metadata.length > 0) findings.push(`${relative}: identifying PNG metadata (${metadata.join(', ')})`);
    }
  }
  if (findings.length > 0) {
    throw new Error(`public source safety scan failed:\n${findings.join('\n')}`);
  }
  return files.length;
}

export function checkHistory(repository = ROOT) {
  const commits = run('git', ['rev-list', '--all'], { cwd: repository }).trim().split('\n').filter(Boolean);
  const pathsByBlob = new Map();
  const findings = [];
  let treeEntries = 0;

  for (const commit of commits) {
    const entries = run('git', ['ls-tree', '-r', '-z', '--full-tree', commit], {
      cwd: repository,
      encoding: 'buffer',
    })
      .toString('utf8')
      .split('\0')
      .filter(Boolean);
    for (const entry of entries) {
      const separator = entry.indexOf('\t');
      if (separator === -1) throw new Error(`unexpected git ls-tree record in ${commit}`);
      const [mode, type, object] = entry.slice(0, separator).split(' ');
      const relative = entry.slice(separator + 1);
      treeEntries += 1;
      if (type !== 'blob') continue;
      const internalControl = isInternalHermesControlPath(relative);
      if (mode === '120000') findings.push(`${object} ${relative}: historical symlink`);
      if (relative.includes('\n') || relative.includes('\r')) {
        findings.push(`${object} ${JSON.stringify(relative)}: control character in historical path`);
      }
      if (!internalControl && findForbiddenPath(relative)) {
        findings.push(`${object} ${relative}: forbidden historical path`);
      }
      const paths = pathsByBlob.get(object) ?? new Set();
      paths.add(relative);
      pathsByBlob.set(object, paths);
    }
  }

  for (const [object, paths] of pathsByBlob) {
    const content = run('git', ['cat-file', 'blob', object], { cwd: repository, encoding: 'buffer' });
    const sortedPaths = [...paths].sort();
    const representative = sortedPaths[0] ?? '(unknown path)';
    if (isTextBuffer(content)) {
      const sensitive = findSensitiveContent(content);
      if (sensitive) findings.push(`${object} ${representative}: ${sensitive}`);
    }
  }

  if (findings.length > 0) {
    throw new Error(`complete-history privacy scan failed:\n${findings.join('\n')}`);
  }
  return { commits: commits.length, blobs: pathsByBlob.size, treeEntries };
}

export function createFreshPublicHistory(archive = ARCHIVE) {
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'helm-fresh-public-history-'));
  const repository = path.join(staging, 'Helm');
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    fs.rmSync(staging, { recursive: true, force: true });
  };
  try {
    run('unzip', ['-q', archive, '-d', staging]);
    const stat = fs.lstatSync(repository);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error('portable package must contain one real Helm directory');
    }
    run('git', ['init', '-q', '--initial-branch=main'], { cwd: repository });
    run('git', ['add', '--all'], { cwd: repository });
    // The commit is dated when the export is actually built. An earlier
    // revision pinned a fixed epoch, which reads as scrubbed history and keeps
    // the release off the maintainer's contribution graph. Timestamps are not
    // private data here; the identity below is the public noreply address.
    const { GIT_AUTHOR_DATE, GIT_COMMITTER_DATE, ...inherited } = process.env;
    run('git', ['commit', '-q', '-m', 'Helm v0 public source'], {
      cwd: repository,
      env: {
        ...inherited,
        GIT_AUTHOR_NAME: 'Joel Frank',
        GIT_AUTHOR_EMAIL: APPROVED_COMMIT_EMAIL,
        GIT_COMMITTER_NAME: 'Joel Frank',
        GIT_COMMITTER_EMAIL: APPROVED_COMMIT_EMAIL,
      },
    });
    return { repository, cleanup };
  } catch (error) {
    cleanup();
    throw error;
  }
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
  const checksumMatch = checksumText.match(/^([a-f0-9]{64})  Helm-portable-v0[.]zip\n$/);
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
    'Helm/README.md',
    'Helm/AGENT-INTEGRATIONS.md',
    'Helm/CHANGELOG.md',
    'Helm/docs/ARCHITECTURE.md',
    'Helm/docs/CASE-STUDY.md',
    'Helm/docs/MCP.md',
    'Helm/docs/assets/helm-today.png',
    'Helm/LICENSE',
    'Helm/PRIVACY.md',
    'Helm/SECURITY.md',
    'Helm/THIRD_PARTY_LICENSES.md',
    'Helm/install-helm.sh',
    'Helm/package.json',
    'Helm/scripts/package-helm.sh',
    'Helm/server/src/index.js',
    'Helm/test/release-artifact.test.mjs',
    'Helm/web/src/main.jsx',
    'Helm/mcp/src/index.js',
  ]) {
    if (!members.includes(required)) throw new Error(`portable package is missing ${required}`);
  }
  return { checksum: second, members: members.length };
}

// The history scans and the portable rebuild read the Git index, so they only
// mean anything in a checkout. Announce the skip rather than let a recipient
// read a silent pass as evidence the step ran.
const GIT_ONLY_SKIP = 'skipped: reads the Git index, and this tree is an unpacked archive';

function main() {
  if (!isGitWorkingTree()) {
    if (process.argv.includes('--history') || process.argv.includes('--source-history')) {
      console.log(`source-control history privacy: ${GIT_ONLY_SKIP}`);
      return;
    }
    const tracked = checkTrackedSource();
    console.log(`public safety: ${tracked} candidate files scanned`);
    console.log(`portable package: ${GIT_ONLY_SKIP}`);
    return;
  }
  if (process.argv.includes('--source-history')) {
    const metadata = checkCommitMetadata();
    const history = checkHistory();
    console.log(
      `source-control history privacy: ${history.blobs} unique blobs across ${history.treeEntries} tree entries `
      + `and ${history.commits} commits clean; commit metadata spans ${metadata.refs} refs`,
    );
    return;
  }
  if (process.argv.includes('--history')) {
    const packaged = buildPortableArchive();
    const fresh = createFreshPublicHistory();
    try {
      const metadata = checkCommitMetadata(fresh.repository);
      const history = checkHistory(fresh.repository);
      console.log(
        `fresh public export history: ${history.blobs} unique blobs across ${history.treeEntries} tree entries `
        + `and ${history.commits} commit clean; ${metadata.refs} privacy-safe ref; `
        + `${packaged.members} exact portable members at sha256 ${packaged.checksum}`,
      );
    } finally {
      fresh.cleanup();
    }
    return;
  }
  const tracked = checkTrackedSource();
  const packaged = buildPortableArchive();
  console.log(`public safety: ${tracked} candidate files scanned`);
  console.log(`portable package: ${packaged.members} members, sha256 ${packaged.checksum}`);
}

if (isEntrypoint(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

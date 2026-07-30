// External state-directory contract.
//
// Every mutable or private runtime file Helm owns — the SQLite database, the
// dashboard bearer token, the UI password record, the MCP HTTP token, Google
// OAuth client credentials, and the optional Anthropic key — resolves through
// this module. When HELM_STATE_DIR is set (an absolute path), they all live
// under it, outside the replaceable product tree, so a code upgrade can swap
// the install prefix without ever touching user state. When it is unset (or
// empty), every path falls back to its historical repository-local location,
// so existing installs keep working unchanged.
//
// Layout under HELM_STATE_DIR:
//   data/dashboard.db (+ -wal/-shm, pid, log)   .dashboard-token
//   .dashboard-password   .mcp-http-token   .google-credentials.json
//   .anthropic-key
//
// All functions take an optional env object (defaults to process.env) and
// resolve at call time, never at import time, so a long-lived process and the
// test suite observe the same rules.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// server/src/lib -> project root
const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');

function physicalPath(input) {
  const absolute = path.resolve(input);
  let existing = absolute;
  const tail = [];
  for (;;) {
    try {
      const real = fs.realpathSync(existing);
      return tail.length ? path.join(real, ...tail.reverse()) : real;
    } catch (err) {
      if (err.code !== 'ENOENT' && err.code !== 'ENOTDIR') throw err;
      const parent = path.dirname(existing);
      if (parent === existing) throw err;
      tail.push(path.basename(existing));
      existing = parent;
    }
  }
}

function pathsOverlap(left, right) {
  return left === right
    || (left + path.sep).startsWith(right + path.sep)
    || (right + path.sep).startsWith(left + path.sep);
}

export function stateRoot(env = process.env) {
  const raw = env.HELM_STATE_DIR;
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\0-\x1f\x7f]/.test(trimmed)) {
    throw new Error('HELM_STATE_DIR must not contain control characters');
  }
  if (!path.isAbsolute(trimmed)) {
    throw new Error(`HELM_STATE_DIR must be an absolute path, got: ${trimmed}`);
  }
  const resolved = path.resolve(trimmed);
  if (pathsOverlap(physicalPath(resolved), physicalPath(PROJECT_ROOT))) {
    throw new Error('HELM_STATE_DIR must be outside the replaceable product tree');
  }
  return resolved;
}

// Create the state root (and its data/ subdirectory) with owner-only
// permissions. No-op returning null in the legacy layout, where the existing
// project-root/server-data locations already exist.
export function ensureStateDir(env = process.env, fileSystem = fs) {
  const root = stateRoot(env);
  if (!root) return null;
  for (const dir of [root, path.join(root, 'data')]) {
    fileSystem.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const st = fileSystem.statSync(dir);
    if (!st.isDirectory()) {
      throw new Error(`state path exists but is not a directory: ${dir}`);
    }
    fileSystem.chmodSync(dir, 0o700);
  }
  return root;
}

function resolveState(env, stateRelative, legacyAbsolute) {
  const root = stateRoot(env);
  return root ? path.join(root, stateRelative) : legacyAbsolute;
}

// Directory for the database and runtime artifacts (pidfile, log).
export function dataDir(env = process.env) {
  return resolveState(env, 'data', path.join(PROJECT_ROOT, 'server', 'data'));
}

export function dbPath(env = process.env) {
  // The narrower override wins: DASHBOARD_DB_PATH points a throwaway/test
  // instance at an isolated DB regardless of the state-dir contract.
  if (env.DASHBOARD_DB_PATH) return path.resolve(env.DASHBOARD_DB_PATH);
  return path.join(dataDir(env), 'dashboard.db');
}

export function dashboardTokenPath(env = process.env) {
  return resolveState(env, '.dashboard-token', path.join(PROJECT_ROOT, '.dashboard-token'));
}

export function passwordFilePath(env = process.env) {
  return resolveState(env, '.dashboard-password', path.join(PROJECT_ROOT, '.dashboard-password'));
}

export function mcpHttpTokenPath(env = process.env) {
  return resolveState(env, '.mcp-http-token', path.join(PROJECT_ROOT, '.mcp-http-token'));
}

export function googleCredentialsPath(env = process.env) {
  return resolveState(env, '.google-credentials.json', path.join(PROJECT_ROOT, '.google-credentials.json'));
}

export function anthropicKeyPath(env = process.env) {
  return resolveState(env, '.anthropic-key', path.join(PROJECT_ROOT, '.anthropic-key'));
}

#!/usr/bin/env node
// Copy-only legacy-state migration.
//
// Copies Helm's known mutable/private files from a legacy in-prefix layout
// into an external HELM_STATE_DIR layout (see server/src/lib/state-paths.js
// for the target shape). Dry-run by default; --apply is required to write
// anything. This utility never deletes or modifies the legacy source — its
// rollback is simply reverting your service configuration (unset
// HELM_STATE_DIR / point the service back at the legacy layout), not undoing
// a file operation, because nothing at the legacy location is ever changed.
//
// Usage:
//   node scripts/migrate-state.mjs --from LEGACY_ROOT --to STATE_DIR [--apply]
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

function fail(message) {
  console.error(message);
  process.exit(1);
}

function parseArgs(argv) {
  const args = { apply: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--from') args.from = argv[++i];
    else if (a === '--to') args.to = argv[++i];
    else if (a === '--apply') args.apply = true;
    else fail(`unknown argument: ${a}`);
  }
  if (!args.from || !args.to) {
    fail('usage: migrate-state.mjs --from LEGACY_ROOT --to STATE_DIR [--apply]');
  }
  return args;
}

// [legacy-relative source, state-dir-relative destination]
const STATE_FILES = [
  ['server/data/dashboard.db', 'data/dashboard.db'],
  ['server/data/dashboard.db-wal', 'data/dashboard.db-wal'],
  ['server/data/dashboard.db-shm', 'data/dashboard.db-shm'],
  ['.dashboard-token', '.dashboard-token'],
  ['.dashboard-password', '.dashboard-password'],
  ['.mcp-http-token', '.mcp-http-token'],
  ['.google-credentials.json', '.google-credentials.json'],
  ['.anthropic-key', '.anthropic-key'],
];

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

// Resolve the physical (symlink-free) form of a path for safety comparisons,
// without requiring the path to exist. A symlinked ancestor can make two
// textually-disjoint paths (e.g. --from through an alias, --to through the
// alias's real target) name overlapping physical subtrees; string-only
// comparison of path.resolve() output misses that. Walk up to the deepest
// existing ancestor, realpath it, then re-append the non-existent tail.
function physicalPath(input) {
  const abs = path.resolve(input);
  let existing = abs;
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

// A relative argv[1] (e.g. a shell launched with `cwd: fromRoot` running
// `node server/src/index.js`) never contains the absolute entrypoint, so the
// textual match below misses it. Recognize the relative form too, then
// confirm it by resolving that pid's cwd — narrow enough to avoid flagging
// an unrelated process that merely happens to run a same-named script.
const RELATIVE_ENTRYPOINT = path.join('server', 'src', 'index.js');
const RELATIVE_ENTRYPOINT_PATTERN = new RegExp(
  `(^|[\\s/\\\\])${RELATIVE_ENTRYPOINT.replace(/[\\/.]/g, '\\$&')}(?=[\\s]|$)`,
);

function processCwd(pid) {
  const lsof = spawnSync('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'], {
    encoding: 'utf8', timeout: 5_000,
  });
  // Distinguish an unavailable inspector from a process that vanished between
  // ps and lsof. Only the former is uncertainty that must fail closed.
  if (lsof.error?.code === 'ENOENT' || lsof.status === 126 || lsof.status === 127) {
    return { unavailable: true };
  }
  if (lsof.status !== 0 || lsof.error) return null;
  const line = lsof.stdout.split('\n').find((l) => l.startsWith('n'));
  return line ? line.slice(1) : null;
}

function legacyServiceRunning(fromRoot) {
  const pidFile = path.join(fromRoot, 'server', 'data', 'helm.pid');
  if (fs.existsSync(pidFile)) {
    const pid = parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10);
    if (Number.isInteger(pid) && pid > 0) {
      try {
        process.kill(pid, 0);
        return true;
      } catch {}
    }
  }

  // A LaunchAgent can run server/src/index.js directly and therefore never
  // create start.sh's pidfile. Inspect the process table for the exact legacy
  // entrypoint as a second guard. Helm is macOS-first; if `ps` itself cannot be
  // inspected, fail closed rather than risk copying a live SQLite/WAL pair.
  const entrypoint = path.join(fromRoot, 'server', 'src', 'index.js');
  const ps = spawnSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8', timeout: 5_000 });
  if (ps.status !== 0 || ps.error) return true;
  return ps.stdout.split('\n').some((line) => {
    const match = line.match(/^\s*(\d+)\s+(.*)$/);
    if (!match || Number(match[1]) === process.pid) return false;
    const [, pid, command] = match;
    if (command.includes(entrypoint)) return true;
    if (!RELATIVE_ENTRYPOINT_PATTERN.test(command)) return false;
    const cwd = processCwd(pid);
    // A matching relative entrypoint is unsafe to dismiss when cwd inspection
    // is unavailable (for example lsof missing/denied). Prefer a conservative
    // refusal over copying an active SQLite/WAL pair.
    if (cwd?.unavailable) return true;
    if (cwd == null) return false;
    return physicalPath(path.resolve(cwd, RELATIVE_ENTRYPOINT)) === physicalPath(entrypoint);
  });
}

function main() {
  const { from, to, apply } = parseArgs(process.argv.slice(2));

  if (!path.isAbsolute(from)) fail(`--from must be an absolute path, got: ${from}`);
  if (!path.isAbsolute(to)) fail(`--to must be an absolute path, got: ${to}`);
  const fromRoot = path.resolve(from);
  const toRoot = path.resolve(to);
  const fromRootPhysical = physicalPath(from);
  const toRootPhysical = physicalPath(to);
  if (fromRootPhysical === toRootPhysical) fail('--to must differ from --from');
  if ((toRootPhysical + path.sep).startsWith(fromRootPhysical + path.sep)) {
    fail('--to must not be nested inside --from');
  }
  if ((fromRootPhysical + path.sep).startsWith(toRootPhysical + path.sep)) {
    fail('--from must not be nested inside --to');
  }
  if (!fs.existsSync(fromRoot) || !fs.statSync(fromRoot).isDirectory()) {
    fail(`--from is not an existing directory: ${fromRoot}`);
  }

  if (legacyServiceRunning(fromRoot)) {
    fail(
      `refusing to migrate: the legacy Helm service appears to be running ` +
      `(pidfile ${path.join(fromRoot, 'server', 'data', 'helm.pid')}). Stop it first, then re-run.`,
    );
  }

  const present = STATE_FILES
    .map(([srcRel, destRel]) => ({
      srcRel, destRel,
      src: path.join(fromRoot, srcRel),
      dest: path.join(toRoot, destRel),
    }))
    .filter((f) => fs.existsSync(f.src));

  if (present.length === 0) {
    fail(`no Helm state files found under legacy root: ${fromRoot}`);
  }

  if (!apply) {
    console.log(`dry-run: would copy ${present.length} state file(s)`);
    console.log(`  from: ${fromRoot}`);
    console.log(`  to:   ${toRoot}`);
    for (const f of present) console.log(`  ${f.srcRel} -> ${f.destRel}`);
    console.log('re-run with --apply to copy. Originals are never modified or deleted.');
    return;
  }

  const collisions = present.filter((f) => fs.existsSync(f.dest));
  if (collisions.length > 0) {
    fail(
      `destination collision; refusing to overwrite existing state:\n` +
      collisions.map((f) => `  ${f.dest}`).join('\n'),
    );
  }

  fs.mkdirSync(path.join(toRoot, 'data'), { recursive: true, mode: 0o700 });
  fs.chmodSync(toRoot, 0o700);
  fs.chmodSync(path.join(toRoot, 'data'), 0o700);

  const copied = [];
  try {
    for (const f of present) {
      fs.mkdirSync(path.dirname(f.dest), { recursive: true, mode: 0o700 });
      fs.copyFileSync(f.src, f.dest);
      fs.chmodSync(f.dest, 0o600);
      copied.push(f);

      // Test-only hook: simulate a corrupted copy to exercise verification.
      if (process.env.HELM_MIGRATE_TEST_CORRUPT === f.srcRel) {
        fs.appendFileSync(f.dest, 'CORRUPT');
      }

      if (sha256(f.src) !== sha256(f.dest)) {
        throw new Error(`verification failed for ${f.destRel}: copied bytes do not match the source`);
      }
    }
  } catch (err) {
    // Roll back only this attempt's own copies; the legacy source is never
    // touched, so nothing here can lose data.
    for (const f of copied) {
      try { fs.rmSync(f.dest, { force: true }); } catch {}
    }
    fail(err.message);
  }

  console.log(`verified ${copied.length} file(s) copied byte-for-byte into ${toRoot}`);
  console.log('originals at the legacy location were left untouched.');
  console.log('rollback: this migration only copies files and never deletes the legacy');
  console.log('originals, so rollback means reverting service configuration (unset');
  console.log('HELM_STATE_DIR / point the service back at the legacy layout) — not undoing');
  console.log('a file operation.');
}

main();

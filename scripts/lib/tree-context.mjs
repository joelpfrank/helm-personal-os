// Helm ships its own release gate to every recipient, so the gate has to know
// which kind of tree it is running in. Three exist:
//
//   maintainer checkout — this repository, with `.hermes` build control, the
//     development start/stop helpers, and the local-only demo media.
//   public clone — the published repository: a Git tree with none of that.
//   unpacked archive — Helm-portable-v0.zip, which carries no Git tree at all.
//
// Checks that read the Git index, or maintainer-only files, must degrade to an
// explicit skip outside the maintainer checkout. Failing a recipient on files
// they were never sent turns their first command into a false alarm.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * True when `moduleUrl` is the script Node was asked to run.
 * Node reports `import.meta.url` as the real path, so the invoked path has to
 * be resolved through symlinks too: on macOS `/tmp` and `/var/folders` are both
 * symlinked, and comparing the two forms silently turned a gate into a no-op
 * that printed nothing and exited 0.
 */
export function isEntrypoint(moduleUrl) {
  const invoked = process.argv[1];
  if (!invoked) return false;
  const absolute = path.resolve(invoked);
  let real = absolute;
  try {
    real = fs.realpathSync(absolute);
  } catch {
    // A deleted or unreadable entry path cannot be this module.
    return false;
  }
  return pathToFileURL(real).href === moduleUrl;
}

/** True when `root` is a Git working tree. A linked worktree stores `.git` as a file. */
export function isGitWorkingTree(root = REPO_ROOT) {
  return fs.existsSync(path.join(root, '.git'));
}

/** True when `root` is the private maintainer checkout rather than a published copy. */
export function isMaintainerCheckout(root = REPO_ROOT) {
  return fs.existsSync(path.join(root, '.hermes.md')) && fs.existsSync(path.join(root, '.hermes'));
}

/**
 * Skip reason for a check that reads the Git index, or `false` to run it.
 * The shape matches the `skip` option of `node:test`.
 */
export function gitOnly(what, root = REPO_ROOT) {
  if (isGitWorkingTree(root)) return false;
  return `${what} reads the Git index; this tree is an unpacked archive`;
}

/** Skip reason for a check that reads maintainer-only files, or `false` to run it. */
export function maintainerOnly(what, root = REPO_ROOT) {
  if (isMaintainerCheckout(root)) return false;
  return `${what} inspects maintainer-only files that the public export withholds`;
}

const IGNORED_DIRECTORIES = new Set([
  '.git',
  'node_modules',
  'dist',
  'coverage',
  '.playwright',
]);

/**
 * Relative paths of every file in `root`, for trees with no Git index to ask.
 * Deterministically ordered so callers report the same findings run to run.
 */
export function walkWorkingTree(root = REPO_ROOT) {
  const files = [];
  const visit = (relativeDirectory) => {
    const absolute = relativeDirectory ? path.join(root, relativeDirectory) : root;
    const entries = fs.readdirSync(absolute, { withFileTypes: true })
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      const relative = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (IGNORED_DIRECTORIES.has(entry.name)) continue;
        visit(relative);
        continue;
      }
      if (entry.isFile()) files.push(relative);
    }
  };
  visit('');
  return files;
}

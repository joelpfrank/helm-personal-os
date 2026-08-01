import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ensureStateDir, stateRoot } from './state-paths.js';

const PROFILE_ID = /^[a-z][a-z0-9-]*:[a-z][a-z0-9-]*$/;
const OWNER_DIR_MODE = 0o700;
const OWNER_LOCKED_DIR_MODE = 0o500;
const OWNER_FILE_MODE = 0o600;
// Exported read-only so documentation checks can assert against the real map
// rather than a second copy of it that can drift.
export const PROFILE_ENV_KEYS = Object.freeze({
  'anthropic:api': ['ANTHROPIC_API_KEY'],
  'openai:api': ['OPENAI_API_KEY'],
  'google:gemini-api': ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
  'openrouter:api': ['OPENROUTER_API_KEY'],
});

function validateProfileId(profileId) {
  if (typeof profileId !== 'string' || !PROFILE_ID.test(profileId)) {
    throw new Error('provider profile id must use provider:profile syntax');
  }
  return profileId;
}

function fileName(profileId) {
  return `${validateProfileId(profileId).replace(':', '--')}.secret`;
}

function safeStatus(profileId, configured) {
  return Object.freeze({ profileId, configured });
}

function currentUid() {
  return typeof process.getuid === 'function' ? process.getuid() : null;
}

function identity(stat) {
  return `${stat.dev}:${stat.ino}`;
}

function assertOwnerMode(stat, mode, kind) {
  const uid = currentUid();
  if (uid != null && stat.uid !== uid) throw new Error(`provider secret ${kind} must be owned by the current user`);
  if ((stat.mode & 0o777) !== mode) throw new Error(`provider secret ${kind} permissions must be ${mode.toString(8)}`);
}

function assertNoUserControlledSymlinkComponents(fileSystem, absolute) {
  const parsed = path.parse(absolute);
  let cursor = parsed.root;
  for (const part of absolute.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part);
    try {
      const stat = fileSystem.lstatSync(cursor);
      if (stat.isSymbolicLink()) {
        const parent = fileSystem.statSync(path.dirname(cursor));
        const uid = currentUid();
        const userControlled = uid == null
          || stat.uid === uid
          || parent.uid === uid
          || (parent.mode & 0o022) !== 0;
        if (userControlled) {
          throw new Error(`provider secret path component must not be a user-controlled symbolic link: ${cursor}`);
        }
      }
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
  }
}

// Internal provider adapters may resolve credential bytes, but the browser-
// facing store deliberately exposes no read method. Environment values remain
// the compatibility override; UI-saved credentials stay in protected state.
export function resolveProviderCredential(profileId, env = process.env, fileSystem = fs) {
  validateProfileId(profileId);
  for (const key of PROFILE_ENV_KEYS[profileId] || []) {
    const value = env[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  const root = stateRoot(env);
  if (!root) return null;
  const secretDir = path.join(root, 'provider-secrets');
  const destination = path.join(secretDir, fileName(profileId));
  let handle;
  try {
    assertNoUserControlledSymlinkComponents(fileSystem, root);
    const rootStat = fileSystem.lstatSync(root);
    const dirStat = fileSystem.lstatSync(secretDir);
    if (rootStat.isSymbolicLink() || dirStat.isSymbolicLink()
        || !rootStat.isDirectory() || !dirStat.isDirectory()) return null;
    assertOwnerMode(rootStat, OWNER_DIR_MODE, 'state directory');
    assertOwnerMode(dirStat, OWNER_DIR_MODE, 'directory');
    handle = fileSystem.openSync(destination, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    const entry = fileSystem.fstatSync(handle);
    assertOwnerMode(entry, OWNER_FILE_MODE, 'file');
    if (!entry.isFile() || entry.size <= 0) return null;
    const value = fileSystem.readFileSync(handle, 'utf8');
    return value.trim() ? value : null;
  } catch (error) {
    if (error.code === 'ENOENT' || /owned|permissions/.test(error.message)) return null;
    throw error;
  } finally {
    if (handle != null) fileSystem.closeSync(handle);
  }
}

export function createProviderSecretStore({ env = process.env, fileSystem = fs } = {}) {
  const root = stateRoot(env);
  if (!root) throw new Error('HELM_STATE_DIR is required for external provider credentials');
  const secretDir = path.join(root, 'provider-secrets');

  function checkedSecretDir({ create = false, statusOnly = false } = {}) {
    try {
      assertNoUserControlledSymlinkComponents(fileSystem, root);
      try {
        const initialRoot = fileSystem.lstatSync(root);
        if (initialRoot.isSymbolicLink()) throw new Error('provider state root must not be a symbolic link');
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      if (create) ensureStateDir(env, fileSystem);
      const rootStat = fileSystem.lstatSync(root);
      if (rootStat.isSymbolicLink()) throw new Error('provider state root must not be a symbolic link');
      if (!rootStat.isDirectory()) throw new Error('provider state root must be a directory');
      assertOwnerMode(rootStat, OWNER_DIR_MODE, 'state directory');

      try {
        const existing = fileSystem.lstatSync(secretDir);
        if (existing.isSymbolicLink()) throw new Error('provider secret directory must not be a symbolic link');
        if (!existing.isDirectory()) throw new Error('provider secret path must be a directory');
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        if (!create) return null;
        fileSystem.mkdirSync(secretDir, { mode: OWNER_DIR_MODE });
      }
      if (create) fileSystem.chmodSync(secretDir, OWNER_DIR_MODE);
      const dirStat = fileSystem.lstatSync(secretDir);
      if (dirStat.isSymbolicLink() || !dirStat.isDirectory()) throw new Error('provider secret path must be a non-symlink directory');
      assertOwnerMode(dirStat, OWNER_DIR_MODE, 'directory');
      return { path: secretDir, rootIdentity: identity(rootStat), dirIdentity: identity(dirStat) };
    } catch (error) {
      if (statusOnly && /owned|permissions/.test(error.message)) return null;
      throw error;
    }
  }

  function assertDirectoriesUnchanged(snapshot, rootMode = OWNER_DIR_MODE) {
    const rootStat = fileSystem.lstatSync(root);
    const dirStat = fileSystem.lstatSync(secretDir);
    if (rootStat.isSymbolicLink() || dirStat.isSymbolicLink()
        || identity(rootStat) !== snapshot.rootIdentity || identity(dirStat) !== snapshot.dirIdentity) {
      throw new Error('provider secret directory changed during operation');
    }
    assertOwnerMode(rootStat, rootMode, 'state directory');
    assertOwnerMode(dirStat, OWNER_DIR_MODE, 'directory');
  }

  function credentialPath(profileId) {
    return path.join(secretDir, fileName(profileId));
  }

  function openVerifiedRoot(snapshot) {
    const handle = fileSystem.openSync(root, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
    try {
      const stat = fileSystem.fstatSync(handle);
      if (!stat.isDirectory() || identity(stat) !== snapshot.rootIdentity) {
        throw new Error('provider secret directory changed during operation');
      }
      assertOwnerMode(stat, OWNER_DIR_MODE, 'state directory');
      return handle;
    } catch (error) {
      fileSystem.closeSync(handle);
      throw error;
    }
  }

  return Object.freeze({
    put(profileId, value) {
      validateProfileId(profileId);
      if (typeof value !== 'string' || !value.trim()) throw new Error('provider credential must be a non-empty string');
      const snapshot = checkedSecretDir({ create: true });
      const destination = credentialPath(profileId);
      const temporary = path.join(secretDir, `.${fileName(profileId)}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`);
      let handle;
      let rootHandle;
      let rootLocked = false;
      try {
        assertDirectoriesUnchanged(snapshot);
        rootHandle = openVerifiedRoot(snapshot);
        handle = fileSystem.openSync(temporary, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, OWNER_FILE_MODE);
        assertDirectoriesUnchanged(snapshot);
        const bytes = Buffer.from(value, 'utf8');
        fileSystem.writeSync(handle, bytes, 0, 0, null);
        assertDirectoriesUnchanged(snapshot);
        fileSystem.fchmodSync(rootHandle, OWNER_LOCKED_DIR_MODE);
        rootLocked = true;
        assertDirectoriesUnchanged(snapshot, OWNER_LOCKED_DIR_MODE);
        let offset = 0;
        while (offset < bytes.length) {
          const written = fileSystem.writeSync(
            handle,
            bytes,
            offset,
            bytes.length - offset,
            null,
          );
          if (!Number.isInteger(written) || written <= 0) throw new Error('provider credential write failed');
          offset += written;
          assertDirectoriesUnchanged(snapshot, OWNER_LOCKED_DIR_MODE);
        }
        fileSystem.fsyncSync(handle);
        assertOwnerMode(fileSystem.fstatSync(handle), OWNER_FILE_MODE, 'temporary file');
        fileSystem.closeSync(handle);
        handle = null;
        assertDirectoriesUnchanged(snapshot, OWNER_LOCKED_DIR_MODE);
        fileSystem.renameSync(temporary, destination);
        const destinationHandle = fileSystem.openSync(destination, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
        try {
          const destinationStat = fileSystem.fstatSync(destinationHandle);
          assertOwnerMode(destinationStat, OWNER_FILE_MODE, 'file');
          if (destinationStat.size <= 0) throw new Error('provider credential file is empty');
        } finally {
          fileSystem.closeSync(destinationHandle);
        }
        assertDirectoriesUnchanged(snapshot, OWNER_LOCKED_DIR_MODE);
      } finally {
        if (handle != null) fileSystem.closeSync(handle);
        try { fileSystem.unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; }
        if (rootLocked) fileSystem.fchmodSync(rootHandle, OWNER_DIR_MODE);
        if (rootHandle != null) fileSystem.closeSync(rootHandle);
      }
      return safeStatus(profileId, true);
    },
    status(profileId) {
      validateProfileId(profileId);
      const snapshot = checkedSecretDir({ statusOnly: true });
      if (!snapshot) return safeStatus(profileId, false);
      let handle;
      try {
        assertDirectoriesUnchanged(snapshot);
        handle = fileSystem.openSync(credentialPath(profileId), fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
        const entry = fileSystem.fstatSync(handle);
        assertOwnerMode(entry, OWNER_FILE_MODE, 'file');
        assertDirectoriesUnchanged(snapshot);
        return safeStatus(profileId, entry.isFile() && entry.size > 0);
      } catch (error) {
        if (error.code === 'ENOENT' || /owned|permissions/.test(error.message)) return safeStatus(profileId, false);
        throw error;
      } finally {
        if (handle != null) fileSystem.closeSync(handle);
      }
    },
    delete(profileId) {
      validateProfileId(profileId);
      const snapshot = checkedSecretDir();
      if (!snapshot) return safeStatus(profileId, false);
      let credentialHandle;
      let rootHandle;
      let rootLocked = false;
      try {
        assertDirectoriesUnchanged(snapshot);
        rootHandle = openVerifiedRoot(snapshot);
        fileSystem.fchmodSync(rootHandle, OWNER_LOCKED_DIR_MODE);
        rootLocked = true;
        assertDirectoriesUnchanged(snapshot, OWNER_LOCKED_DIR_MODE);
        credentialHandle = fileSystem.openSync(
          credentialPath(profileId),
          fs.constants.O_RDWR | fs.constants.O_NOFOLLOW,
        );
        const entry = fileSystem.fstatSync(credentialHandle);
        if (!entry.isFile()) throw new Error('provider credential must be a regular non-symlink file');
        assertOwnerMode(entry, OWNER_FILE_MODE, 'file');
        assertDirectoriesUnchanged(snapshot, OWNER_LOCKED_DIR_MODE);
        fileSystem.ftruncateSync(credentialHandle, 0);
        fileSystem.fsyncSync(credentialHandle);
        assertDirectoriesUnchanged(snapshot, OWNER_LOCKED_DIR_MODE);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      } finally {
        if (credentialHandle != null) fileSystem.closeSync(credentialHandle);
        if (rootLocked) fileSystem.fchmodSync(rootHandle, OWNER_DIR_MODE);
        if (rootHandle != null) fileSystem.closeSync(rootHandle);
      }
      return safeStatus(profileId, false);
    },
  });
}

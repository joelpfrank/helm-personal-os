import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ensureStateDir, stateRoot } from './state-paths.js';

const MODES = new Set(['provider', 'no_ai']);

export function createProviderPreferences({
  env = process.env,
  fileSystem = fs,
  knownProfileIds = [],
} = {}) {
  const root = stateRoot(env);
  if (!root) throw new Error('HELM_STATE_DIR is required for provider preferences');
  const known = new Set(knownProfileIds);
  const destination = path.join(root, 'provider-preferences.json');

  function validate(value, previous = { mode: 'provider', profileId: null }) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || !MODES.has(value.mode)) {
      throw new Error('provider preference mode is invalid');
    }
    const profileId = value.profileId ?? previous.profileId ?? null;
    if (profileId != null && !known.has(profileId)) throw new Error(`unknown provider profile: ${profileId}`);
    if (value.mode === 'provider' && !profileId) throw new Error('provider profile is required');
    return { mode: value.mode, profileId };
  }

  function get() {
    try {
      const stat = fileSystem.lstatSync(destination);
      if (stat.isSymbolicLink() || !stat.isFile() || (stat.mode & 0o777) !== 0o600) {
        throw new Error('provider preferences must be an owner-only regular file');
      }
      return validate(JSON.parse(fileSystem.readFileSync(destination, 'utf8')));
    } catch (error) {
      if (error.code === 'ENOENT') return { mode: 'provider', profileId: null };
      throw error;
    }
  }

  function set(value) {
    const next = validate(value, get());
    ensureStateDir(env, fileSystem);
    const temporary = path.join(root, `.provider-preferences.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`);
    try {
      fileSystem.writeFileSync(temporary, `${JSON.stringify(next)}\n`, { mode: 0o600, flag: 'wx' });
      fileSystem.chmodSync(temporary, 0o600);
      fileSystem.renameSync(temporary, destination);
    } finally {
      try { fileSystem.unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    return next;
  }

  return Object.freeze({ get, set });
}

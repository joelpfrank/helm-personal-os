import crypto from 'node:crypto';
import fs from 'node:fs';
import { passwordFilePath, ensureStateDir } from './lib/state-paths.js';

// scrypt params — N must be a power of two. 16384*8*128 ≈ 16MB, under the
// default 32MB maxmem, so no tuning needed.
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32 };

export function hasPassword() {
  return fs.existsSync(passwordFilePath());
}

export function setPassword(password) {
  if (typeof password !== 'string' || password.length < 6) {
    throw new Error('password must be at least 6 characters');
  }
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, SCRYPT.keylen, {
    N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p,
  });
  const record = {
    algo: 'scrypt',
    N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, keylen: SCRYPT.keylen,
    salt: salt.toString('hex'),
    hash: hash.toString('hex'),
    updated_at: new Date().toISOString(),
  };
  const PASSWORD_PATH = passwordFilePath();
  ensureStateDir();
  fs.writeFileSync(PASSWORD_PATH, JSON.stringify(record) + '\n', { mode: 0o600 });
  try { fs.chmodSync(PASSWORD_PATH, 0o600); } catch {}
}

export function verifyPassword(password) {
  if (!hasPassword() || typeof password !== 'string') return false;
  let record;
  try {
    record = JSON.parse(fs.readFileSync(passwordFilePath(), 'utf8'));
  } catch {
    return false;
  }
  if (record.algo !== 'scrypt') return false;
  const salt = Buffer.from(record.salt, 'hex');
  const expected = Buffer.from(record.hash, 'hex');
  const actual = crypto.scryptSync(password, salt, record.keylen || 32, {
    N: record.N || 16384, r: record.r || 8, p: record.p || 1,
  });
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

export function passwordPath() { return passwordFilePath(); }

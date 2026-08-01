import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const { createProviderSecretStore } = await import('../server/src/lib/provider-secrets.js');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helm-provider-secrets-'));
  const env = { HELM_STATE_DIR: root };
  return { root, store: createProviderSecretStore({ env }) };
}

describe('write-only external provider credential boundary', () => {
  it('writes outside source with owner-only directory/file permissions and returns status only', () => {
    const { root, store } = fixture();
    const value = 'XYZZY-CREDENTIAL-CANARY';
    const result = store.put('anthropic:api', value);
    assert.deepEqual(result, { profileId: 'anthropic:api', configured: true });
    assert.equal(typeof store.read, 'undefined', 'the boundary must expose no secret read primitive');
    const file = path.join(root, 'provider-secrets', 'anthropic--api.secret');
    assert.equal(fs.readFileSync(file, 'utf8'), value, 'test-only direct read verifies exact atomic write');
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    assert.equal(fs.statSync(path.dirname(file)).mode & 0o777, 0o700);
    assert.equal(JSON.stringify(result).includes(value), false);
  });

  it('reports configured/not-configured without suffixes, fingerprints, or values and supports rotation/deletion', () => {
    const { store } = fixture();
    const first = 'FIRST-CANARY';
    const second = 'SECOND-CANARY';
    assert.deepEqual(store.status('openai:api'), { profileId: 'openai:api', configured: false });
    store.put('openai:api', first);
    assert.deepEqual(store.put('openai:api', second), { profileId: 'openai:api', configured: true });
    const status = store.status('openai:api');
    assert.deepEqual(status, { profileId: 'openai:api', configured: true });
    assert.doesNotMatch(JSON.stringify(status), /FIRST|SECOND|suffix|fingerprint/);
    assert.deepEqual(store.delete('openai:api'), { profileId: 'openai:api', configured: false });
    assert.deepEqual(store.status('openai:api'), { profileId: 'openai:api', configured: false });
  });

  it('rejects empty values, hostile profile ids, relative/product-tree roots, and symlinked secret directories', () => {
    const { root, store } = fixture();
    assert.throws(() => store.put('../escape', 'x'), /profile id/i);
    assert.throws(() => store.put('fake:test', ''), /non-empty/i);
    assert.throws(() => createProviderSecretStore({ env: { HELM_STATE_DIR: 'relative' } }), /absolute/i);
    const productRoot = path.resolve(new URL('..', import.meta.url).pathname);
    assert.throws(() => createProviderSecretStore({ env: { HELM_STATE_DIR: productRoot } }), /outside/i);

    const linkedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'helm-provider-linked-'));
    const target = fs.mkdtempSync(path.join(os.tmpdir(), 'helm-provider-target-'));
    fs.symlinkSync(target, path.join(linkedRoot, 'provider-secrets'));
    const linkedStore = createProviderSecretStore({ env: { HELM_STATE_DIR: linkedRoot } });
    assert.throws(() => linkedStore.put('fake:test', 'x'), /symbolic link/i);
    const targetFile = path.join(target, 'fake--test.secret');
    fs.writeFileSync(targetFile, 'DO-NOT-TOUCH', { mode: 0o600 });
    assert.throws(() => linkedStore.status('fake:test'), /symbolic link/i);
    assert.throws(() => linkedStore.delete('fake:test'), /symbolic link/i);
    assert.equal(fs.readFileSync(targetFile, 'utf8'), 'DO-NOT-TOUCH');
  });

  it('rejects symlinked state roots and reports permission degradation as not configured', () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'helm-provider-root-link-'));
    const target = fs.mkdtempSync(path.join(os.tmpdir(), 'helm-provider-root-target-'));
    const linked = path.join(parent, 'state');
    fs.symlinkSync(target, linked);
    assert.throws(() => createProviderSecretStore({ env: { HELM_STATE_DIR: linked } }).put('fake:test', 'x'), /symbolic link/i);

    const { root, store } = fixture();
    store.put('fake:test', 'x');
    const dir = path.join(root, 'provider-secrets');
    const file = path.join(dir, 'fake--test.secret');
    fs.chmodSync(dir, 0o755);
    assert.deepEqual(store.status('fake:test'), { profileId: 'fake:test', configured: false });
    fs.chmodSync(dir, 0o700);
    fs.chmodSync(file, 0o644);
    assert.deepEqual(store.status('fake:test'), { profileId: 'fake:test', configured: false });
  });

  it('rejects a state root reached through a user-controlled symlinked parent component', () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'helm-provider-parent-link-'));
    const target = fs.mkdtempSync(path.join(os.tmpdir(), 'helm-provider-parent-target-'));
    const linkedParent = path.join(parent, 'linked-parent');
    fs.symlinkSync(target, linkedParent);
    const root = path.join(linkedParent, 'state');
    const store = createProviderSecretStore({ env: { HELM_STATE_DIR: root } });
    assert.throws(() => store.put('fake:test', 'x'), /path component.*symbolic link/i);
  });

  it('detects a directory swap after opening the temporary file before writing the credential', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helm-provider-race-'));
    const target = fs.mkdtempSync(path.join(os.tmpdir(), 'helm-provider-race-target-'));
    const secretDir = path.join(root, 'provider-secrets');
    const movedDir = path.join(root, 'provider-secrets-original');
    let swapped = false;
    let writes = 0;
    const racingFs = Object.create(fs);
    racingFs.openSync = (file, flags, mode) => {
      if (!swapped && String(file).includes('.tmp')) {
        swapped = true;
        fs.renameSync(secretDir, movedDir);
        fs.symlinkSync(target, secretDir);
      }
      return fs.openSync(file, flags, mode);
    };
    racingFs.writeFileSync = (...args) => { writes += 1; return fs.writeFileSync(...args); };
    const store = createProviderSecretStore({ env: { HELM_STATE_DIR: root }, fileSystem: racingFs });
    assert.throws(() => store.put('fake:test', 'RACE-CANARY'), /changed during operation|symbolic link/i);
    assert.equal(writes, 0, 'credential bytes must not be written after a directory identity swap');
  });

  it('writes zero credential bytes when the production native write boundary swaps the provider directory', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helm-provider-write-race-'));
    const target = fs.mkdtempSync(path.join(os.tmpdir(), 'helm-provider-write-race-target-'));
    const secretDir = path.join(root, 'provider-secrets');
    const movedDir = path.join(root, 'provider-secrets-original');
    let swapped = false;
    let credentialBytesWrittenAfterSwap = 0;
    const racingFs = Object.create(fs);
    racingFs.writeSync = (handle, bytes, offset, length, position) => {
      if (!swapped) {
        fs.renameSync(secretDir, movedDir);
        fs.symlinkSync(target, secretDir);
        swapped = true;
      }
      credentialBytesWrittenAfterSwap += length;
      return fs.writeSync(handle, bytes, offset, length, position);
    };
    const store = createProviderSecretStore({ env: { HELM_STATE_DIR: root }, fileSystem: racingFs });

    try {
      assert.throws(() => store.put('fake:test', 'WRITE-RACE-CANARY'), /changed during operation|symbolic link/i);
      assert.equal(swapped, true, 'the regression must mutate the directory inside the production writeSync boundary');
      assert.equal(credentialBytesWrittenAfterSwap, 0,
        'no credential bytes may cross the native write boundary after the directory mutation');
      assert.equal(fs.existsSync(path.join(target, 'fake--test.secret')), false);
      const movedEntries = fs.readdirSync(movedDir);
      assert.equal(movedEntries.every((entry) => fs.statSync(path.join(movedDir, entry)).size === 0), true,
        'credential bytes must never be written into the provider directory after it is moved');
      assert.equal(fs.readdirSync(root).some((entry) => entry.endsWith('.tmp')), false,
        'the staged owner-only credential file must be removed after the swap is detected');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(target, { recursive: true, force: true });
    }
  });

  it('prevents a provider directory swap at the credential-bearing native write boundary', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helm-provider-locked-write-race-'));
    const target = fs.mkdtempSync(path.join(os.tmpdir(), 'helm-provider-locked-write-race-target-'));
    const secretDir = path.join(root, 'provider-secrets');
    const movedDir = path.join(root, 'provider-secrets-original');
    let attempted = false;
    let swapped = false;
    let credentialBytesWrittenAfterAttempt = 0;
    const racingFs = Object.create(fs);
    racingFs.writeSync = (handle, bytes, offset, length, position) => {
      if (length > 0 && !attempted) {
        attempted = true;
        fs.renameSync(secretDir, movedDir);
        fs.symlinkSync(target, secretDir);
        swapped = true;
      }
      if (attempted) credentialBytesWrittenAfterAttempt += length;
      return fs.writeSync(handle, bytes, offset, length, position);
    };
    const store = createProviderSecretStore({ env: { HELM_STATE_DIR: root }, fileSystem: racingFs });

    try {
      assert.throws(() => store.put('fake:test', 'WRITE-RACE-CANARY'), /changed during operation|symbolic link|permission denied/i);
      assert.equal(attempted, true, 'the regression must attempt the swap at the credential-bearing write call');
      assert.equal(swapped, false, 'the provider directory must not be mutable while credential bytes are writable');
      assert.equal(credentialBytesWrittenAfterAttempt, 0,
        'no credential bytes may cross after the provider directory mutation attempt');
      assert.equal(fs.statSync(root).mode & 0o777, 0o700, 'the state directory mode must be restored');
      assert.equal(fs.existsSync(path.join(target, 'fake--test.secret')), false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(target, { recursive: true, force: true });
    }
  });

  it('keeps the provider directory immutable through credential publication', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helm-provider-publish-race-'));
    const target = fs.mkdtempSync(path.join(os.tmpdir(), 'helm-provider-publish-race-target-'));
    const secretDir = path.join(root, 'provider-secrets');
    const movedDir = path.join(root, 'provider-secrets-original');
    const leaked = path.join(target, 'fake--test.secret');
    let attempted = false;
    let swapped = false;
    const racingFs = Object.create(fs);
    racingFs.renameSync = (source, destination) => {
      if (destination === path.join(secretDir, 'fake--test.secret') && !attempted) {
        attempted = true;
        try {
          fs.renameSync(secretDir, movedDir);
          fs.symlinkSync(target, secretDir);
          swapped = true;
        } catch (error) {
          assert.match(error.message, /permission denied|operation not permitted/i);
        }
      }
      return fs.renameSync(source, destination);
    };
    const store = createProviderSecretStore({ env: { HELM_STATE_DIR: root }, fileSystem: racingFs });

    try {
      assert.deepEqual(store.put('fake:test', 'PUBLISH-RACE-CANARY'), {
        profileId: 'fake:test',
        configured: true,
      });
      assert.equal(attempted, true, 'the regression must attempt the swap at publication');
      assert.equal(swapped, false, 'the provider directory must stay immutable through renameSync');
      assert.equal(fs.existsSync(leaked), false, 'credential bytes must not publish through a substituted parent');
      assert.equal(fs.readFileSync(path.join(secretDir, 'fake--test.secret'), 'utf8'), 'PUBLISH-RACE-CANARY');
      assert.equal(fs.statSync(root).mode & 0o777, 0o700, 'the state directory mode must be restored');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(target, { recursive: true, force: true });
    }
  });

  it('keeps the provider directory immutable through credential deletion', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helm-provider-delete-race-'));
    const target = fs.mkdtempSync(path.join(os.tmpdir(), 'helm-provider-delete-race-target-'));
    const secretDir = path.join(root, 'provider-secrets');
    const movedDir = path.join(root, 'provider-secrets-original');
    const credential = path.join(secretDir, 'fake--test.secret');
    const protectedTarget = path.join(target, 'fake--test.secret');
    let attempted = false;
    let swapped = false;
    const racingFs = Object.create(fs);
    racingFs.ftruncateSync = (handle, length) => {
      if (!attempted) {
        attempted = true;
        try {
          fs.renameSync(secretDir, movedDir);
          fs.symlinkSync(target, secretDir);
          swapped = true;
        } catch (error) {
          assert.match(error.message, /permission denied|operation not permitted/i);
        }
      }
      return fs.ftruncateSync(handle, length);
    };
    const store = createProviderSecretStore({ env: { HELM_STATE_DIR: root }, fileSystem: racingFs });

    try {
      store.put('fake:test', 'DELETE-RACE-CANARY');
      fs.writeFileSync(protectedTarget, 'DO-NOT-DELETE', { mode: 0o600 });
      assert.deepEqual(store.delete('fake:test'), { profileId: 'fake:test', configured: false });
      assert.equal(attempted, true, 'the regression must attempt the swap at the descriptor erase boundary');
      assert.equal(swapped, false, 'the provider directory must stay immutable through credential erasure');
      assert.equal(fs.readFileSync(protectedTarget, 'utf8'), 'DO-NOT-DELETE');
      assert.equal(fs.statSync(credential).size, 0, 'deletion must erase the credential bytes');
      assert.equal(fs.statSync(root).mode & 0o777, 0o700, 'the state directory mode must be restored');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(target, { recursive: true, force: true });
    }
  });

  it('deletes only the opened credential when the state root is substituted at the native erase boundary', () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'helm-provider-root-delete-race-'));
    const root = path.join(parent, 'state');
    fs.mkdirSync(root, { mode: 0o700 });
    const movedRoot = path.join(parent, 'state-original');
    const replacementRoot = path.join(parent, 'replacement');
    const replacementDir = path.join(replacementRoot, 'provider-secrets');
    const stagedReplacementCredential = path.join(replacementDir, 'fake--test.secret');
    const replacementCredential = path.join(root, 'provider-secrets', 'fake--test.secret');
    let attempted = false;
    const racingFs = Object.create(fs);
    racingFs.ftruncateSync = (handle, length) => {
      if (!attempted) {
        attempted = true;
        fs.renameSync(root, movedRoot);
        fs.mkdirSync(replacementDir, { recursive: true, mode: 0o700 });
        fs.writeFileSync(stagedReplacementCredential, 'DO-NOT-DELETE', { mode: 0o600 });
        fs.renameSync(replacementRoot, root);
      }
      return fs.ftruncateSync(handle, length);
    };
    const store = createProviderSecretStore({ env: { HELM_STATE_DIR: root }, fileSystem: racingFs });

    try {
      store.put('fake:test', 'DELETE-ROOT-RACE-CANARY');
      assert.throws(() => store.delete('fake:test'), /changed during operation/i);
      assert.equal(attempted, true, 'the regression must substitute the root at the native erase call');
      assert.equal(fs.readFileSync(replacementCredential, 'utf8'), 'DO-NOT-DELETE',
        'a replacement credential must never be erased');
      const originalCredential = path.join(movedRoot, 'provider-secrets', 'fake--test.secret');
      assert.equal(fs.statSync(originalCredential).size, 0, 'the opened original credential must be erased');
      assert.equal(fs.statSync(movedRoot).mode & 0o777, 0o700,
        'the original state root mode must be restored through its open descriptor');
    } finally {
      fs.rmSync(parent, { recursive: true, force: true });
    }
  });
});

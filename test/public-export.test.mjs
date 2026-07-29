import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const EXPORTER = path.join(ROOT, 'scripts', 'export-public-source.sh');
const TEMP_PATHS = new Set();

function temporaryDirectory(prefix) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  TEMP_PATHS.add(directory);
  return directory;
}

afterEach(() => {
  for (const temporaryPath of [...TEMP_PATHS].sort((a, b) => b.length - a.length)) {
    fs.rmSync(temporaryPath, { recursive: true, force: true });
  }
  TEMP_PATHS.clear();
});

function write(root, relativePath, content = `${relativePath}\n`) {
  const target = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

function fixture() {
  const root = temporaryDirectory('helm-public-source-');
  for (const file of [
    'package.json',
    'package-lock.json',
    'server/package.json',
    'server/src/index.js',
    'web/package.json',
    'web/src/main.jsx',
    'mcp/package.json',
    'mcp/src/index.js',
  ]) write(root, file);

  write(root, 'web/index.html');
  write(root, 'web/vite.config.js');
  write(root, 'web/public/favicon.svg');
  write(root, 'install-helm.sh', '#!/usr/bin/env bash\n');
  write(root, 'scripts/package-helm.sh', '#!/usr/bin/env bash\n');
  write(root, 'test/cadence-due.test.mjs', '// safe test\n');
  return root;
}

function run(source, destination) {
  TEMP_PATHS.add(destination);
  return spawnSync('bash', [EXPORTER, destination], {
    cwd: ROOT,
    env: { ...process.env, HELM_PUBLIC_SOURCE_ROOT: source },
    encoding: 'utf8',
  });
}

function files(root) {
  const found = [];
  function visit(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      const relative = path.relative(root, full);
      if (entry.isDirectory()) visit(full);
      else found.push(relative);
    }
  }
  visit(root);
  return found.sort();
}

const PUBLIC_SCAN_IGNORES = new Set(['.git', 'node_modules', 'dist', 'coverage']);
const FORBIDDEN_PUBLIC_PATHS = [
  new RegExp('(^|/)telegram-' + 'bridge(/|$)', 'i'),
  /(^|\/)deploy[.]sh$/i,
  /(^|\/)launchd\/install-backup[.]sh$/i,
  new RegExp('(^|/)[^/]*com[.]jo' + 'el[^/]*$', 'i'),
  new RegExp('(^|/)server/src/tail' + 'scale[.]js$', 'i'),
  /(^|\/)[.]dashboard-(token|password)$/i,
  /(^|\/)[.]mcp-http-token$/i,
  /(^|\/)[.]anthropic-key$/i,
  /(^|\/)[.]google-credentials[.]json$/i,
  /(^|\/)[.]env([.]|$)/i,
  /(^|\/)([.]hermes|backups?|logs?)(\/|$)/i,
  /(^|\/)server\/data(\/|$)/i,
];
const FORBIDDEN_PUBLIC_CONTENT = [
  { label: 'private owner name', pattern: new RegExp('jo' + 'el', 'i') },
  { label: 'private company identifier', pattern: new RegExp('esen' + 'cia', 'i') },
  { label: 'private operations identifier', pattern: new RegExp('(^|[^A-Za-z])O' + 'FM([^A-Za-z]|$)', 'i') },
  { label: 'private email identifier', pattern: new RegExp('(jo' + 'elpeterfrank|jp' + 'f@)', 'i') },
  { label: 'private location', pattern: new RegExp('(Medel' + 'l(?:in|ín)|Barich' + 'ara)', 'i') },
  { label: 'private network assumption', pattern: new RegExp('tail' + 'scale', 'i') },
  { label: 'private network assumption', pattern: new RegExp('tail' + 'net', 'i') },
  { label: 'private network assumption', pattern: new RegExp('Fun' + 'nel', 'i') },
  { label: 'private machine assumption', pattern: new RegExp('Mac' + 'Book|Mac\\s*Mini', 'i') },
  { label: 'private machine assumption', pattern: new RegExp('the\\s+Mi' + 'ni\\b', 'i') },
  { label: 'private relationship reference', pattern: new RegExp('\\bG' + "F(?:'s)?\\b", 'i') },
  { label: 'private handoff reference', pattern: new RegExp('dashboard-' + 'plan[.]md', 'i') },
  { label: 'private bridge identifier', pattern: new RegExp('telegram(?:-|\\s+)' + 'bridge', 'i') },
  { label: 'macOS user path', pattern: new RegExp('/Us' + 'ers/[A-Za-z0-9._-]+(?:/|$)') },
  { label: 'Unix user path', pattern: new RegExp('/ho' + 'me/[A-Za-z0-9._-]+(?:/|$)') },
  { label: 'private hostname', pattern: new RegExp('(^|[^A-Za-z0-9.-])[A-Za-z0-9-]+(?:[.][A-Za-z0-9-]+)*[.]lo' + 'cal([^A-Za-z0-9.-]|$)', 'i') },
];

function decodeText(buffer) {
  if (buffer.includes(0)) return null;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    return null;
  }
}

function publicationSafetyFindings(root) {
  const findings = [];
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (PUBLIC_SCAN_IGNORES.has(entry.name)) continue;
      const full = path.join(directory, entry.name);
      const relative = path.relative(root, full).split(path.sep).join('/');
      for (const pattern of FORBIDDEN_PUBLIC_PATHS) {
        if (pattern.test(relative)) findings.push(`${relative}: forbidden public path`);
      }
      if (entry.isDirectory()) {
        if (relative === 'server/data' || relative === 'web/dist') continue;
        visit(full);
        continue;
      }
      if (!entry.isFile()) continue;
      const text = decodeText(fs.readFileSync(full));
      if (text == null) continue;
      for (const { label, pattern } of FORBIDDEN_PUBLIC_CONTENT) {
        if (pattern.test(text)) findings.push(`${relative}: ${label}`);
      }
    }
  }
  visit(root);
  return findings;
}

describe('export-public-source.sh', () => {
  it('exists before the export contract can run', () => {
    assert.ok(fs.existsSync(EXPORTER), 'scripts/export-public-source.sh must exist');
  });

  it('exports only the explicit public allow-list', () => {
    const source = fixture();
    const destination = `${source}-export`;
    write(source, '.git/config', 'private history\n');
    write(source, '.hermes/plans/private.md', 'private handoff\n');
    write(source, '.env.local', 'PRIVATE=true\n');
    write(source, 'backups/live.db', 'private backup\n');
    write(source, 'deploy.sh', 'private deployment\n');
    write(source, 'launchd/com.' + 'jo' + 'el.private.plist', 'private launch agent\n');
    write(source, 'launchd/install-backup.sh', 'private backup installer\n');
    write(source, 'logs/server.log', 'private log\n');
    write(source, 'node_modules/private-package/index.js', 'dependency\n');
    write(source, 'scripts/backup-db.sh', 'private backup script\n');
    write(source, 'telegram-' + 'bridge/bridge.mjs', 'private integration\n');
    write(source, 'server/data/live.db', 'private database\n');
    write(source, 'dist/generated.txt', 'generated\n');
    write(source, 'web/dist/generated.js', 'generated frontend\n');

    const result = run(source, destination);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.deepEqual(files(destination), [
      'install-helm.sh',
      'mcp/package.json',
      'mcp/src/index.js',
      'package-lock.json',
      'package.json',
      'scripts/package-helm.sh',
      'server/package.json',
      'server/src/index.js',
      'test/cadence-due.test.mjs',
      'web/index.html',
      'web/package.json',
      'web/public/favicon.svg',
      'web/src/main.jsx',
      'web/vite.config.js',
    ]);
  });

  it('fails closed when any required source file or root is missing', () => {
    const requiredPaths = [
      'package.json',
      'package-lock.json',
      'server/package.json',
      'server/src',
      'web/package.json',
      'web/src',
      'mcp/package.json',
      'mcp/src',
    ];

    for (const relativePath of requiredPaths) {
      const source = fixture();
      const destination = `${source}-export`;
      fs.rmSync(path.join(source, relativePath), { recursive: true });

      const result = run(source, destination);
      const diagnostics = result.stdout + result.stderr;
      assert.notEqual(result.status, 0, `export unexpectedly accepted missing ${relativePath}`);
      assert.match(diagnostics, /missing required source path/i);
      assert.match(diagnostics, new RegExp(relativePath.replace(/[./]/g, '\\$&')));
      assert.equal(fs.existsSync(destination), false, 'failure must not create a partial destination');
    }
  });

  it('fails closed on a forbidden filename inside an allowed root', () => {
    const source = fixture();
    const destination = `${source}-export`;
    write(source, 'server/src/private.db', 'canary\n');

    const result = run(source, destination);
    assert.notEqual(result.status, 0);
    assert.match(result.stdout + result.stderr, /forbidden public path/i);
    assert.equal(fs.existsSync(destination), false);
  });

  it('fails closed on every private artifact class inside allowed roots', () => {
    const forbiddenPaths = [
      'server/src/backup/dump.sql',
      'server/src/logs/app.txt',
      'server/src/vendor/dependency.js',
      'server/src/node_modules/dependency/index.js',
      'server/src/generated/bundle.js',
      'server/src/dist/bundle.js',
      'server/src/cache.sqlite3',
      'server/src/state.db-wal',
      'server/src/state.db-shm',
      'server/src/private.pem',
      'server/src/com.' + 'jo' + 'el.agent.plist',
    ];

    for (const relativePath of forbiddenPaths) {
      const source = fixture();
      const destination = `${source}-export`;
      write(source, relativePath, 'private artifact canary\n');
      const result = run(source, destination);
      assert.notEqual(result.status, 0, `export unexpectedly accepted ${relativePath}`);
      assert.match(result.stdout + result.stderr, /forbidden public path/i);
      assert.equal(fs.existsSync(destination), false);
    }
  });

  it('fails closed on private identifiers, absolute user paths, and secret material', () => {
    const canaries = [
      ['/' + 'Users/' + 'private-owner/project', /private content marker/i],
      ['Jo' + 'el', /private content marker/i],
      ['com.' + 'jo' + 'el.private-service', /private content marker/i],
      ['esen' + 'ciaagency', /private content marker/i],
      ['Esen' + 'cia Agency', /private content marker/i],
      ['O' + 'FM operations', /private content marker/i],
      ['jo' + 'elpeterfrank@example.com', /private content marker/i],
      ['mac-mini.lo' + 'cal', /private content marker/i],
      ['tail' + 'net', /private content marker/i],
      ['Use Tail' + 'scale for remote access', /private content marker/i],
      ['Tail' + 'scale Fun' + 'nel', /private content marker/i],
      ['Mac' + 'Book', /private content marker/i],
      ['Mac ' + 'Mini', /private content marker/i],
      ['the Mi' + 'ni = the user timezone', /private content marker/i],
      ["G" + "F's instance", /private content marker/i],
      ['dashboard-' + 'plan.md', /private content marker/i],
      ['Medell' + 'ín', /private content marker/i],
      ['Barich' + 'ara', /private content marker/i],
      ['«redacted:sk-…»' + 'A'.repeat(24), /secret content marker/i],
    ];

    for (const [canary, expected] of canaries) {
      const source = fixture();
      const destination = `${source}-export`;
      write(source, 'server/src/canary.js', `export default ${JSON.stringify(canary)};\n`);
      const result = run(source, destination);
      assert.notEqual(result.status, 0, `export unexpectedly accepted ${canary}`);
      assert.match(result.stdout + result.stderr, expected);
      assert.equal(fs.existsSync(destination), false);
    }
  });

  it('scans binary bytes and rejects generic credentials and personal identifiers', () => {
    const canaries = [
      Buffer.from(`const apiKey = "${'tok_' + 'A'.repeat(32)}";\n`),
      Buffer.from('API_' + 'TOKEN=' + 'C'.repeat(32) + '\n'),
      Buffer.concat([Buffer.from('binary\0prefix\0'), Buffer.from('gh' + 'p_' + 'B'.repeat(32))]),
      Buffer.from('ownerPhone = "' + '+44' + '7700900123";\n'),
      Buffer.from('TELEGRAM_' + 'ALLOWED_USER_ID=' + '123456789' + '\n'),
      Buffer.from('const root = "/opt/' + 'private/helm";\n'),
      Buffer.from('const bridge = "telegram-' + 'bridge/.env";\n'),
    ];

    for (const [index, canary] of canaries.entries()) {
      const source = fixture();
      const destination = `${source}-export`;
      write(source, `server/src/canary-${index}.js`, canary);
      const result = run(source, destination);
      assert.notEqual(result.status, 0, `export unexpectedly accepted content canary ${index}`);
      assert.match(result.stdout + result.stderr, /(private|secret) content marker/i);
      assert.equal(fs.existsSync(destination), false);
    }
  });

  it('rejects quoted Telegram user identifiers with actionable diagnostics', () => {
    const canaries = [
      'TELEGRAM_' + 'ALLOWED_USER_ID="123456789"\n',
      "TELEGRAM_" + "USER_ID='123456789'\n",
    ];

    for (const [index, canary] of canaries.entries()) {
      const source = fixture();
      const destination = `${source}-export`;
      const relativePath = `server/src/telegram-id-${index}.js`;
      write(source, relativePath, canary);

      const result = run(source, destination);
      const diagnostics = result.stdout + result.stderr;
      assert.notEqual(result.status, 0, `export unexpectedly accepted quoted Telegram identifier ${index}`);
      assert.match(diagnostics, /private content marker/i);
      assert.match(diagnostics, /server\/src\/telegram-id-[01][.]js/);
      assert.doesNotMatch(diagnostics, /123456789/, 'diagnostics must identify the file without printing the identifier');
      assert.equal(fs.existsSync(destination), false, 'failure must not create a partial destination');
    }
  });

  it('rejects forbidden hidden files nested inside an allowed root', () => {
    const source = fixture();
    const destination = `${source}-export`;
    write(source, 'server/src/config/.env.local', 'SAFE_PLACEHOLDER=true\n');

    const result = run(source, destination);
    const diagnostics = result.stdout + result.stderr;
    assert.notEqual(result.status, 0);
    assert.match(diagnostics, /forbidden public path/i);
    assert.match(diagnostics, /server\/src\/config\/[.]env[.]local/);
    assert.equal(fs.existsSync(destination), false);
  });

  it('rejects symlinked path-traversal escapes in allowed roots', () => {
    const source = fixture();
    const destination = `${source}-export`;
    fs.symlinkSync('/etc/hosts', path.join(source, 'server', 'src', 'linked.js'));

    const result = run(source, destination);
    assert.notEqual(result.status, 0);
    assert.match(result.stdout + result.stderr, /symlink/i);
    assert.equal(fs.existsSync(destination), false);
  });

  it('rejects path-traversal escapes through symlinked allow-list ancestors', () => {
    const source = fixture();
    const destination = `${source}-export`;
    const external = temporaryDirectory('helm-external-server-');
    write(external, 'package.json');
    write(external, 'src/index.js', 'external private bytes\n');
    fs.rmSync(path.join(source, 'server'), { recursive: true });
    fs.symlinkSync(external, path.join(source, 'server'));

    const result = run(source, destination);
    assert.notEqual(result.status, 0);
    assert.match(result.stdout + result.stderr, /symlink/i);
    assert.equal(fs.existsSync(destination), false);
  });

  it('does not retain a private bot-bridge credential fallback', () => {
    const notifySource = fs.readFileSync(path.join(ROOT, 'server', 'src', 'lib', 'notify.js'), 'utf8');
    assert.doesNotMatch(notifySource, new RegExp('telegram-' + 'bridge'));
    assert.doesNotMatch(notifySource, /readFileSync/);
  });

  it('refuses an existing non-empty destination without changing it', () => {
    const source = fixture();
    const destination = `${source}-export`;
    write(destination, 'keep.txt', 'unchanged\n');

    const result = run(source, destination);
    assert.notEqual(result.status, 0);
    assert.match(result.stdout + result.stderr, /destination already exists/i);
    assert.equal(fs.readFileSync(path.join(destination, 'keep.txt'), 'utf8'), 'unchanged\n');
    assert.deepEqual(files(destination), ['keep.txt']);
  });

  it('detects every publication-private marker without fixture exemptions', () => {
    const canaries = [
      ['owner.js', 'const owner = "Jo' + 'el";\n'],
      ['company.md', 'esen' + 'cia agency\n'],
      ['ops.txt', 'O' + 'FM operations\n'],
      ['email.txt', 'jo' + 'elpeterfrank@example.com\n'],
      ['place.txt', 'Medell' + 'ín and Barich' + 'ara\n'],
      ['network.txt', 'Use Tail' + 'scale for remote access\n'],
      ['overlay-network.txt', 'Only expose this on the tail' + 'net\n'],
      ['public-network.txt', 'Expose this with Fun' + 'nel\n'],
      ['machine-role.txt', 'Open an SSH tunnel from your Mac' + 'Book to the Mac ' + 'Mini\n'],
      ['machine-shorthand.txt', 'Times are interpreted on the Mi' + 'ni\n'],
      ['relationship.txt', "G" + "F's instance uses another icon\n"],
      ['handoff.txt', 'See ~/Downloads/dashboard-' + 'plan.md\n'],
      ['.dashboard-token', 'synthetic-token-placeholder\n'],
      ['config/.env.production', 'SAFE_PLACEHOLDER=true\n'],
      ['.hermes/plans/private.md', 'private handoff placeholder\n'],
      ['server/data/demo.txt', 'synthetic runtime data\n'],
      ['backups/demo.txt', 'synthetic backup data\n'],
      ['bridge.txt', 'telegram-' + 'bridge\n'],
      ['bridge-prose.txt', 'Telegram ' + 'bridge\n'],
      ['mac-path.txt', '/' + 'Users/private-owner/helm\n'],
      ['unix-path.txt', '/' + 'home/private-owner/helm\n'],
      ['hostname.txt', 'private-mini.lo' + 'cal\n'],
    ];

    for (const [relativePath, content] of canaries) {
      const root = temporaryDirectory('helm-public-scan-');
      write(root, relativePath, content);
      assert.ok(
        publicationSafetyFindings(root).length > 0,
        `publication scan unexpectedly accepted ${relativePath}`,
      );
    }
  });

  it('keeps test-run authentication tokens out of the public working tree', async () => {
    const credentialPath = path.join(ROOT, '.dashboard-token');
    assert.equal(fs.existsSync(credentialPath), false, 'test precondition: public tree has no generated token');

    const { getToken } = await import('../server/src/auth.js');
    assert.match(getToken(), /^[a-f0-9]{64}$/);
    assert.equal(fs.existsSync(credentialPath), false, 'node:test must not create a credential in the source tree');
  });

  it('does not retain private deployment-topology assumptions in product source', () => {
    const sources = [
      ['server/src/routes/auth.js', /Cloudflare tunnel every/i],
      ['server/src/lib/channel-telegram.js', new RegExp('Telegram ' + 'bridge', 'i')],
      ['web/src/components/chat/ChatComposer.jsx', new RegExp('Telegram ' + 'bridge', 'i')],
      ['web/src/views/CalendarView.jsx', /SSH-tunnel flow/i],
    ];

    for (const [relativePath, forbidden] of sources) {
      const source = fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
      assert.doesNotMatch(source, forbidden, `${relativePath} retains a private deployment assumption`);
    }
  });

  it('scans every public text file in the working tree for private markers and machine paths', () => {
    assert.deepEqual(publicationSafetyFindings(ROOT), []);
  });
});

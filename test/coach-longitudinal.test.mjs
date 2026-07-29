// TDD tests for Phase 2: longitudinal, adaptive coaching.
// RED first — these must FAIL before the production changes.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const ROOT = path.resolve(import.meta.dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}
function exists(rel) {
  return fs.existsSync(path.join(ROOT, rel));
}

// ═══════════════════════════════════════════════════════════════════
// A. Migration & Schema
// ═══════════════════════════════════════════════════════════════════

describe('Migration 019 - coaching_profile', () => {
  it('migration file exists', () => {
    assert.ok(exists('server/src/migrations/019_coaching_profile.sql'),
      '019_coaching_profile.sql must exist');
  });
});

describe('Schema - coaching_profile column (isolated DB)', () => {
  let db, tmpDir;

  before(async () => {
    const { default: Database } = await import('better-sqlite3');
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'helm-test-'));
    db = new Database(path.join(tmpDir, 'test.db'));
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    )`);
    const migrationsDir = path.join(ROOT, 'server', 'src', 'migrations');
    const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();
    for (const file of files) {
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      db.transaction(() => {
        db.exec(sql);
        db.prepare('INSERT INTO schema_migrations (name) VALUES (?)').run(file);
      })();
    }
  });

  after(() => {
    if (db) db.close();
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('coach_settings has coaching_profile column defaulting to {}', () => {
    const row = db.prepare('SELECT coaching_profile FROM coach_settings WHERE id = 1').get();
    assert.ok(row, 'coach_settings row must exist');
    assert.equal(row.coaching_profile, '{}', 'default must be empty JSON object');
  });

  it('coaching_profile round-trips JSON', () => {
    const profile = { challenge_level: 3, motivational_drivers: ['autonomy'] };
    db.prepare('UPDATE coach_settings SET coaching_profile = ? WHERE id = 1')
      .run(JSON.stringify(profile));
    const row = db.prepare('SELECT coaching_profile FROM coach_settings WHERE id = 1').get();
    assert.deepEqual(JSON.parse(row.coaching_profile), profile);
  });
});

// ═══════════════════════════════════════════════════════════════════
// B. Profile validation
// ═══════════════════════════════════════════════════════════════════

describe('Coaching profile validation', () => {
  let validateCoachingProfile;

  before(async () => {
    try {
      const mod = await import(path.join(ROOT, 'server', 'src', 'lib', 'coaching-profile.js'));
      validateCoachingProfile = mod.validateCoachingProfile;
    } catch {
      // Module doesn't exist yet → tests below will fail with clear message
    }
  });

  it('validation module exists and exports validateCoachingProfile', () => {
    assert.equal(typeof validateCoachingProfile, 'function',
      'coaching-profile.js must export validateCoachingProfile');
  });

  it('rejects unknown keys', () => {
    assert.throws(() => validateCoachingProfile({ foo: 'bar' }), /unknown/i);
  });

  it('accepts valid profile with known fields', () => {
    const profile = {
      motivational_drivers: ['autonomy', 'mastery'],
      resistance_patterns: ['procrastination under ambiguity'],
      avoidance_signals: ['deflects with humor'],
      communication_style: 'direct',
      challenge_level: 4,
      breakthrough_moments: [{ date: '2026-07-01', description: 'First full week streak' }],
      approaches_that_backfire: ['overly gentle nudges'],
    };
    assert.doesNotThrow(() => validateCoachingProfile(profile));
  });

  it('rejects challenge_level outside 1-5', () => {
    assert.throws(() => validateCoachingProfile({ challenge_level: 0 }));
    assert.throws(() => validateCoachingProfile({ challenge_level: 6 }));
    assert.throws(() => validateCoachingProfile({ challenge_level: 2.5 }));
  });

  it('rejects non-array for array fields', () => {
    assert.throws(() => validateCoachingProfile({ motivational_drivers: 'not-array' }));
  });

  it('rejects oversized payloads (> 8 KB)', () => {
    const big = { motivational_drivers: Array(500).fill('x'.repeat(100)) };
    assert.throws(() => validateCoachingProfile(big), /exceed|limit|size/i);
  });
});

// ═══════════════════════════════════════════════════════════════════
// C. MCP tool registration
// ═══════════════════════════════════════════════════════════════════

describe('MCP tools - coaching profile', () => {
  const src = () => read('mcp/src/tools.js');

  it('update_coaching_profile tool is registered', () => {
    assert.ok(src().includes('update_coaching_profile'),
      'tools.js must register update_coaching_profile');
  });

  it('get_coach_settings description mentions coaching_profile', () => {
    // The tool should communicate that profile data is included
    assert.ok(src().includes('coaching_profile'),
      'tools.js get_coach_settings should reference coaching_profile');
  });
});

// ═══════════════════════════════════════════════════════════════════
// D. Recent arc in coach context
// ═══════════════════════════════════════════════════════════════════

describe('Recent arc - context inclusion', () => {
  const chatSrc = () => read('server/src/routes/chat.js');

  it('chat.js queries a 14-day arc of check-ins', () => {
    const src = chatSrc();
    assert.ok(src.includes('-14 day'),
      'chat.js must have a 14-day check-in query');
  });

  it('buildCoachContext outputs a recent-arc section', () => {
    const src = chatSrc();
    assert.ok(src.includes('Recent arc') || src.includes('recent arc'),
      'buildCoachContext must include a recent arc section');
  });

  it('buildCoachContext includes coaching profile', () => {
    const src = chatSrc();
    // Must read the profile from DB and inject it
    assert.ok(src.includes('coaching_profile'),
      'buildCoachContext must reference coaching_profile');
  });

  it('buildCoachContext includes goal-linked evidence', () => {
    const src = chatSrc();
    assert.ok(src.includes('habit') && (src.includes('completion') || src.includes('streak') || src.includes('logged')),
      'buildCoachContext must include habit completion evidence');
  });
});

// ═══════════════════════════════════════════════════════════════════
// E. COACH_INSTRUCTIONS - intent-based, not scripted
// ═══════════════════════════════════════════════════════════════════

describe('COACH_INSTRUCTIONS - flexible coaching', () => {
  const chatSrc = () => read('server/src/routes/chat.js');

  it('describes a session arc (connect, notice, explore)', () => {
    const src = chatSrc();
    assert.ok(
      src.includes('Connect') && src.includes('Notice') && src.includes('Explore'),
      'Must describe a session arc with Connect/Notice/Explore steps');
  });

  it('mentions challenge_level adaptation', () => {
    assert.ok(chatSrc().includes('challenge_level'),
      'Must reference challenge_level for directness adaptation');
  });

  it('does NOT prescribe rigid "3 top tasks" form', () => {
    // Old: "3 top tasks for today" - rigid scripted format
    const src = chatSrc();
    assert.ok(!src.includes('3 top tasks') && !src.includes('top 3 tasks'),
      'Must not prescribe rigid top-3-tasks in morning cadence');
  });

  it('does NOT use rigid time estimates (~30 sec)', () => {
    assert.ok(!chatSrc().includes('~30 sec'),
      'Must not use rigid ~30 sec time estimates');
  });

  it('explicitly prohibits generic praise and canned slogans', () => {
    const src = chatSrc();
    assert.ok(src.includes('generic praise'),
      'Must explicitly prohibit generic praise');
  });

  it('explicitly prohibits parroting/paraphrasing back every answer', () => {
    const src = chatSrc();
    assert.ok(src.includes('Paraphrase') || src.includes('paraphrase') || src.includes('parroting'),
      'Must prohibit automatic paraphrasing');
  });

  it('requires evidence-based pattern-naming, not speculation', () => {
    const src = chatSrc();
    assert.ok(src.includes('evidence') && src.includes('not') && src.includes('speculat'),
      'Must require evidence over speculation');
  });
});

// ═══════════════════════════════════════════════════════════════════
// F. Safety boundaries preserved
// ═══════════════════════════════════════════════════════════════════

describe('Safety boundaries', () => {
  const chatSrc = () => read('server/src/routes/chat.js');

  it('maintains therapist boundary', () => {
    const src = chatSrc();
    assert.ok(
      src.toLowerCase().includes('not a therapist'),
      'Must maintain NOT-a-therapist boundary');
  });

  it('recommends professional support for genuine distress', () => {
    const src = chatSrc();
    assert.ok(
      src.includes('professional support') || src.includes('professional help'),
      'Must recommend professional support when warranted');
  });

  it('prohibits inventing or fabricating evidence', () => {
    const src = chatSrc();
    assert.ok(
      src.toLowerCase().includes('invent evidence') || src.toLowerCase().includes('never invent'),
      'Must prohibit inventing evidence');
  });
});

// ═══════════════════════════════════════════════════════════════════
// G. Backwards compatibility
// ═══════════════════════════════════════════════════════════════════

describe('Backwards compatibility', () => {
  it('coach.js settings endpoint still returns all cadence fields', () => {
    const src = read('server/src/routes/coach.js');
    for (const field of ['morning_enabled', 'morning_time', 'evening_enabled',
      'evening_time', 'weekly_enabled', 'weekly_dow', 'vision_review_interval_days']) {
      assert.ok(src.includes(field), `coach.js must still reference ${field}`);
    }
  });

  it('SYSTEM_PROMPT_BASE keeps the core coach while honoring the simplified product boundary', () => {
    const src = read('server/src/routes/chat.js');
    assert.ok(src.includes('personal coach and assistant embedded'));
    assert.ok(src.includes('Food logging'));
    assert.ok(src.includes('simplified Helm'));
    assert.equal(src.includes('## Custom modules'), false);
  });

  it('ONBOARDING_PROTOCOL still present', () => {
    const src = read('server/src/routes/chat.js');
    assert.ok(src.includes('ONBOARDING_PROTOCOL'));
    assert.ok(src.includes('PHASE 1'));
  });

  it('MEMORY_INSTRUCTIONS still present', () => {
    const src = read('server/src/routes/chat.js');
    assert.ok(src.includes('MEMORY_INSTRUCTIONS'));
    assert.ok(src.includes('save_memory'));
  });

  it('buildSystemPrompt still appends coach context and memories', () => {
    const src = read('server/src/routes/chat.js');
    assert.ok(src.includes('buildCoachContext'));
    assert.ok(src.includes('listMemories'));
  });
});

// ═══════════════════════════════════════════════════════════════════
// H. Recent arc DB query (isolated, seeded)
// ═══════════════════════════════════════════════════════════════════

describe('Recent arc - bounded 14-day query (isolated DB)', () => {
  let db, tmpDir;

  before(async () => {
    const { default: Database } = await import('better-sqlite3');
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'helm-arc-'));
    db = new Database(path.join(tmpDir, 'test.db'));
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    )`);
    const migrationsDir = path.join(ROOT, 'server', 'src', 'migrations');
    const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();
    for (const file of files) {
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      db.transaction(() => {
        db.exec(sql);
        db.prepare('INSERT INTO schema_migrations (name) VALUES (?)').run(file);
      })();
    }

    // Seed 20 days of morning check-ins using SQLite's clock
    for (let i = 0; i < 20; i++) {
      db.prepare(`INSERT INTO check_ins (kind, date, payload, coach_summary)
        VALUES ('morning', date('now', '-${i} days'), '{"day":${i}}', 'summary ${i}')`)
        .run();
    }
    // Add a few evening check-ins
    for (let i = 0; i < 5; i++) {
      db.prepare(`INSERT INTO check_ins (kind, date, payload, coach_summary)
        VALUES ('evening', date('now', '-${i} days'), '{"evening":${i}}', 'eve ${i}')`)
        .run();
    }
  });

  after(() => {
    if (db) db.close();
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('14-day query returns at most 60 rows, ordered desc', () => {
    const rows = db.prepare(`
      SELECT kind, date, payload, coach_summary
      FROM check_ins
      WHERE date >= date('now', '-14 days')
      ORDER BY date DESC, id DESC
      LIMIT 60
    `).all();
    assert.ok(rows.length > 0, 'Must return some rows');
    assert.ok(rows.length <= 60, 'Must respect LIMIT 60');
    // Should have ~15 mornings + ~5 evenings within 14 days
    assert.ok(rows.length >= 15, 'Should have at least 15 check-ins in 14 days');
    // Verify date ordering
    for (let i = 1; i < rows.length; i++) {
      assert.ok(rows[i - 1].date >= rows[i].date, 'Results must be ordered by date DESC');
    }
  });

  it('excludes check-ins older than 14 days', () => {
    const rows = db.prepare(`
      SELECT date FROM check_ins
      WHERE date >= date('now', '-14 days')
      ORDER BY date ASC
    `).all();
    const cutoff = db.prepare("SELECT date('now', '-14 days') AS d").get().d;
    for (const r of rows) {
      assert.ok(r.date >= cutoff, `${r.date} must be >= ${cutoff}`);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// I. mergeProfile merge and null-removal
// ═══════════════════════════════════════════════════════════════════

describe('mergeProfile behavior', () => {
  let mergeProfile;

  before(async () => {
    const mod = await import(path.join(ROOT, 'server', 'src', 'lib', 'coaching-profile.js'));
    mergeProfile = mod.mergeProfile;
  });

  it('merges new keys into existing profile', () => {
    const result = mergeProfile({ challenge_level: 3 }, { communication_style: 'direct' });
    assert.deepEqual(result, { challenge_level: 3, communication_style: 'direct' });
  });

  it('overwrites existing keys', () => {
    const result = mergeProfile({ challenge_level: 3 }, { challenge_level: 5 });
    assert.equal(result.challenge_level, 5);
  });

  it('removes keys when value is null', () => {
    const result = mergeProfile(
      { challenge_level: 3, communication_style: 'direct' },
      { communication_style: null },
    );
    assert.deepEqual(result, { challenge_level: 3 });
    assert.ok(!('communication_style' in result));
  });

  it('does not mutate the original profile', () => {
    const original = { challenge_level: 3 };
    mergeProfile(original, { challenge_level: 5 });
    assert.equal(original.challenge_level, 3);
  });

  it('returns empty object when all keys nulled out', () => {
    const result = mergeProfile({ challenge_level: 3 }, { challenge_level: null });
    assert.deepEqual(result, {});
  });
});

// ═══════════════════════════════════════════════════════════════════
// J. Validation → 400 mapping (behavioral)
// ═══════════════════════════════════════════════════════════════════

describe('Coaching profile validation → 400 mapping', () => {
  let validateCoachingProfile;

  before(async () => {
    const mod = await import(path.join(ROOT, 'server', 'src', 'lib', 'coaching-profile.js'));
    validateCoachingProfile = mod.validateCoachingProfile;
  });

  it('validator throws on invalid input (route must convert to 400)', () => {
    // The pure validator throws plain Error; the route wraps it as errors.validation
    let caught;
    try { validateCoachingProfile({ foo: 'bar' }); } catch (e) { caught = e; }
    assert.ok(caught instanceof Error);
    assert.ok(!/ApiError/.test(caught.constructor.name),
      'validator must throw plain Error so the route can wrap it');
  });

  it('route code wraps validator errors with errors.validation', () => {
    const src = read('server/src/routes/coach.js');
    // The route must catch validator errors and re-throw as errors.validation
    assert.ok(
      src.includes('errors.validation(e.message)') || src.includes('errors.validation(e.message'),
      'route must convert plain Error to errors.validation');
  });

  it('breakthrough_moments rejects unknown subkeys', () => {
    assert.throws(
      () => validateCoachingProfile({
        breakthrough_moments: [{ date: '2026-01-01', description: 'ok', mood: 'happy' }],
      }),
      /unknown.*subkey|subkey/i,
    );
  });

  it('breakthrough_moments accepts valid date+description only', () => {
    assert.doesNotThrow(() => validateCoachingProfile({
      breakthrough_moments: [{ date: '2026-01-01', description: 'First streak' }],
    }));
  });
});

// ═══════════════════════════════════════════════════════════════════
// K. habitCompletion deduplication (isolated DB)
// ═══════════════════════════════════════════════════════════════════

describe('habitCompletion deduplication (isolated DB)', () => {
  let db, tmpDir;

  before(async () => {
    const { default: Database } = await import('better-sqlite3');
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'helm-habit-'));
    db = new Database(path.join(tmpDir, 'test.db'));
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    )`);
    const migrationsDir = path.join(ROOT, 'server', 'src', 'migrations');
    const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();
    for (const file of files) {
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      db.transaction(() => {
        db.exec(sql);
        db.prepare('INSERT INTO schema_migrations (name) VALUES (?)').run(file);
      })();
    }

    // Seed: one habit linked to TWO goals
    db.prepare("INSERT INTO habits (name) VALUES ('Meditate')").run();
    const habitId = db.prepare('SELECT last_insert_rowid() AS id').get().id;
    db.prepare("INSERT INTO goals (title, horizon, status, position) VALUES ('Goal A', 'month', 'active', 0)").run();
    const goalA = db.prepare('SELECT last_insert_rowid() AS id').get().id;
    db.prepare("INSERT INTO goals (title, horizon, status, position) VALUES ('Goal B', 'quarter', 'active', 0)").run();
    const goalB = db.prepare('SELECT last_insert_rowid() AS id').get().id;
    db.prepare("INSERT INTO goal_links (goal_id, kind, target_id, notes) VALUES (?, 'habit', ?, '')").run(goalA, habitId);
    db.prepare("INSERT INTO goal_links (goal_id, kind, target_id, notes) VALUES (?, 'habit', ?, '')").run(goalB, habitId);
    // Log habit 3 times in last 14 days
    for (let i = 0; i < 3; i++) {
      db.prepare(`INSERT INTO habit_logs (habit_id, date) VALUES (?, date('now', '-${i} days'))`).run(habitId);
    }
  });

  after(() => {
    if (db) db.close();
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('habit linked to 2 goals appears exactly once with GROUP BY', () => {
    const rows = db.prepare(`
      SELECT h.id, h.name,
             (SELECT COUNT(*) FROM habit_logs hl
              WHERE hl.habit_id = h.id AND hl.date >= date('now', '-14 days')) AS logged_14d
      FROM habits h
      INNER JOIN goal_links gl ON gl.kind = 'habit' AND gl.target_id = h.id
      WHERE h.archived_at IS NULL
      GROUP BY h.id
      LIMIT 20
    `).all();
    assert.equal(rows.length, 1, 'habit must appear exactly once');
    assert.equal(rows[0].name, 'Meditate');
    assert.equal(rows[0].logged_14d, 3, 'logged_14d must count distinct logs, not multiply by links');
  });

  it('without GROUP BY it would duplicate', () => {
    const rows = db.prepare(`
      SELECT h.id, h.name,
             (SELECT COUNT(*) FROM habit_logs hl
              WHERE hl.habit_id = h.id AND hl.date >= date('now', '-14 days')) AS logged_14d
      FROM habits h
      INNER JOIN goal_links gl ON gl.kind = 'habit' AND gl.target_id = h.id
      WHERE h.archived_at IS NULL
      LIMIT 20
    `).all();
    assert.equal(rows.length, 2, 'without GROUP BY the habit appears twice (the bug)');
  });

  it('production query in chat.js includes GROUP BY', () => {
    const src = read('server/src/routes/chat.js');
    // Extract the habitCompletion query and verify it has GROUP BY
    assert.ok(src.includes('GROUP BY h.id'), 'habitCompletion query must GROUP BY h.id');
  });
});

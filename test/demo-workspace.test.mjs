import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

const ROOT = path.resolve(import.meta.dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'create-demo-workspace.mjs');

function tempDatabase() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'helm-demo-workspace-'));
  return { dir, database: path.join(dir, 'demo.db') };
}

function run(args, env = {}) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, NODE_ENV: 'test', ...env },
  });
}

function tableCount(database, table) {
  const db = new Database(database, { readonly: true });
  try {
    return db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count;
  } finally {
    db.close();
  }
}

function normalizedSnapshot(database) {
  const db = new Database(database, { readonly: true });
  try {
    return {
      vision: db.prepare('SELECT north_star, identity_statement, core_values FROM vision').get(),
      goals: db.prepare('SELECT parent_id, title, description, horizon, status, target_date, success_criteria, position FROM goals ORDER BY id').all(),
      boards: db.prepare('SELECT name, position FROM boards ORDER BY id').all(),
      columns: db.prepare('SELECT board_id, name, position FROM columns ORDER BY id').all(),
      cards: db.prepare('SELECT column_id, title, notes, due_date, color, position FROM cards ORDER BY id').all(),
      habits: db.prepare('SELECT name, description, goal_quantity, unit, days_of_week, time_of_day, category, position FROM habits ORDER BY id').all(),
      habitLogs: db.prepare('SELECT habit_id, date, quantity, note FROM habit_logs ORDER BY id').all(),
      meals: db.prepare('SELECT date, meal_type, name, calories, protein_g, carbs_g, fat_g, fiber_g, sugar_g, processed, organic, added_sugar, notes FROM meals ORDER BY id').all(),
      exercises: db.prepare('SELECT name, kind, muscle_group, notes FROM exercises ORDER BY id').all(),
      routines: db.prepare('SELECT name, notes, position FROM routines ORDER BY id').all(),
      routineExercises: db.prepare('SELECT routine_id, exercise_id, position, target_sets, target_reps, target_weight, target_time_seconds, target_distance_m, notes FROM routine_exercises ORDER BY id').all(),
      workouts: db.prepare('SELECT name, routine_id, started_at, ended_at, notes FROM workouts ORDER BY id').all(),
      workoutExercises: db.prepare('SELECT workout_id, exercise_id, position, notes FROM workout_exercises ORDER BY id').all(),
      sets: db.prepare('SELECT workout_exercise_id, position, weight_kg, reps, time_seconds, distance_m, rpe, completed, is_warmup, note FROM sets ORDER BY id').all(),
      checkIns: db.prepare('SELECT kind, date, payload, coach_summary FROM check_ins ORDER BY id').all(),
      links: db.prepare('SELECT goal_id, kind, target_id, notes FROM goal_links ORDER BY id').all(),
      obstacles: db.prepare('SELECT goal_id, obstacle, if_then FROM goal_obstacles ORDER BY id').all(),
      foodSettings: db.prepare('SELECT calorie_target, protein_g_target, carbs_g_target, fat_g_target, weight_goal_kg FROM food_settings').get(),
    };
  } finally {
    db.close();
  }
}

describe('deterministic synthetic demo workspace generator', () => {
  it('requires an explicit database path and never falls back to live data', () => {
    const result = run([]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /--database is required/i);
  });

  it('uses an explicit ephemeral token instead of an existing installation token', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'helm-demo-auth-'));
    try {
      const authDir = path.join(dir, 'server', 'src');
      const libDir = path.join(authDir, 'lib');
      fs.mkdirSync(libDir, { recursive: true });
      fs.copyFileSync(path.join(ROOT, 'server', 'src', 'auth.js'), path.join(authDir, 'auth.js'));
      fs.copyFileSync(
        path.join(ROOT, 'server', 'src', 'lib', 'state-paths.js'),
        path.join(libDir, 'state-paths.js'),
      );
      fs.writeFileSync(path.join(dir, '.dashboard-token'), 'live-installation-token\n');
      const result = spawnSync(
        process.execPath,
        ['--input-type=module', '--eval', "import('./server/src/auth.js').then(({ getToken }) => process.stdout.write(getToken()))"],
        {
          cwd: dir,
          encoding: 'utf8',
          env: {
            ...process.env,
            NODE_TEST_CONTEXT: 'helm-demo-workspace',
            DASHBOARD_TOKEN: 'isolated-ephemeral-token',
          },
        },
      );
      assert.equal(result.status, 0, result.stderr || result.stdout);
      assert.equal(result.stdout, 'isolated-ephemeral-token');
      assert.equal(fs.readFileSync(path.join(dir, '.dashboard-token'), 'utf8'), 'live-installation-token\n');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('seeds every supported demo domain through the API and reports verified readback', () => {
    const { dir, database } = tempDatabase();
    try {
      const result = run(['--database', database, '--json']);
      assert.equal(result.status, 0, result.stderr || result.stdout);
      const report = JSON.parse(result.stdout.trim());
      assert.equal(report.verified, true);
      assert.equal(report.database, path.resolve(database));
      assert.deepEqual(report.counts, {
        goals: 3,
        boards: 2,
        cards: 6,
        habits: 3,
        meals: 4,
        exercises: 2,
        routines: 1,
        workouts: 1,
        check_ins: 3,
        goal_links: 7,
        habit_logs: 5,
        workout_sets: 4,
        obstacles: 1,
      });
      for (const table of ['goals', 'boards', 'cards', 'habits', 'habit_logs', 'meals', 'routines', 'workouts', 'check_ins', 'goal_links']) {
        assert.ok(tableCount(database, table) > 0, `${table} should contain synthetic demo rows`);
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses a non-blank database without changing any existing row', () => {
    const { dir, database } = tempDatabase();
    try {
      const first = run(['--database', database, '--json']);
      assert.equal(first.status, 0, first.stderr || first.stdout);
      const before = normalizedSnapshot(database);

      const second = run(['--database', database, '--json']);
      assert.notEqual(second.status, 0);
      assert.match(second.stderr, /target already exists/i);
      assert.deepEqual(normalizedSnapshot(database), before);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses any pre-existing target file before SQLite or migrations can touch it', () => {
    const { dir, database } = tempDatabase();
    try {
      const sentinel = Buffer.from('existing file must remain byte-identical');
      fs.writeFileSync(database, sentinel);
      const result = run(['--database', database, '--json']);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /target already exists/i);
      assert.deepEqual(fs.readFileSync(database), sentinel);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('removes staging data and leaves no target after a mid-seed failure', () => {
    const { dir, database } = tempDatabase();
    try {
      const result = run(
        ['--database', database, '--json'],
        { HELM_DEMO_TEST_FAIL_AFTER_WRITE: '8' },
      );
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /injected demo seed failure/i);
      assert.equal(fs.existsSync(database), false);
      assert.deepEqual(fs.readdirSync(dir), []);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses publication when deep API readback evidence is corrupted', () => {
    const { dir, database } = tempDatabase();
    try {
      const result = run(
        ['--database', database, '--json'],
        { HELM_DEMO_TEST_CORRUPT_READBACK: 'exercise' },
      );
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /API readback verification failed for exercise evidence/i);
      assert.equal(fs.existsSync(database), false);
      assert.deepEqual(fs.readdirSync(dir), []);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses a pre-existing database even when only an exercise remains', () => {
    const { dir, database } = tempDatabase();
    try {
      const seeded = run(['--database', database, '--json']);
      assert.equal(seeded.status, 0, seeded.stderr || seeded.stdout);
      const db = new Database(database);
      try {
        db.pragma('foreign_keys = OFF');
        for (const table of [
          'goal_links', 'goal_obstacles', 'check_ins', 'goals',
          'cards', 'columns', 'boards', 'habit_outcomes', 'habit_logs', 'habits',
          'meals', 'food_days', 'sets', 'workout_exercises', 'workouts',
          'routine_exercises', 'routines',
        ]) db.exec(`DELETE FROM ${table}`);
        db.exec("UPDATE vision SET north_star = '', identity_statement = '', core_values = ''");
        db.exec('UPDATE food_settings SET calorie_target = NULL, protein_g_target = NULL, carbs_g_target = NULL, fat_g_target = NULL, weight_goal_kg = NULL');
      } finally {
        db.close();
      }
      const exerciseCount = tableCount(database, 'exercises');

      const result = run(['--database', database, '--json']);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /target already exists/i);
      assert.equal(tableCount(database, 'exercises'), exerciseCount);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('produces identical fictional content from two blank databases', () => {
    const a = tempDatabase();
    const b = tempDatabase();
    try {
      const first = run(['--database', a.database, '--json']);
      const second = run(['--database', b.database, '--json']);
      assert.equal(first.status, 0, first.stderr || first.stdout);
      assert.equal(second.status, 0, second.stderr || second.stdout);
      assert.deepEqual(normalizedSnapshot(a.database), normalizedSnapshot(b.database));
    } finally {
      fs.rmSync(a.dir, { recursive: true, force: true });
      fs.rmSync(b.dir, { recursive: true, force: true });
    }
  });
});

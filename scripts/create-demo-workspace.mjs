#!/usr/bin/env node

import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';

const argv = process.argv.slice(2);
const jsonOutput = argv.includes('--json');
const databaseIndex = argv.indexOf('--database');
const databaseArg = databaseIndex >= 0 ? argv[databaseIndex + 1] : null;

function fail(message) {
  process.stderr.write(`demo workspace: ${message}\n`);
  process.exitCode = 1;
}

if (!databaseArg || databaseArg.startsWith('--')) {
  fail('--database is required; refusing to use Helm’s default data path');
} else {
  await main(path.resolve(databaseArg));
}

async function main(database) {
  if (fs.existsSync(database)) {
    fail('target already exists; refusing to overwrite any database or file');
    return;
  }
  fs.mkdirSync(path.dirname(database), { recursive: true });
  const staging = path.join(
    path.dirname(database),
    `.${path.basename(database)}.${process.pid}.${Date.now()}.staging`,
  );
  process.env.DASHBOARD_DB_PATH = staging;
  // Force a one-process credential so this private loopback API path never
  // reads, reuses, modifies, prints, or materializes an installation token.
  process.env.NODE_TEST_CONTEXT = process.env.NODE_TEST_CONTEXT || 'helm-demo-workspace';
  process.env.DASHBOARD_TOKEN = crypto.randomBytes(32).toString('hex');

  const originalLog = console.log;
  console.log = (...args) => process.stderr.write(`${args.join(' ')}\n`);

  let server;
  let db;
  let report;
  let verified = false;
  try {
    const [{ createApp }, { getToken }, dbModule] = await Promise.all([
      import('../server/src/app.js'),
      import('../server/src/auth.js'),
      import('../server/src/db.js'),
    ]);
    db = dbModule.db;

    const app = createApp();
    await new Promise((resolve, reject) => {
      server = app.listen(0, '127.0.0.1', resolve);
      server.once('error', reject);
    });

    const base = `http://127.0.0.1:${server.address().port}/api`;
    const headers = {
      authorization: `Bearer ${getToken()}`,
      'content-type': 'application/json',
    };

    let writeCount = 0;
    const injectedFailureAfter = Number.parseInt(process.env.HELM_DEMO_TEST_FAIL_AFTER_WRITE || '', 10);
    async function request(method, endpoint, body) {
      if (method !== 'GET') {
        writeCount += 1;
        if (Number.isInteger(injectedFailureAfter) && writeCount === injectedFailureAfter) {
          throw new Error(`injected demo seed failure after ${writeCount - 1} writes`);
        }
      }
      const response = await fetch(base + endpoint, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await response.text();
      let payload = null;
      if (text) {
        try { payload = JSON.parse(text); } catch { payload = text; }
      }
      if (!response.ok) {
        const detail = payload?.error?.message || text || response.statusText;
        throw new Error(`${method} ${endpoint} returned ${response.status}: ${detail}`);
      }
      return payload;
    }

    const get = (endpoint) => request('GET', endpoint);
    const post = (endpoint, body) => request('POST', endpoint, body);
    const patch = (endpoint, body) => request('PATCH', endpoint, body);

    const before = await readback(get);
    if (!isBlank(before)) {
      throw new Error('refusing to overwrite non-blank database; choose a new --database path');
    }

    await patch('/coach/vision', {
      north_star: 'In the fictional harbor town of Port Aurora, Rowan Hale runs a small design studio, stays close to friends, and has enough margin for slow weekends outdoors.',
      identity_statement: 'I am the kind of person who finishes useful work, trains with patience, and makes time for the people around me.',
      values: '- Craft\n- Reliability\n- Curiosity\n- Community',
    });

    const yearGoal = await post('/coach/goals', {
      title: 'Build a resilient one-person studio',
      description: 'Fictional goal: make client delivery predictable without filling every evening.',
      horizon: 'year',
      target_date: '2026-12-18',
      success_criteria: 'Three repeat clients and a four-day delivery week for eight consecutive weeks.',
      position: 1000,
    });
    const quarterGoal = await post('/coach/goals', {
      parent_id: yearGoal.id,
      title: 'Ship the Port Aurora field guide',
      description: 'Create a compact visual guide for an imaginary coastal walking route.',
      horizon: 'quarter',
      target_date: '2026-03-27',
      success_criteria: 'A reviewed print-ready guide and a simple launch page.',
      position: 1000,
    });
    const weekGoal = await post('/coach/goals', {
      parent_id: quarterGoal.id,
      title: 'Complete the first guide proof',
      description: 'Turn the current material into one reviewable proof.',
      horizon: 'week',
      target_date: '2026-01-16',
      success_criteria: 'A twelve-page proof shared with two fictional reviewers.',
      position: 1000,
    });

    await post(`/coach/goals/${weekGoal.id}/obstacles`, {
      obstacle: 'Small polish tasks crowd out the first complete proof.',
      if_then: 'IF polishing starts before the proof is complete THEN finish the next missing page first.',
    });

    const workBoard = await post('/boards', { name: 'Studio', position: 1000 });
    const workNext = await post(`/boards/${workBoard.id}/columns`, { name: 'Next', position: 1000 });
    const workDoing = await post(`/boards/${workBoard.id}/columns`, { name: 'In Progress', position: 2000 });
    const workDone = await post(`/boards/${workBoard.id}/columns`, { name: 'Done', position: 3000 });
    const proofCard = await post(`/columns/${workDoing.id}/cards`, {
      title: 'Assemble the field guide proof',
      notes: 'Combine the fictional route map, captions, and cover into one reviewable PDF.',
      due_date: '2026-01-15',
      color: '#4f7cac',
      position: 1000,
    });
    await post(`/columns/${workNext.id}/cards`, {
      title: 'Request two proof reviews',
      notes: 'Send the completed fictional proof to Mira and Theo.',
      due_date: '2026-01-16',
      position: 1000,
    });
    await post(`/columns/${workDone.id}/cards`, {
      title: 'Select the guide route',
      notes: 'The fictional lighthouse loop was selected.',
      due_date: '2026-01-09',
      position: 1000,
    });

    const lifeBoard = await post('/boards', { name: 'Life', position: 2000 });
    const lifeNext = await post(`/boards/${lifeBoard.id}/columns`, { name: 'Next', position: 1000 });
    const lifeDone = await post(`/boards/${lifeBoard.id}/columns`, { name: 'Done', position: 2000 });
    const walkCard = await post(`/columns/${lifeNext.id}/cards`, {
      title: 'Plan Saturday ridge walk',
      notes: 'Pick a weather-safe route and pack lunch.',
      due_date: '2026-01-17',
      color: '#5b8c5a',
      position: 1000,
    });
    await post(`/columns/${lifeNext.id}/cards`, {
      title: 'Call Aunt Nessa',
      notes: 'Catch up before her fictional gallery opening.',
      due_date: '2026-01-14',
      position: 2000,
    });
    await post(`/columns/${lifeDone.id}/cards`, {
      title: 'Repair the blue bicycle light',
      notes: 'Replaced the battery pack.',
      due_date: '2026-01-10',
      position: 1000,
    });

    const focusHabit = await post('/habits', {
      name: 'Focused studio block',
      description: 'One distraction-free block on the guide.',
      goal_quantity: 45,
      unit: 'min',
      days_of_week: '1,2,3,4,5',
      time_of_day: 'morning',
      category: 'Studio',
      position: 1000,
    });
    const walkHabit = await post('/habits', {
      name: 'Harbor walk',
      description: 'Walk outside without headphones.',
      goal_quantity: 30,
      unit: 'min',
      days_of_week: '1,2,3,4,5,6,7',
      time_of_day: 'afternoon',
      category: 'Health',
      position: 2000,
    });
    const readingHabit = await post('/habits', {
      name: 'Read fiction',
      description: 'End the day with a novel.',
      goal_quantity: 10,
      unit: 'page',
      days_of_week: '1,2,3,4,5,6,7',
      time_of_day: 'evening',
      category: 'Rest',
      position: 3000,
    });
    for (const [habitId, date, quantity, note] of [
      [focusHabit.id, '2026-01-12', 50, 'Completed the route-map spread.'],
      [focusHabit.id, '2026-01-13', 45, 'Drafted captions.'],
      [walkHabit.id, '2026-01-12', 35, 'Walked the east quay.'],
      [walkHabit.id, '2026-01-13', 30, 'Short loop after lunch.'],
      [readingHabit.id, '2026-01-12', 14, 'Read before bed.'],
    ]) {
      await post(`/habits/${habitId}/log`, { date, quantity, note });
    }

    await patch('/food/settings', {
      calorie_target: 2200,
      protein_g_target: 120,
      carbs_g_target: 250,
      fat_g_target: 70,
    });
    for (const meal of [
      { date: '2026-01-13', meal_type: 'breakfast', name: 'Oats with pear and walnuts', calories: 510, protein_g: 18, carbs_g: 72, fat_g: 18, fiber_g: 11, sugar_g: 19 },
      { date: '2026-01-13', meal_type: 'lunch', name: 'Lentil soup and rye toast', calories: 620, protein_g: 29, carbs_g: 91, fat_g: 16, fiber_g: 20, sugar_g: 9 },
      { date: '2026-01-13', meal_type: 'snack', name: 'Plain yogurt with berries', calories: 230, protein_g: 17, carbs_g: 28, fat_g: 6, fiber_g: 5, sugar_g: 18 },
      { date: '2026-01-13', meal_type: 'dinner', name: 'Roast salmon, potatoes, and greens', calories: 760, protein_g: 51, carbs_g: 67, fat_g: 31, fiber_g: 10, sugar_g: 8 },
    ]) {
      await post('/food/meals', { ...meal, processed: false, organic: false, added_sugar: false, notes: 'Fictional demo meal.' });
    }

    const squat = await post('/exercises', { name: 'Goblet Squat', kind: 'lifting', muscle_group: 'Legs', notes: 'Fictional demo exercise.' });
    const row = await post('/exercises', { name: 'One-arm Row', kind: 'lifting', muscle_group: 'Back', notes: 'Fictional demo exercise.' });
    const routine = await post('/routines', { name: 'Patient Strength', notes: 'A short fictional full-body routine.', position: 1000 });
    await post(`/routines/${routine.id}/exercises`, { exercise_id: squat.id, target_sets: 0, target_reps: 8, target_weight: 20, position: 1000 });
    await post(`/routines/${routine.id}/exercises`, { exercise_id: row.id, target_sets: 0, target_reps: 10, target_weight: 16, position: 2000 });
    const workout = await post('/workouts', { name: 'Patient Strength A', routine_id: routine.id });
    for (const exercise of workout.exercises) {
      const isSquat = exercise.exercise_id === squat.id;
      await post(`/workouts/exercise/${exercise.id}/sets`, { weight_kg: isSquat ? 20 : 16, reps: isSquat ? 8 : 10, rpe: 7, completed: true, position: 1000 });
      await post(`/workouts/exercise/${exercise.id}/sets`, { weight_kg: isSquat ? 20 : 16, reps: isSquat ? 8 : 10, rpe: 7.5, completed: true, position: 2000 });
    }
    await patch(`/workouts/${workout.id}`, {
      started_at: '2026-01-11T09:00:00.000Z',
      ended_at: '2026-01-11T09:42:00.000Z',
      notes: 'Steady fictional demo session.',
    });

    for (const checkIn of [
      { kind: 'morning', date: '2026-01-12', payload: { must_win_card_id: proofCard.id, must_win_title: proofCard.title, supporting_card_ids: [walkCard.id], constraints: ['Client call at 14:00'], if_then: 'If the first block is interrupted, resume after lunch.' }, coach_summary: 'Finish a complete proof before polishing individual pages.' },
      { kind: 'evening', date: '2026-01-12', payload: { completed_card_ids: [], win: 'The route-map spread is complete.', friction: 'Caption research ran long.', adjustment: 'Time-box the remaining captions.' }, coach_summary: 'Good progress on the proof; protect tomorrow’s first block.' },
      { kind: 'weekly', date: '2026-01-11', payload: { wins: ['Selected the fictional lighthouse route'], misses: ['Did not request early feedback'], adjustments: ['Share the first complete proof sooner'] }, coach_summary: 'The project is moving; earlier review is the next leverage point.' },
    ]) {
      await post('/coach/checkins', checkIn);
    }

    for (const [goalId, kind, targetId, notes] of [
      [weekGoal.id, 'card', proofCard.id, 'Primary weekly deliverable.'],
      [weekGoal.id, 'habit', focusHabit.id, 'Daily execution evidence.'],
      [quarterGoal.id, 'card', proofCard.id, 'Proof advances the quarterly guide.'],
      [quarterGoal.id, 'routine', routine.id, 'Keeps training sustainable during delivery.'],
      [yearGoal.id, 'habit', walkHabit.id, 'Protects recovery and creative margin.'],
      [yearGoal.id, 'workout', workout.id, 'Completed training evidence.'],
      [yearGoal.id, 'food_target', 1, 'Simple nutrition targets support steady energy.'],
    ]) {
      await post(`/coach/goals/${goalId}/links`, { kind, target_id: targetId, notes });
    }

    const after = await readback(get);
    if (process.env.HELM_DEMO_TEST_CORRUPT_READBACK === 'exercise' && after.exercises[0]) {
      after.exercises[0] = { ...after.exercises[0], name: 'Corrupted Exercise' };
    }
    const counts = verifyReadback(after);
    report = { verified: true, database, counts };
    verified = true;
  } catch (error) {
    fail(error.message);
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (db?.open) db.close();
    console.log = originalLog;
    if (verified) {
      try {
        // Hard-link publication is fail-closed: unlike rename(), it cannot
        // replace a target that appeared while seeding. Staging is on the same
        // filesystem, so the verified bytes become visible atomically.
        fs.linkSync(staging, database);
        fs.unlinkSync(staging);
        if (jsonOutput) process.stdout.write(`${JSON.stringify(report)}\n`);
        else process.stdout.write(`Created and verified fictional Helm demo workspace at ${database}\n${JSON.stringify(report.counts, null, 2)}\n`);
      } catch (error) {
        fail(`could not publish verified database: ${error.message}`);
      }
    }
    for (const file of [staging, `${staging}-wal`, `${staging}-shm`]) {
      try { fs.rmSync(file, { force: true }); } catch {}
    }
  }
}

async function readback(get) {
  const [vision, goals, boards, cards, habits, meals, foodSettings, exercises, routines, workouts, checkIns] = await Promise.all([
    get('/coach/vision'),
    get('/coach/goals'),
    get('/boards'),
    get('/cards'),
    get('/habits'),
    get('/food/meals?from=1900-01-01&to=9999-12-31'),
    get('/food/settings'),
    get('/exercises'),
    get('/routines'),
    get('/workouts?from=1900-01-01&to=9999-12-31&limit=500'),
    get('/coach/checkins?from=1900-01-01&to=9999-12-31'),
  ]);
  const [habitLogGroups, workoutDetails] = await Promise.all([
    Promise.all(habits.map((habit) => get(`/habits/${habit.id}/logs?from=1900-01-01&to=9999-12-31`))),
    Promise.all(workouts.map((workout) => get(`/workouts/${workout.id}`))),
  ]);
  return {
    vision, goals, boards, cards, habits, meals, foodSettings, exercises, routines,
    workouts: workoutDetails,
    checkIns,
    habitLogs: habitLogGroups.flat(),
  };
}

function isBlank(data) {
  const visionBlank = !data.vision?.north_star?.trim()
    && !data.vision?.identity_statement?.trim()
    && !data.vision?.values?.trim();
  const foodSettingsBlank = [
    'calorie_target', 'protein_g_target', 'carbs_g_target', 'fat_g_target', 'weight_goal_kg',
  ].every((key) => data.foodSettings?.[key] == null);
  return visionBlank && foodSettingsBlank
    && ['goals', 'boards', 'cards', 'habits', 'meals', 'exercises', 'routines', 'workouts', 'checkIns']
      .every((key) => data[key].length === 0);
}

function verifyReadback(data) {
  const counts = {
    goals: data.goals.length,
    boards: data.boards.length,
    cards: data.cards.length,
    habits: data.habits.length,
    meals: data.meals.length,
    exercises: data.exercises.length,
    routines: data.routines.length,
    workouts: data.workouts.length,
    check_ins: data.checkIns.length,
    goal_links: data.goals.reduce((sum, goal) => sum + goal.links.length, 0),
    habit_logs: data.habitLogs.length,
    workout_sets: data.workouts.reduce(
      (sum, workout) => sum + workout.exercises.reduce((subtotal, exercise) => subtotal + exercise.sets.length, 0),
      0,
    ),
    obstacles: data.goals.reduce((sum, goal) => sum + goal.obstacles.length, 0),
  };
  const expected = {
    goals: 3, boards: 2, cards: 6, habits: 3, meals: 4, exercises: 2,
    routines: 1, workouts: 1, check_ins: 3, goal_links: 7,
    habit_logs: 5, workout_sets: 4, obstacles: 1,
  };
  for (const [key, value] of Object.entries(expected)) {
    if (counts[key] !== value) throw new Error(`API readback verification failed for ${key}: expected ${value}, got ${counts[key]}`);
  }
  if (!data.vision.north_star.includes('Port Aurora')) throw new Error('API readback verification failed for fictional vision');
  if (!data.goals.some((goal) => goal.title === 'Complete the first guide proof')) throw new Error('API readback verification failed for goal tree');
  if (!data.boards.some((board) => board.name === 'Studio') || !data.boards.some((board) => board.name === 'Life')) {
    throw new Error('API readback verification failed for work/life boards');
  }
  if (data.foodSettings.calorie_target !== 2200 || data.foodSettings.protein_g_target !== 120) {
    throw new Error('API readback verification failed for food targets');
  }
  const exerciseEvidence = new Map(data.exercises.map((row) => [row.name, row]));
  for (const expectedExercise of [
    { name: 'Goblet Squat', kind: 'lifting', muscle_group: 'Legs', notes: 'Fictional demo exercise.' },
    { name: 'One-arm Row', kind: 'lifting', muscle_group: 'Back', notes: 'Fictional demo exercise.' },
  ]) {
    const actual = exerciseEvidence.get(expectedExercise.name);
    if (!actual || Object.entries(expectedExercise).some(([key, value]) => actual[key] !== value)) {
      throw new Error(`API readback verification failed for exercise evidence: ${expectedExercise.name}`);
    }
  }
  const routineEvidence = data.routines.find((row) => row.name === 'Patient Strength');
  if (!routineEvidence || routineEvidence.notes !== 'A short fictional full-body routine.'
    || routineEvidence.exercises.length !== 2
    || !routineEvidence.exercises.some((row) => row.exercise_id === exerciseEvidence.get('Goblet Squat').id && row.target_reps === 8 && row.target_weight === 20)
    || !routineEvidence.exercises.some((row) => row.exercise_id === exerciseEvidence.get('One-arm Row').id && row.target_reps === 10 && row.target_weight === 16)) {
    throw new Error('API readback verification failed for routine exercise evidence');
  }
  const expectedMeals = new Map([
    ['Oats with pear and walnuts', { calories: 510, protein_g: 18 }],
    ['Lentil soup and rye toast', { calories: 620, protein_g: 29 }],
    ['Plain yogurt with berries', { calories: 230, protein_g: 17 }],
    ['Roast salmon, potatoes, and greens', { calories: 760, protein_g: 51 }],
  ]);
  for (const meal of data.meals) {
    const expectedMeal = expectedMeals.get(meal.name);
    if (!expectedMeal || meal.calories !== expectedMeal.calories || meal.protein_g !== expectedMeal.protein_g
      || meal.notes !== 'Fictional demo meal.') {
      throw new Error(`API readback verification failed for meal evidence: ${meal.name}`);
    }
  }
  const expectedObstacle = data.goals.flatMap((goal) => goal.obstacles).find(
    (row) => row.obstacle === 'Small polish tasks crowd out the first complete proof.',
  );
  if (!expectedObstacle || expectedObstacle.if_then !== 'IF polishing starts before the proof is complete THEN finish the next missing page first.') {
    throw new Error('API readback verification failed for obstacle evidence');
  }
  const targetsByKind = new Map([
    ['card', new Set(data.cards.map((row) => row.id))],
    ['habit', new Set(data.habits.map((row) => row.id))],
    ['routine', new Set(data.routines.map((row) => row.id))],
    ['workout', new Set(data.workouts.map((row) => row.id))],
    ['food_target', new Set([1])],
  ]);
  for (const link of data.goals.flatMap((goal) => goal.links)) {
    if (!targetsByKind.get(link.kind)?.has(link.target_id)) {
      throw new Error(`API readback verification failed for ${link.kind} goal link ${link.id}`);
    }
  }
  if (!data.habitLogs.some((row) => row.note === 'Completed the route-map spread.')) {
    throw new Error('API readback verification failed for habit evidence');
  }
  if (!data.workouts[0].exercises.every(
    (exercise) => exercise.sets.length === 2 && exercise.sets.every((set) => {
      const expectedWeight = exercise.exercise_id === exerciseEvidence.get('Goblet Squat').id ? 20 : 16;
      const expectedReps = expectedWeight === 20 ? 8 : 10;
      return set.completed === 1 && set.weight_kg === expectedWeight && set.reps === expectedReps;
    }),
  )) {
    throw new Error('API readback verification failed for completed workout sets');
  }
  return counts;
}

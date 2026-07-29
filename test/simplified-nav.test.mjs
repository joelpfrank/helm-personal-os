// TDD tests for the simplified primary nav (Tasks/Food/Habits/Workouts/Coach)
// and the new CoachHubView that composes Today/Chat/Goals/Vision/Check-ins
// behind a compact secondary nav.
//
// This is a reversible presentation-layer change: LibraryView, ModuleView,
// custom modules, calendar, goals/vision/check-ins, agents, connections,
// API routes, migrations and MCP tools must all be retained untouched.
// Routing logic is pure (web/src/lib/nav.js) so the contract — including
// backward compatibility with pre-simplification hash links — is tested
// directly, the same way lib/cadence.js is tested elsewhere in this repo.

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));

// ── Pure routing contract ──────────────────────────────────────────

describe('nav.js — resolvePrimarySection', () => {
  let resolvePrimarySection, PRIMARY_SECTIONS;

  before(async () => {
    ({ resolvePrimarySection, PRIMARY_SECTIONS } = await import('../web/src/lib/nav.js'));
  });

  it('exposes the primary sections in the required order', () => {
    assert.deepEqual(PRIMARY_SECTIONS, ['tasks', 'food', 'habits', 'workouts', 'coach']);
  });

  it('resolves each new-style life-area link directly', () => {
    for (const id of ['tasks', 'food', 'habits', 'workouts']) {
      assert.equal(resolvePrimarySection({ section: id }), id);
    }
  });

  it('resolves the new-style coach link', () => {
    assert.equal(resolvePrimarySection({ section: 'coach' }), 'coach');
  });

  it('defaults to coach when there is no hash at all', () => {
    assert.equal(resolvePrimarySection({}), 'coach');
    assert.equal(resolvePrimarySection(undefined), 'coach');
  });

  it('routes old section=today and section=chat links into coach', () => {
    assert.equal(resolvePrimarySection({ section: 'today' }), 'coach');
    assert.equal(resolvePrimarySection({ section: 'chat' }), 'coach');
  });

  it('routes old section=library&lib=<life area> links to the matching primary area', () => {
    for (const id of ['tasks', 'food', 'habits', 'workouts']) {
      assert.equal(resolvePrimarySection({ section: 'library', lib: id }), id);
    }
  });

  it('routes old coach-library links (goals/vision/checkins) into coach', () => {
    for (const id of ['goals', 'vision', 'checkins']) {
      assert.equal(resolvePrimarySection({ section: 'library', lib: id }), 'coach');
    }
  });

  it('falls back safely for unknown lib values under section=library', () => {
    for (const lib of ['module:5', 'new-module', 'archived-modules', 'agents', 'settings', 'calendar', undefined]) {
      assert.equal(resolvePrimarySection({ section: 'library', lib }), 'coach');
    }
  });

  it('falls back safely for a wholly unrecognized section', () => {
    assert.equal(resolvePrimarySection({ section: 'nonsense' }), 'coach');
  });
});

describe('nav.js — resolveCoachTab', () => {
  let resolveCoachTab, COACH_TABS;

  before(async () => {
    ({ resolveCoachTab, COACH_TABS } = await import('../web/src/lib/nav.js'));
  });

  it('exposes the coach tabs with Today first', () => {
    assert.deepEqual(COACH_TABS, ['today', 'chat', 'goals', 'vision', 'checkins']);
  });

  it('defaults to the daily Today view', () => {
    assert.equal(resolveCoachTab({}), 'today');
    assert.equal(resolveCoachTab(undefined), 'today');
  });

  it('honours old section=today and section=chat links', () => {
    assert.equal(resolveCoachTab({ section: 'today' }), 'today');
    assert.equal(resolveCoachTab({ section: 'chat' }), 'chat');
  });

  it('honours old coach-library links for goals/vision/checkins', () => {
    for (const id of ['goals', 'vision', 'checkins']) {
      assert.equal(resolveCoachTab({ section: 'library', lib: id }), id);
    }
  });

  it('honours the new section=coach&ctab=<tab> link for every tab', () => {
    for (const id of ['today', 'chat', 'goals', 'vision', 'checkins']) {
      assert.equal(resolveCoachTab({ section: 'coach', ctab: id }), id);
    }
  });

  it('falls back to today for an unknown ctab under section=coach', () => {
    assert.equal(resolveCoachTab({ section: 'coach', ctab: 'nonsense' }), 'today');
    assert.equal(resolveCoachTab({ section: 'coach' }), 'today');
  });
});

// ── App shell wiring ────────────────────────────────────────────────

describe('App.jsx — simplified primary nav', () => {
  const src = () => read('web/src/App.jsx');

  it('imports the new primary views directly and the new CoachHubView', () => {
    const s = src();
    assert.match(s, /from '\.\/views\/TasksView\.jsx'/);
    assert.match(s, /from '\.\/views\/FoodView\.jsx'/);
    assert.match(s, /from '\.\/views\/HabitsView\.jsx'/);
    assert.match(s, /from '\.\/views\/WorkoutsView\.jsx'/);
    assert.match(s, /from '\.\/views\/CoachHubView\.jsx'/);
  });

  it('no longer imports or renders LibraryView directly', () => {
    const s = src();
    assert.ok(!/from '\.\/views\/LibraryView\.jsx'/.test(s), 'App should not import LibraryView anymore');
    assert.ok(!/<LibraryView/.test(s), 'App should not render LibraryView anymore');
  });

  it('primary nav lists Tasks, Food, Habits, Workouts, Coach in that order', () => {
    const s = src();
    const ids = [...s.matchAll(/id:\s*'(tasks|food|habits|workouts|coach)'/g)].map((m) => m[1]);
    assert.deepEqual(ids, ['tasks', 'food', 'habits', 'workouts', 'coach']);
  });

  it('renders each primary view directly, without a Library gate', () => {
    const s = src();
    assert.match(s, /<TasksView\s*\/>/);
    assert.match(s, /<FoodView\s*\/>/);
    assert.match(s, /<HabitsView\s*\/>/);
    assert.match(s, /<WorkoutsView\s*\/>/);
    assert.match(s, /<CoachHubView\s*\/>/);
  });

  it('drives its section state through the tested resolvePrimarySection helper', () => {
    const s = src();
    assert.match(s, /from '\.\/lib\/nav\.js'/);
    assert.match(s, /resolvePrimarySection/);
  });
});

// ── CoachHubView ─────────────────────────────────────────────────────

describe('CoachHubView.jsx — composes the old Coach experience', () => {
  it('exists', () => {
    assert.ok(exists('web/src/views/CoachHubView.jsx'), 'CoachHubView.jsx must exist');
  });

  const src = () => read('web/src/views/CoachHubView.jsx');

  it('imports the existing Today/Chat/Goals/Vision/CheckIns components rather than reimplementing them', () => {
    const s = src();
    assert.match(s, /from '\.\/TodayView\.jsx'/);
    assert.match(s, /from '\.\/ChatView\.jsx'/);
    assert.match(s, /from '\.\.\/components\/coach\/GoalsTree\.jsx'/);
    assert.match(s, /from '\.\.\/components\/coach\/VisionPanel\.jsx'/);
    assert.match(s, /from '\.\.\/components\/coach\/CheckInHistory\.jsx'/);
  });

  it('renders each composed view', () => {
    const s = src();
    assert.match(s, /<TodayView\s*\/>/);
    assert.match(s, /<ChatView\s*\/>/);
    assert.match(s, /<GoalsTree\s*\/>/);
    assert.match(s, /<VisionPanel\s*\/>/);
    assert.match(s, /<CheckInHistory\s*\/>/);
  });

  it('drives its active tab through the tested resolveCoachTab helper', () => {
    const s = src();
    assert.match(s, /from '\.\.\/lib\/nav\.js'/);
    assert.match(s, /resolveCoachTab/);
  });

  it('has a compact secondary nav distinct from the primary nav', () => {
    const s = src();
    assert.match(s, /coach-tabs/, 'expected a dedicated compact secondary-nav class');
  });

  it('loads coach data on mount so a cold-linked Vision or Goals tab cannot hang', () => {
    const s = src();
    assert.match(s, /useCoachStore/, 'CoachHub must read the coach store');
    assert.match(s, /fetchAll/, 'CoachHub must load briefing, vision and goals independently');
    assert.match(s, /useEffect\([\s\S]*fetchAll\(\)/, 'CoachHub must trigger the load on mount');
  });
});

describe('Coach prompt matches the simplified reachable interface', () => {
  const chat = () => read('server/src/routes/chat.js');
  const between = (s, start, end) => s.slice(s.indexOf(start), s.indexOf(end));

  it('describes only the five reachable primary surfaces', () => {
    const base = between(chat(), 'const SYSTEM_PROMPT_BASE', 'const COACH_INSTRUCTIONS');
    for (const label of ['Tasks', 'Food', 'Habits', 'Workouts', 'Coach']) {
      assert.match(base, new RegExp(`\\b${label}\\b`), `missing reachable surface ${label}`);
    }
    assert.doesNotMatch(base, /Library|Calendar|Custom modules|create_module/i);
  });

  it('onboards into built-ins instead of creating inaccessible modules or connections', () => {
    const onboarding = between(chat(), 'const ONBOARDING_PROTOCOL', 'const MEMORY_INSTRUCTIONS');
    for (const action of ['add_card', 'create_habit', 'create_routine', 'set_food_targets']) {
      assert.match(onboarding, new RegExp(action), `onboarding must retain ${action}`);
    }
    assert.doesNotMatch(onboarding, /Library|Connections|Calendar|module_templates|create_module/i);
  });

  it('does not reintroduce hidden modules or connected tools in assembled coach context', () => {
    const context = between(chat(), 'export function buildCoachContext', 'export function buildSystemPrompt');
    assert.doesNotMatch(context, /list_modules|Custom modules|Connected external tools|extServers/i);
  });

  it('keeps reachable Chat suggestions inside the simplified interface', () => {
    const transcript = read('web/src/components/chat/ChatTranscript.jsx');
    assert.doesNotMatch(transcript, /calendar|Library|Connections|custom module/i);
    assert.doesNotMatch(transcript, /what should I focus on today/i);
    for (const label of ['task', 'habit', 'workout']) {
      assert.match(transcript, new RegExp(label, 'i'));
    }
  });
});

// ── Retention: nothing old was deleted ──────────────────────────────

describe('Full prior implementation retained', () => {
  it('LibraryView.jsx still exists with every collection intact', () => {
    assert.ok(exists('web/src/views/LibraryView.jsx'));
    const s = read('web/src/views/LibraryView.jsx');
    const ids = [...s.matchAll(/id:\s*'([^']+)'/g)].map((m) => m[1]);
    for (const id of ['goals', 'vision', 'checkins', 'tasks', 'habits', 'workouts', 'food']) {
      assert.ok(ids.includes(id), `LibraryView must still offer ${id}`);
    }
  });

  it('ModuleView.jsx and custom-module plumbing still exist', () => {
    assert.ok(exists('web/src/views/ModuleView.jsx'));
    assert.ok(exists('web/src/state/modules.js'));
    assert.ok(exists('server/src/routes/modules.js'));
  });

  it('calendar infrastructure still exists', () => {
    assert.ok(exists('web/src/views/CalendarView.jsx'));
    assert.ok(exists('web/src/state/calendar.js'));
    assert.ok(exists('server/src/routes/calendar.js'));
  });

  it('goals/vision/check-in components and coach backend route still exist', () => {
    assert.ok(exists('web/src/components/coach/GoalsTree.jsx'));
    assert.ok(exists('web/src/components/coach/VisionPanel.jsx'));
    assert.ok(exists('web/src/components/coach/CheckInHistory.jsx'));
    assert.ok(exists('server/src/routes/coach.js'));
  });

  it('agents and connections plumbing still exist', () => {
    assert.ok(exists('web/src/views/AgentsView.jsx'));
    assert.ok(exists('web/src/state/agents.js'));
    assert.ok(exists('server/src/routes/agents.js'));
    assert.ok(exists('web/src/state/mcpServers.js'));
    assert.ok(exists('server/src/routes/mcp-servers.js'));
  });

  it('database migrations directory is untouched (no deletions)', () => {
    const dir = path.join(ROOT, 'server/src/migrations');
    assert.ok(fs.existsSync(dir));
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql'));
    assert.ok(files.length >= 22, 'no migration files should have been removed');
  });
});

// ── i18n parity ──────────────────────────────────────────────────────

describe('i18n — accurate nav labels in English and Spanish', () => {
  const i18n = () => read('web/src/lib/i18n.js');

  it('defines nav labels for every primary area and coach tab in English', () => {
    const s = i18n();
    for (const key of ['nav.tasks', 'nav.food', 'nav.habits', 'nav.workouts', 'nav.coach', 'nav.goals', 'nav.vision', 'nav.checkins']) {
      assert.match(s, new RegExp(`'${key.replace('.', '\\.')}':\\s*'[^']+'`), `missing English ${key}`);
    }
  });

  it('keeps the old nav.today / nav.chat / nav.library keys (still used by CoachHubView / back-compat)', () => {
    const s = i18n();
    assert.match(s, /'nav\.today':\s*'[^']+'/);
    assert.match(s, /'nav\.chat':\s*'[^']+'/);
    assert.match(s, /'nav\.library':\s*'[^']+'/);
  });

  it('every nav.* key defined in English also exists in Spanish, and vice versa', () => {
    const s = i18n();
    const en = s.slice(s.indexOf('  en: {'), s.indexOf('  es: {'));
    const es = s.slice(s.indexOf('  es: {'));
    const navKeys = (block) => [...block.matchAll(/'(nav\.[\w.]+)':/g)].map((m) => m[1]).sort();
    assert.deepEqual(navKeys(es), navKeys(en), 'nav.* keys must have full en/es parity');
  });
});

// ── Mobile: no document-level horizontal overflow ────────────────────

describe('Mobile nav layout', () => {
  it('the compact secondary Coach nav scrolls internally rather than overflowing the page', () => {
    const css = read('web/src/styles.css');
    assert.match(css, /\.coach-tabs\s*\{[^}]*overflow-x:\s*auto/s,
      'coach-tabs needs its own inner horizontal scroller so it never forces document-level horizontal overflow');
  });
});

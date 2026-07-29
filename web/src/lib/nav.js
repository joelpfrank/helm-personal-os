// Pure hash-routing helpers for the simplified primary/secondary nav.
//
// Primary nav is Tasks / Food / Habits / Workouts / Coach. Coach hosts the
// old Today / Chat / Goals / Vision / Check-ins views behind a compact
// secondary nav. These are pure functions (no DOM/React) so the routing
// contract — including backward compatibility with pre-simplification
// hash links — can be tested directly, the same way lib/cadence.js is.

export const PRIMARY_SECTIONS = ['tasks', 'food', 'habits', 'workouts', 'coach'];
export const COACH_TABS = ['today', 'chat', 'goals', 'vision', 'checkins'];

const LIFE_AREAS = ['tasks', 'food', 'habits', 'workouts'];
const COACH_LIBRARY_TABS = ['goals', 'vision', 'checkins'];

// Which primary area a hash resolves to. Understands both the new
// section=<primary id> links and the old section=today|chat|library(&lib=…)
// links, falling back safely to Coach for anything unrecognized.
export function resolvePrimarySection({ section, lib } = {}) {
  if (section === 'library') {
    return LIFE_AREAS.includes(lib) ? lib : 'coach';
  }
  if (section === 'today' || section === 'chat') return 'coach';
  return PRIMARY_SECTIONS.includes(section) ? section : 'coach';
}

// Which inner Coach tab is active. Understands the old section=today|chat
// and section=library&lib=goals|vision|checkins links, plus the new
// section=coach&ctab=<tab> links. Defaults to the daily Today view.
export function resolveCoachTab({ section, lib, ctab } = {}) {
  if (section === 'today') return 'today';
  if (section === 'chat') return 'chat';
  if (section === 'library' && COACH_LIBRARY_TABS.includes(lib)) return lib;
  if (section === 'coach' && COACH_TABS.includes(ctab)) return ctab;
  return 'today';
}

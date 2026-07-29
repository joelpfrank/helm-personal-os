// Grouping for the habits list: by time of day, by user category, or none.
// Habits arrive already ordered by position; groups preserve that order.

export const TIME_ORDER = ['morning', 'afternoon', 'evening', 'night', 'anytime'];

export const TIME_LABELS = {
  morning: 'Morning',
  afternoon: 'Afternoon',
  evening: 'Evening',
  night: 'Night',
  anytime: 'Anytime',
};

export const GROUP_MODES = ['none', 'time', 'category'];

// Returns [{ key, label, habits }]. label is null in 'none' mode
// (render the plain list, no headers). Empty groups are omitted.
export function groupHabits(habits, mode) {
  const list = habits || [];
  if (mode === 'time') {
    return TIME_ORDER
      .map((key) => ({
        key,
        label: TIME_LABELS[key],
        habits: list.filter((h) => (TIME_ORDER.includes(h.time_of_day) ? h.time_of_day : 'anytime') === key),
      }))
      .filter((g) => g.habits.length > 0);
  }
  if (mode === 'category') {
    // Merge case-insensitively; the first-seen casing becomes the label.
    const groups = new Map();
    for (const h of list) {
      const label = String(h.category || '').trim() || 'Uncategorized';
      const key = label.toLowerCase();
      if (!groups.has(key)) groups.set(key, { key, label, habits: [] });
      groups.get(key).habits.push(h);
    }
    const named = [...groups.values()].filter((g) => g.key !== 'uncategorized');
    named.sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));
    const blank = groups.get('uncategorized');
    return blank ? [...named, blank] : named;
  }
  return [{ key: 'all', label: null, habits: list }];
}

// Distinct categories currently in use, for form suggestions.
export function usedCategories(habits) {
  const seen = new Map();
  for (const h of habits || []) {
    const c = String(h.category || '').trim();
    if (c && !seen.has(c.toLowerCase())) seen.set(c.toLowerCase(), c);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

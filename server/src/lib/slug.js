// Shared slug generator used by the modules, agents, and MCP-server routes.
//
// Trim boundary underscores with indexes rather than an anchored alternation,
// which can force polynomial backtracking on a long hostile input.
export function slugify(s) {
  const normalized = String(s)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_');
  let start = 0;
  let end = normalized.length;
  while (start < end && normalized[start] === '_') start += 1;
  while (end > start && normalized[end - 1] === '_') end -= 1;
  return normalized.slice(start, end);
}

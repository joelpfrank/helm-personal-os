// Sparse-float position helper. New items append at max+1000. Reorders
// land at the midpoint between neighbors. Inserting at the head/tail
// uses head-1000 / tail+1000. Callers should normalize when neighbors
// drift below MIN_DELTA.

export const STEP = 1000;
export const MIN_DELTA = 1e-6;

export function appendPosition(rows) {
  if (!rows.length) return STEP;
  let max = 0;
  for (const r of rows) if (r.position > max) max = r.position;
  return max + STEP;
}

export function midpointPosition(prev, next) {
  if (prev == null && next == null) return STEP;
  if (prev == null) return next.position - STEP;
  if (next == null) return prev.position + STEP;
  return (prev.position + next.position) / 2;
}

export function needsNormalization(prev, next) {
  if (prev == null || next == null) return false;
  return Math.abs(next.position - prev.position) < MIN_DELTA;
}

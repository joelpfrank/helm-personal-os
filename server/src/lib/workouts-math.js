// Lifting / cardio math shared by exercises.js (stats endpoint),
// MCP suggestion tools, and any future place that wants to compute
// PR numbers without re-querying.

// Epley e1RM: weight × (1 + reps/30). Returns 0 for missing inputs.
export function epley(weight, reps) {
  const w = Number(weight);
  const r = Number(reps);
  if (!Number.isFinite(w) || !Number.isFinite(r) || w <= 0 || r <= 0) return 0;
  return w * (1 + r / 30);
}

// One "session" of sets is the set of completed working sets on a single
// workout for a single exercise. Computes the headline numbers we display.
export function sessionSummary(sets) {
  let topWeight = 0, topReps = 0, topE1rm = 0, totalVolume = 0;
  for (const s of sets) {
    if (!s.completed || s.is_warmup) continue;
    if (s.weight_kg == null || s.reps == null) continue;
    const e = epley(s.weight_kg, s.reps);
    totalVolume += s.weight_kg * s.reps;
    if (s.weight_kg > topWeight) { topWeight = s.weight_kg; topReps = s.reps; }
    if (e > topE1rm) topE1rm = e;
  }
  return {
    top_weight: topWeight,
    top_reps: topReps,
    top_e1rm: round2(topE1rm),
    total_volume: round2(totalVolume),
  };
}

export function cardioSessionSummary(sets) {
  let totalTime = 0, totalDist = 0;
  for (const s of sets) {
    if (!s.completed) continue;
    if (s.time_seconds != null) totalTime += s.time_seconds;
    if (s.distance_m != null) totalDist += s.distance_m;
  }
  const pace = (totalTime > 0 && totalDist > 0)
    ? totalTime / (totalDist / 1000)
    : null;
  return {
    total_time_s: totalTime,
    total_distance_m: round2(totalDist),
    avg_pace_s_per_km: pace ? round2(pace) : null,
  };
}

// Next-session suggestion driven by RPE on the heaviest working set
// of the most recent session.
export function liftingSuggestion(lastSession) {
  if (!lastSession || !lastSession.sets) return null;
  // Heaviest completed non-warmup set in the session.
  let top = null;
  for (const s of lastSession.sets) {
    if (!s.completed || s.is_warmup) continue;
    if (s.weight_kg == null || s.reps == null) continue;
    if (!top || s.weight_kg > top.weight_kg) top = s;
  }
  if (!top) return null;
  const reps = top.reps;
  const w = top.weight_kg;
  let nextWeight, reason;
  const rpe = top.rpe;
  if (rpe == null) {
    nextWeight = w + 2.5;
    reason = `Last session ${w}×${reps} (no RPE logged — assuming moderate). Try ${nextWeight} kg.`;
  } else if (rpe <= 8) {
    nextWeight = w + 2.5;
    reason = `Last session ${w}×${reps} @ RPE ${rpe}. Push +2.5 kg.`;
  } else if (rpe <= 9) {
    nextWeight = w;
    reason = `Last session ${w}×${reps} @ RPE ${rpe}. Repeat for one more session.`;
  } else {
    nextWeight = Math.max(0, w - 2.5);
    reason = `Last session ${w}×${reps} @ RPE ${rpe} (grinder). Deload to ${nextWeight} kg.`;
  }
  return {
    next_weight_kg: round2(nextWeight),
    next_reps: reps,
    reason,
  };
}

function round2(n) { return Math.round(n * 100) / 100; }

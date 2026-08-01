// Shared tri-state habit-outcome vocabulary for the UI.
//
// Three states, never two: 'success' (Achieved), 'failed' (Not achieved), and
// 'unspecified' (no judgement yet — a blank day, which is NOT a failure).
// Labels are humane words, not bare symbols, and each state has its own class
// hook so failed and unspecified are distinguishable structurally — not by
// colour alone.

export const OUTCOME_LABELS = {
  success: 'Achieved',
  failed: 'Not achieved',
  unspecified: 'Unspecified',
};

// Normalise anything falsy / unknown to 'unspecified'.
export function normalizeOutcome(status) {
  return status === 'success' || status === 'failed' ? status : 'unspecified';
}

export function outcomeLabel(status) {
  return OUTCOME_LABELS[normalizeOutcome(status)];
}

// Distinct class per state (ho-success / ho-failed / ho-unspecified) so styles
// and tests can tell them apart without relying on colour.
export function outcomeClass(status) {
  return `ho-${normalizeOutcome(status)}`;
}

// What a three-state control should do when the user presses `target` while the
// current effective status is `current`. Pressing the already-active state
// clears it back to unspecified (a second tap "un-marks"); pressing any other
// state sets that state.
export function nextOutcome(current, target) {
  const cur = normalizeOutcome(current);
  const tgt = normalizeOutcome(target);
  if (tgt === 'unspecified') return 'unspecified';
  return cur === tgt ? 'unspecified' : tgt;
}

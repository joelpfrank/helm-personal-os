export function restTimerSeconds(deadlineMs, nowMs = Date.now()) {
  return Math.ceil((deadlineMs - nowMs) / 1000);
}

export function formatRestTimer(seconds) {
  const overtime = seconds < 0;
  const absolute = Math.abs(seconds);
  const minutes = Math.floor(absolute / 60);
  const remainder = absolute % 60;
  return `${overtime ? '+' : ''}${minutes}:${String(remainder).padStart(2, '0')}`;
}

export function nextRestTimerDeadline(previousDeadlineMs, durationSeconds, nowMs = Date.now()) {
  const intervalMs = durationSeconds * 1000;
  const elapsedIntervals = Math.max(1, Math.ceil((nowMs - previousDeadlineMs) / intervalMs));
  return previousDeadlineMs + elapsedIntervals * intervalMs;
}

export function progressbarRange(value, maximum) {
  const numericMaximum = Number(maximum);
  if (!Number.isFinite(numericMaximum) || numericMaximum <= 0) return null;

  const ariaMaximum = Math.max(1, Math.round(numericMaximum));
  const numericValue = Number(value);
  const ariaValue = Number.isFinite(numericValue) ? Math.round(numericValue) : 0;
  return {
    'aria-valuemin': 0,
    'aria-valuemax': ariaMaximum,
    'aria-valuenow': Math.min(ariaMaximum, Math.max(0, ariaValue)),
  };
}

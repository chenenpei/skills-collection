/** Insufficient history sentinel — exceeds any spec max threshold (e.g. max: 5). */
const INSUFFICIENT_DECLINE_PP = 99;

/** Largest peak-to-trough gross margin drop over the last 3 fiscal years, in percentage points. */
export function computeGrossMarginMaxDeclinePp(margins: number[]): number {
  const window = margins.filter((m) => m > 0).slice(-3);
  if (window.length < 2) return INSUFFICIENT_DECLINE_PP;

  let peak = window[0];
  let maxDecline = 0;
  for (const margin of window) {
    peak = Math.max(peak, margin);
    maxDecline = Math.max(maxDecline, peak - margin);
  }
  return maxDecline * 100;
}

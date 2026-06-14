/** Progress and warnings go to stderr so stdout stays clean for piping. */
export interface ProgressLogger {
  phase(message: string): void;
  warn(message: string): void;
  tick(done: number, total: number, label?: string): void;
}

export interface ProgressLoggerOptions {
  prefix?: string;
  /** Minimum ms between non-final tick lines (final tick always prints). */
  throttleMs?: number;
}

export function createProgressLogger(opts: ProgressLoggerOptions = {}): ProgressLogger {
  const prefix = opts.prefix ?? "screener";
  const throttleMs = opts.throttleMs ?? 5000;
  let lastTickAt = Number.NEGATIVE_INFINITY;

  return {
    phase(message: string): void {
      console.error(`[${prefix}] ${message}`);
    },
    warn(message: string): void {
      console.error(`[${prefix}] warn: ${message}`);
    },
    tick(done: number, total: number, label = "progress"): void {
      const now = Date.now();
      const isDone = done >= total;
      if (!isDone && now - lastTickAt < throttleMs && done % 100 !== 0) return;
      lastTickAt = now;
      const pct = total > 0 ? ((done / total) * 100).toFixed(1) : "0.0";
      console.error(`[${prefix}] ${label}: ${done}/${total} (${pct}%)`);
    },
  };
}

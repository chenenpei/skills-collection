const queues = new Map<string, { running: number; waiters: Array<() => void> }>();

function queueFor(host: string) {
  let q = queues.get(host);
  if (!q) {
    q = { running: 0, waiters: [] };
    queues.set(host, q);
  }
  return q;
}

/** Bound concurrent in-flight requests per host (e.g. East Money, SEC). */
export async function withHostLimit<T>(
  host: string,
  maxConcurrent: number,
  fn: () => Promise<T>
): Promise<T> {
  const q = queueFor(host);
  if (q.running >= maxConcurrent) {
    await new Promise<void>((resolve) => {
      q.waiters.push(resolve);
    });
  }

  q.running += 1;
  try {
    return await fn();
  } finally {
    q.running -= 1;
    const next = q.waiters.shift();
    if (next) next();
  }
}

/** Collapse continuous reading activity while still saving at least once per maxWait interval. */
export function createPersistenceScheduler(save: () => Promise<void>, idleMs = 250, maxWaitMs = 1000) {
  let idle: ReturnType<typeof setTimeout> | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  function cancel() { clearTimeout(idle); clearTimeout(deadline); idle = undefined; deadline = undefined; }
  function flush() { cancel(); return save(); }
  function schedule() {
    clearTimeout(idle);
    const run = () => { void flush().catch(() => undefined); };
    idle = setTimeout(run, idleMs);
    deadline ??= setTimeout(run, maxWaitMs);
  }
  return { schedule, flush, cancel };
}

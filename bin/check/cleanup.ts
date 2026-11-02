/**
 * Work that must happen when a run is killed: stopping a child process,
 * removing a temp folder. `pnpm check` is often stopped by an agent's own
 * timeout, and without this wrangler, Chromium and their folders outlive it.
 */
const tasks = new Set<() => void | Promise<void>>();
let installed = false;

async function runAll(signal: NodeJS.Signals) {
  for (const task of [...tasks]) {
    try {
      await task();
    } catch {
      // Cleaning up must not stop the next task.
    }
  }
  process.exit(signal === "SIGINT" ? 130 : 143);
}

/** Registers `task` for SIGINT and SIGTERM. Returns a function that removes it again. */
export function onTerminate(task: () => void | Promise<void>): () => void {
  if (!installed) {
    installed = true;
    for (const signal of ["SIGINT", "SIGTERM"] as const) {
      process.on(signal, () => void runAll(signal));
    }
  }
  tasks.add(task);
  return () => {
    tasks.delete(task);
  };
}

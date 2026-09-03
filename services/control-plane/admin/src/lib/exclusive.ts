/** Prevents a confirm/action from running twice while the first call is in flight. */
export function createExclusiveGate() {
  let busy = false;
  return {
    get busy() {
      return busy;
    },
    async run(action: () => Promise<void>): Promise<boolean> {
      if (busy) return false;
      busy = true;
      try {
        await action();
        return true;
      } finally {
        busy = false;
      }
    },
  };
}

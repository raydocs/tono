// The workers-pool tsconfig has no DOM lib; the console's route hook touches
// `window` directly. Declare just the surface the hook uses so the tests can
// compile it and substitute a stub at runtime.
declare var window: {
  location: { hash: string };
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
};

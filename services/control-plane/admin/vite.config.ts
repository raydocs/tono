import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    // Maps are emitted for debugging but never referenced from the bundles,
    // so a browser only downloads them when an operator asks for them.
    sourcemap: 'hidden',
  },
});

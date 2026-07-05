import { defineConfig } from 'vitest/config';

// Separate from vite.config.ts, whose root points at web/ for the UI build.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
  },
});

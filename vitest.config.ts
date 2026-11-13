import { defineConfig } from 'vitest/config';

// Tests run in Node from the repo root (vite.config.ts points Vite at src/web instead).
export default defineConfig({
  test: {
    include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.ts'],
    environment: 'node',
    unstubEnvs: true,
  },
});

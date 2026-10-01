import { defineConfig, devices } from '@playwright/test';

/**
 * Browser smoke coverage for the built bundle.
 *
 * This is deliberately not a unit-test substitute. Every page in App.tsx is
 * loaded through `React.lazy(() => import(...))`, so the app only works if the
 * bundler emits the dynamic chunks AND the browser can fetch them at runtime.
 * A bundler upgrade that renumbers, mis-emits, or mis-resolves those chunks
 * still passes `tsc`, still passes vitest, and still produces a `dist/`
 * directory -- and only fails here, in a real browser. That is exactly the
 * regression class a Vite major or a Rollup-to-Rolldown swap can introduce,
 * so the suite runs against `vite preview` (the real build output) rather than
 * the dev server.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 45_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'off',
    video: 'off',
    screenshot: 'off',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // --host is not optional here. Without it `vite preview` binds whatever
    // "localhost" resolves to, which is ::1 first on Windows, and a baseURL of
    // 127.0.0.1 is then refused with ECONNREFUSED -- the server is running and
    // the suite still times out waiting for it.
    command: 'npm run preview -- --port 4173 --strictPort --host 127.0.0.1',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 90_000,
  },
});

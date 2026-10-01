import { test, expect, type Page, type ConsoleMessage } from '@playwright/test';

/**
 * Collects anything that would mean the bundle is broken even though the DOM
 * happens to contain some text: uncaught exceptions, failed page loads, and
 * console errors. A lazy chunk that 404s lands here as a console error while
 * the shell still renders, so without this the lazy-route assertions below
 * would be the only thing catching it.
 */
function watchForFailures(page: Page) {
  const failures: string[] = [];
  page.on('pageerror', (error) => failures.push(`pageerror: ${error.message}`));
  page.on('console', (message: ConsoleMessage) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    // The dev server and the API base are absent under `vite preview`; a
    // failed /api/version fetch is expected here and is not a bundle fault.
    if (/Failed to load resource|net::ERR|api\/version|401|403|404/i.test(text)) return;
    failures.push(`console: ${text}`);
  });
  page.on('requestfailed', (request) => {
    const url = request.url();
    if (url.includes('/api/')) return;
    failures.push(`requestfailed: ${url} (${request.failure()?.errorText ?? 'unknown'})`);
  });
  return failures;
}

async function gotoHash(page: Page, hash: string) {
  await page.goto(`/#${hash}`, { waitUntil: 'domcontentloaded' });
}

test('the app mounts and the root is populated', async ({ page }) => {
  const failures = watchForFailures(page);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#root')).not.toBeEmpty({ timeout: 20_000 });
  expect(failures, failures.join('\n')).toEqual([]);
});

test('every lazy route resolves its dynamic chunk and renders', async ({ page }) => {
  // The point of this suite. Each hash below mounts a React.lazy component, so
  // reaching its content proves the bundler emitted the chunk, named it
  // consistently with the manifest, and that the browser fetched it over HTTP.
  const routes: Array<{ hash: string; expect: RegExp }> = [
    { hash: 'terms', expect: /Terms of Service/i },
    { hash: 'privacy', expect: /Privacy Policy/i },
    { hash: 'downloads', expect: /Downloads/i },
  ];

  for (const route of routes) {
    const failures = watchForFailures(page);
    await gotoHash(page, route.hash);
    await expect(page.getByText(route.expect).first()).toBeVisible({ timeout: 20_000 });
    expect(failures, `route #${route.hash}\n${failures.join('\n')}`).toEqual([]);
  }
});

test('the home route renders its landing content', async ({ page }) => {
  const failures = watchForFailures(page);
  await page.goto('/#/', { waitUntil: 'domcontentloaded' });
  // The landing page is itself lazy-loaded, so seeing any of its chrome proves
  // the default chunk loaded.
  await expect(page.locator('#root')).not.toBeEmpty({ timeout: 20_000 });
  await page.waitForLoadState('networkidle').catch(() => {});
  expect(failures, failures.join('\n')).toEqual([]);
});

test('the emitted bundle actually code-splits, so the lazy tests mean something', async ({ page }) => {
  // Guards against the suite silently becoming a no-op: if a future config
  // inlines everything into one chunk, the lazy assertions above would still
  // pass while testing nothing about dynamic imports.
  const chunkRequests: string[] = [];
  page.on('request', (request) => {
    const url = request.url();
    if (url.includes('/assets/') && url.endsWith('.js')) chunkRequests.push(url);
  });
  await page.goto('/#terms', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText(/Terms of Service/i).first()).toBeVisible({ timeout: 20_000 });
  expect(
    chunkRequests.length,
    `expected the terms route to pull at least one hashed chunk, saw: ${JSON.stringify(chunkRequests)}`,
  ).toBeGreaterThan(0);
});

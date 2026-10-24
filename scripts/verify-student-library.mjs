import { createServer } from "vite";
import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
const server = await createServer({
  server: { host: "127.0.0.1", port: 5173, strictPort: true },
});
await server.listen();
let browser;
const output = "/tmp/orin-student-library-qa";
await mkdir(output, { recursive: true });
try {
  browser = await chromium.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? {
          executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
          args: ["--no-sandbox", "--disable-dev-shm-usage", "--no-zygote"],
        }
      : {}),
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://127.0.0.1:5173/learn");
  await page.locator(".study-card").first().waitFor();
  await page.evaluate(() => document.fonts.ready);
  assert.equal(await page.locator(".study-card").count(), 58);
  await page.screenshot({ path: output + "/01-library-desktop.png" });
  await page.locator(".study-card").first().click();
  await page
    .getByRole("button", { name: "Practise questions", exact: true })
    .click();
  await page.getByRole("button", { name: "Show reference answer" }).click();
  await page.screenshot({ path: output + "/02-practice-desktop.png" });
  await page.getByRole("button", { name: "Close study pack" }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: output + "/03-library-mobile.png" });
  assert.equal(
    await page
      .locator(".student-library")
      .evaluate((el) => el.scrollWidth <= el.clientWidth),
    true,
  );
  await page.locator(".study-card").first().click();
  await page.screenshot({ path: output + "/04-notes-mobile.png" });
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      ok: true,
      packs: 58,
      screenshots: output,
      browserErrors: errors,
    }),
  );
} finally {
  await browser?.close();
  await server.close();
}

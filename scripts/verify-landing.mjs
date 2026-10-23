import { createServer } from "vite";
import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
delete process.env.VITE_ORIN_LOCAL_DEMO;
const server = await createServer({
  server: { host: "127.0.0.1", port: 5173, strictPort: true },
});
await server.listen();
const output = "/tmp/orin-landing-qa";
await mkdir(output, { recursive: true });
let browser;
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
  await page.goto("http://127.0.0.1:5173");
  await page.locator(".lp-hero h1").waitFor();
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: `${output}/01-desktop-hero.png`,
    animations: "disabled",
  });
  await page.locator("#lp-features").scrollIntoViewIfNeeded();
  await page.waitForFunction(
    () =>
      document.querySelector("#lp-features").getAttribute("data-visible") ===
      "true",
  );
  await page.screenshot({
    path: `${output}/02-features.png`,
    animations: "disabled",
  });
  await page.locator("#lp-questions").scrollIntoViewIfNeeded();
  await page.waitForFunction(
    () =>
      document.querySelector("#lp-questions").getAttribute("data-visible") ===
      "true",
  );
  await page.screenshot({
    path: `${output}/03-questions.png`,
    animations: "disabled",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".orin-landing").evaluate((el) => el.scrollTo(0, 0));
  await page.screenshot({
    path: `${output}/04-mobile-hero.png`,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.screenshot({
    path: `${output}/05-mobile-menu.png`,
    animations: "disabled",
  });
  await page
    .getByRole("navigation", { name: "Mobile navigation" })
    .getByRole("button", { name: "Good questions" })
    .click();
  if (
    await page
      .locator(".orin-landing")
      .evaluate((el) => el.scrollWidth > el.clientWidth)
  )
    throw new Error("Mobile horizontal overflow");
  if (errors.length) throw new Error(errors.join("; "));
  console.log(
    JSON.stringify({ ok: true, screenshots: output, browserErrors: errors }),
  );
} finally {
  await browser?.close();
  await server.close();
}

// Runs a real browser against the explicitly isolated local demo. No live APIs.
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { chromium } from "@playwright/test";
import { createServer } from "vite";
process.env.VITE_ORIN_LOCAL_DEMO = "1";
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
const api = spawn(process.execPath, ["scripts/dev-api.mjs", "--demo"], {
  stdio: ["ignore", "ignore", "pipe"],
  env: process.env,
});
let apiErrors = "";
api.stderr.on("data", (d) => (apiErrors += d));
const vite = await createServer({
  server: { host: "127.0.0.1", port: 5173, strictPort: true },
});
await vite.listen();
const output = process.env.ORIN_QA_DIR || "/tmp/orin-workspace-qa";
await mkdir(output, { recursive: true });
let browser;
try {
  let apiReady = false;
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch("http://127.0.0.1:3001/api/workspace");
      if (r.ok) {
        apiReady = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!apiReady) throw new Error("Local demo API did not start. " + apiErrors);
  browser = await chromium.launch({
    headless: true,
    ...(executablePath
      ? {
          executablePath,
          args: [
            "--no-sandbox",
            "--disable-dev-shm-usage",
            "--no-zygote",
            "--single-process",
          ],
        }
      : {}),
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://127.0.0.1:5173");
  await page.getByRole("button", { name: /Administration/ }).waitFor();
  await page.screenshot({
    animations: "disabled",
    path: `${output}/01-workspace.png`,
  });
  const positions = await page.evaluate(() =>
    Object.fromEntries(
      [".welcome-heading", ".composer", ".suggestion-row"].map((s) => {
        const r = document.querySelector(s).getBoundingClientRect();
        return [s, { top: r.top, bottom: r.bottom }];
      }),
    ),
  );
  if (
    positions[".composer"].top < positions[".welcome-heading"].bottom ||
    positions[".composer"].bottom > positions[".suggestion-row"].top
  )
    throw new Error(
      "Welcome composer overlaps surrounding content: " +
        JSON.stringify(positions),
    );
  await page.getByRole("button", { name: /Administration/ }).click();
  await page.getByRole("button", { name: "Knowledge", exact: true }).click();
  await page.getByRole("button", { name: "Add knowledge" }).click();
  await page.getByLabel("Document title").fill("Saturn field notes");
  await page
    .getByLabel("Markdown content")
    .fill(
      "# Saturn\n\nSaturn has beautiful rings. These notes are a test reference for the Orin knowledge library.",
    );
  await page.getByRole("button", { name: "Save draft" }).click();
  await page.getByRole("button", { name: "Index", exact: true }).click();
  await page
    .getByRole("button", { name: "Publish", exact: true })
    .waitFor({ state: "visible" });
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await page.getByRole("button", { name: "Publish document" }).click();
  await page.getByText("Document published", { exact: true }).waitFor();
  await page.screenshot({
    animations: "disabled",
    path: `${output}/02-knowledge.png`,
  });
  await page
    .getByRole("button", { name: "Retrieval lab", exact: true })
    .click();
  await page.getByLabel("Test retrieval query").fill("Saturn rings");
  await page.getByRole("button", { name: "Find passages" }).click();
  await page.locator(".retrieval-result").waitFor();
  await page.getByRole("button", { name: /New conversation/ }).click();
  await page
    .getByLabel("Message Orin")
    .fill("What do the Saturn notes say about rings?");
  await page.getByRole("button", { name: "Send message" }).click();
  await page.locator(".message.assistant").waitFor();
  await page.locator(".answer-sources button").click();
  await page.getByRole("complementary", { name: "Answer sources" }).waitFor();
  await page.screenshot({
    animations: "disabled",
    path: `${output}/03-grounded-chat.png`,
  });
  await page.getByRole("button", { name: "Close sources" }).click();
  await page.reload();
  await page.locator(".conversation-link").first().waitFor();
  await page.locator(".conversation-link").first().click();
  await page.locator(".message.assistant").waitFor();
  await page.getByRole("button", { name: "Settings & preferences" }).click();
  await page.getByRole("button", { name: "Dark", exact: true }).click();
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.screenshot({
    animations: "disabled",
    path: `${output}/04-dark-chat.png`,
  });
  await page.getByRole("button", { name: /New conversation/ }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(
    () =>
      document.querySelector(".workspace-sidebar").getBoundingClientRect()
        .right <= 1,
  );
  await page.screenshot({
    animations: "disabled",
    path: `${output}/05-mobile.png`,
  });
  const mobileOverlap = await page.evaluate(
    () =>
      document.querySelector(".welcome > p").getBoundingClientRect().bottom >
      document.querySelector(".composer").getBoundingClientRect().top,
  );
  if (mobileOverlap) throw new Error("Mobile heading overlaps composer");
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > innerWidth,
  );
  if (overflow) throw new Error("Mobile layout overflows horizontally");
  await page.getByRole("button", { name: "Open sidebar" }).click();
  await page.getByRole("button", { name: /Administration/ }).click();
  await page.screenshot({
    animations: "disabled",
    path: `${output}/06-mobile-admin.png`,
  });
  if (errors.length)
    throw new Error("Browser exceptions: " + errors.join("; "));
  console.log(
    JSON.stringify({
      ok: true,
      flows: [
        "workspace",
        "document upload",
        "indexing",
        "publication",
        "retrieval",
        "citations",
        "history restore",
        "dark mode",
        "mobile navigation",
      ],
      screenshots: output,
      browserErrors: errors,
    }),
  );
} finally {
  await browser?.close();
  await vite.close();
  api.kill();
  if (apiErrors) console.error(apiErrors);
}

// Local integration walkthrough: real password/session API, no Clerk or provider calls.
import http from "node:http";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { createServer } from "vite";
import { chromium } from "@playwright/test";
import { createWorkspaceHandler } from "../api/_lib/workspace/handler.js";
import { MemoryRepository } from "../api/_lib/workspace/repository.js";
import { apiHandler } from "../api/_lib/http.js";
process.env.ORIN_ADMIN_PASSWORD = "local-walkthrough-password-only";
process.env.TOKEN_ENCRYPTION_KEY = "local-walkthrough-encryption-key-only-000";
delete process.env.VITE_ORIN_LOCAL_DEMO;
const handler = apiHandler(
  createWorkspaceHandler({ repository: new MemoryRepository() }),
);
const api = http.createServer(async (req, res) => {
  let raw = "";
  for await (const part of req) raw += part;
  req.body = raw ? JSON.parse(raw) : {};
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (data) => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(data));
    return res;
  };
  await handler(req, res);
});
await new Promise((resolve) => api.listen(3001, "127.0.0.1", resolve));
const server = await createServer({
  server: { host: "127.0.0.1", port: 5173, strictPort: true },
});
await server.listen();
let browser;
const output = "/tmp/orin-admin-qa";
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
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage(),
    errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("http://127.0.0.1:5173");
  await page.getByRole("link", { name: "Admin", exact: true }).click();
  await page.getByLabel("Admin password").waitFor();
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `${output}/01-password-login.png` });
  await page.getByLabel("Admin password").fill("wrong-password");
  await page.getByRole("button", { name: "Open administration" }).click();
  await page
    .getByRole("alert")
    .filter({ hasText: "Incorrect admin password" })
    .waitFor();
  assert.equal(await page.getByLabel("Admin password").inputValue(), "");
  await page.getByLabel("Admin password").fill(process.env.ORIN_ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Open administration" }).click();
  await page.getByRole("heading", { name: /A thoughtful system/ }).waitFor();
  await page.screenshot({ path: `${output}/02-dashboard.png` });
  const cookie = (await context.cookies()).find(
    (c) => c.name === "orin_admin_session",
  );
  assert.equal(cookie.httpOnly, true);
  assert.equal(cookie.sameSite, "Strict");
  await page.reload();
  await page.getByRole("heading", { name: /A thoughtful system/ }).waitFor();
  await page.getByRole("button", { name: "Providers", exact: true }).click();
  await page.getByRole("button", { name: "Add API key" }).waitFor();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page.getByLabel("Admin password").waitFor();
  assert.equal(
    (await context.cookies()).some((c) => c.name === "orin_admin_session"),
    false,
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("http://127.0.0.1:5173/#admin");
  await page.getByLabel("Admin password").waitFor();
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  await page.screenshot({ path: `${output}/03-mobile-login.png` });
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      ok: true,
      flows: [
        "landing admin link",
        "wrong password",
        "password-only login",
        "dashboard",
        "session restore",
        "providers",
        "logout",
        "mobile hash route",
      ],
      screenshots: output,
      browserErrors: errors,
    }),
  );
} finally {
  await browser?.close();
  await server.close();
  await new Promise((resolve) => api.close(resolve));
}

import { describe, expect, it } from "vitest";
import { readdir, readFile } from "node:fs/promises";

describe("Core Vercel function budget", () => {
  it("consolidates auth routes and excludes legacy function entry files", async () => {
    const ignored = await readFile(new URL("../../.vercelignore", import.meta.url), "utf8");
    for (const file of ["api/auth/password.js", "api/auth/neon.js", "api/auth/device.js"]) {
      expect(ignored).toContain(file);
    }
    const dispatch = await readFile(new URL("../../api/auth/[...path].js", import.meta.url), "utf8");
    expect(dispatch).toMatch(/passwordHandler/);
    expect(dispatch).toMatch(/createBffSession/);
    expect(dispatch).toMatch(/googleSigninHandler/);
  });

  // Vercel's Hobby plan allows 12 serverless functions per project. At 13 the
  // build succeeds and the *deploy* fails — which is why this went unnoticed
  // for days: every test was green and only the preview URL was dead.
  it("stays within Vercel's 12-function Hobby limit", async () => {
    const apiDir = new URL("../../api/", import.meta.url);
    const ignored = new Set(
      (await readFile(new URL("../../.vercelignore", import.meta.url), "utf8"))
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.startsWith("api/") && line.endsWith(".js")),
    );

    async function collect(dir) {
      const found = [];
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        // Vercel does not turn `_`-prefixed files or directories into functions;
        // `api/_lib/` is the shared-module convention, not 25 endpoints.
        if (entry.name.startsWith("_")) continue;
        const url = new URL(entry.name + (entry.isDirectory() ? "/" : ""), dir);
        if (entry.isDirectory()) found.push(...(await collect(url)));
        else if (entry.name.endsWith(".js")) found.push(url.pathname);
      }
      return found;
    }

    const deployed = (await collect(apiDir)).filter((pathname) => {
      const relative = pathname.slice(pathname.indexOf("api/"));
      return !ignored.has(relative);
    });

    expect(deployed.length).toBeLessThanOrEqual(12);
  });
});
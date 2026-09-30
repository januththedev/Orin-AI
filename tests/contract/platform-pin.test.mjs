import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

describe("platform contract", () => {
  it("pins the canonical release and v2 services", async () => {
    const pkg = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8"));
    // A deliberate pin: it forces the app version and the shipped platform to
    // move together. It failed for real when 4.2.0 shipped while this still
    // said 4.1.1, which is exactly what it is here to catch.
    expect(pkg.version).toBe("4.2.0");
    expect(pkg.dependencies["@orin/contracts"]).toContain("vendor/orin-platform");
    expect(pkg.dependencies.jose).toBe("6.2.12");
  });

  it("ships an auth dispatcher that can read its own route", async () => {
    // The catch-all used to take its route from `req.query.path`, which is not
    // populated the same way in every runtime. Deployed, every auth route
    // answered "Unknown auth route" while the function itself was reachable.
    const source = await readFile(new URL("../../api/auth/[...path].js", import.meta.url), "utf8");
    expect(source).toMatch(/function authPath\(/);
    expect(source).toMatch(/req\.url/);
    for (const route of ["password", "neon", "device", "google-signin", "logout", "session/rotate", "mcp/verify", "router/assertion"]) {
      expect(source, `route ${route} must be dispatched`).toContain(`'${route}'`);
    }
  });

  it("stays within Vercel's 12-function Hobby limit", async () => {
    const { readdir } = await import("node:fs/promises");
    const apiDir = new URL("../../api/", import.meta.url);
    const ignored = new Set(
      (await readFile(new URL("../../.vercelignore", import.meta.url), "utf8"))
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.startsWith("api/") && l.endsWith(".js")),
    );
    async function collect(dir) {
      const found = [];
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        if (entry.name.startsWith("_")) continue;
        const url = new URL(entry.name + (entry.isDirectory() ? "/" : ""), dir);
        if (entry.isDirectory()) found.push(...(await collect(url)));
        else if (entry.name.endsWith(".js")) found.push(url.pathname);
      }
      return found;
    }
    const deployed = (await collect(apiDir)).filter((p) => !ignored.has(p.slice(p.indexOf("api/"))));
    expect(deployed.length).toBeLessThanOrEqual(12);
  });
});

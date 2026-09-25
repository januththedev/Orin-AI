import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
describe("platform contract", () => { it("pins the canonical release and v2 services", async () => { const pkg = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8")); expect(pkg.version).toBe("4.1.0"); expect(pkg.dependencies["@orin/contracts"]).toContain("vendor/orin-platform"); expect(pkg.dependencies.jose).toBe("6.2.12"); }); });

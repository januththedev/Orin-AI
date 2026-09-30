import { describe, expect, it } from "vitest";
import { authPath } from "../../api/auth/[...path].js";

/**
 * The auth dispatcher used to read `req.query.path`. In production that value
 * was present but wrong, so every route answered "Unknown auth route" while the
 * function itself was reachable — and multi-segment routes never arrived at all.
 *
 * These cases pin the behaviour against the shapes a runtime actually sends.
 */

const req = (url, query) => ({ url, query });

describe("auth route resolution", () => {
  it("reads single-segment routes from the URL", () => {
    for (const route of ["device", "password", "neon", "logout", "google-signin"]) {
      expect(authPath(req(`/api/auth/${route}`))).toBe(route);
    }
  });

  it("reads nested routes from the URL", () => {
    expect(authPath(req("/api/auth/session/introspect"))).toBe("session/introspect");
    expect(authPath(req("/api/auth/mcp/verify"))).toBe("mcp/verify");
    expect(authPath(req("/api/auth/router/assertion"))).toBe("router/assertion");
  });

  it("survives a query string and a full URL", () => {
    expect(authPath(req("/api/auth/device?state=abc"))).toBe("device");
    expect(authPath(req("https://chat.orinai.org/api/auth/mcp/verify"))).toBe("mcp/verify");
  });

  it("ignores a query value that disagrees with the URL", () => {
    // The exact production failure: a populated-but-wrong `req.query.path`.
    expect(authPath(req("/api/auth/device", { path: "device" }))).toBe("device");
    expect(authPath(req("/api/auth/mcp/verify", { path: "mcp" }))).toBe("mcp/verify");
    expect(authPath(req("/api/auth/session/introspect", { path: ["session", "introspect"] }))).toBe("session/introspect");
  });

  it("still uses the query when the URL carries no path at all", () => {
    expect(authPath({ url: "", query: { path: ["mcp", "verify"] } })).toBe("mcp/verify");
    expect(authPath({ url: "", query: { path: "device" } })).toBe("device");
  });

  it("refuses a path that could not be a route name", () => {
    for (const bad of [
      "/api/auth/../../etc/passwd",
      "/api/auth/device<script>",
      "/api/auth/" + "x".repeat(200),
      "/api/auth/",
    ]) {
      expect(authPath(req(bad)), bad).toBe("");
    }
  });

  it("does not throw on missing or hostile input", () => {
    for (const value of [undefined, null, {}, { url: null, query: null }]) {
      expect(authPath(value)).toBe("");
    }
  });
});

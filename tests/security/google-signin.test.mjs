import { describe, expect, it } from "vitest";
import {
  AUTH_ENDPOINT,
  GOOGLE_ISSUERS,
  SCOPES,
  buildAuthUrl,
  safeReturn,
  uidForGoogle,
} from "../../api/_lib/googleIdentity.js";

describe("Google sign-in", () => {
  it("requests only the scopes needed to identify a person", () => {
    const url = new URL(
      buildAuthUrl({
        clientId: "cid.apps.googleusercontent.com",
        redirectUri: "https://orinai.org/api/auth/google-signin",
        state: "st",
        nonce: "no",
        codeChallenge: "cc",
      }),
    );
    expect(url.origin + url.pathname).toBe(AUTH_ENDPOINT);
    expect(url.searchParams.get("scope")).toBe(SCOPES.join(" "));
    // Drive and Gmail are delegated elsewhere; identity must not grant them.
    expect(url.searchParams.get("scope")).not.toMatch(/drive|gmail|calendar/);
  });

  it("always uses PKCE and a nonce", () => {
    const url = new URL(
      buildAuthUrl({
        clientId: "cid",
        redirectUri: "https://orinai.org/api/auth/google-signin",
        state: "st",
        nonce: "no",
        codeChallenge: "cc",
      }),
    );
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toBeTruthy();
    expect(url.searchParams.get("nonce")).toBe("no");
    expect(url.searchParams.get("response_type")).toBe("code");
  });

  it("returns only to Orin origins, so a sign-in cannot be used as an open redirect", () => {
    for (const good of [
      "https://chat.orinai.org/",
      "https://code.orinai.org/settings",
      "https://www.orinai.org",
    ]) {
      expect(safeReturn(good), good).toBeTruthy();
    }
    for (const bad of [
      "https://evil.example/",
      "https://orinai.org.evil.example/",
      "https://not-orinai.org/",
      "http://orinai.org/",
      "javascript:alert(1)",
      "//evil.example/",
      "https://user:pw@orinai.org/",
      "",
      null,
      "not a url",
    ]) {
      expect(safeReturn(bad), String(bad)).toBeNull();
    }
  });

  it("strips query and fragment from the return target", () => {
    const result = new URL(safeReturn("https://chat.orinai.org/x?a=1#frag"));
    expect(result.pathname).toBe("/x");
    expect(result.search).toBe("");
    expect(result.hash).toBe("");
  });

  it("accepts only Google's issuers", () => {
    expect(GOOGLE_ISSUERS).toContain("https://accounts.google.com");
    for (const bad of ["https://accounts.evil.com", "google.com", "https://accounts.google.com.evil"]) {
      expect(GOOGLE_ISSUERS).not.toContain(bad);
    }
  });

  it("maps one Google subject to one stable Orin account id", () => {
    const a = uidForGoogle("112233445566778899001");
    expect(uidForGoogle("112233445566778899001")).toBe(a);
    expect(a.startsWith("gg_")).toBe(true);
    // A different Google person must never collide with an existing account.
    expect(uidForGoogle("112233445566778899002")).not.toBe(a);
    // Hostile characters cannot escape the id shape.
    expect(uidForGoogle("../../etc/passwd")).toMatch(/^gg_[A-Za-z0-9_-]*$/);
  });

  it("keeps identity separate from module tokens", async () => {
    const { readFile } = await import("node:fs/promises");
    const signin = await readFile(new URL("../../api/auth/google-signin.js", import.meta.url), "utf8");
    const modules = await readFile(new URL("../../api/auth/google.js", import.meta.url), "utf8");
    // The Drive/Gmail module-token route must not become an identity route.
    expect(modules).not.toMatch(/createBffSession|mintSession/);
    expect(signin).toMatch(/createBffSession/);
  });
});

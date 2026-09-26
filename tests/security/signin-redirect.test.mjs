import { test, expect } from "vitest";
import { safeReturn } from "../../api/signin.js";

test("return_to only ever resolves to a known Orin origin", () => {
  expect(safeReturn("https://code.orinai.org/").url).toBe("https://code.orinai.org/");
  expect(safeReturn("https://chat.orinai.org/welcome?x=1").url).toBe("https://chat.orinai.org/welcome?x=1");
  expect(safeReturn("https://agent.orinai.org").url).toBe("https://agent.orinai.org/");

  // Relative paths stay on the apex.
  expect(safeReturn("/code").url).toBe("https://orinai.org/code");
  expect(safeReturn("/").url).toBe("https://orinai.org/");
});

test("return_to cannot be turned into an open redirect", () => {
  const hostile = [
    "https://evil.example/",
    "https://code.orinai.org.evil.example/",
    "//evil.example/",
    "https://evil.example/code.orinai.org",
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "http://code.orinai.org/",
    "https://user:pass@code.orinai.org/",
  ];
  for (const url of hostile) {
    const result = safeReturn(url);
    expect(result.origin, url).toBe("https://orinai.org");
    expect(result.url.startsWith("https://orinai.org"), `${url} resolved to ${result.url}`).toBe(true);
  }
});

test("a hostile subdomain cannot borrow a trusted prefix", () => {
  for (const url of [
    "https://code.orinai.org.evil.example/",
    "https://evil.com/?next=https://code.orinai.org",
    "https://orinai.org.evil.example/",
  ]) {
    expect(safeReturn(url).origin, url).toBe("https://orinai.org");
  }
});

test("fragments are stripped so a redirect cannot carry a token in the fragment", () => {
  const result = safeReturn("https://chat.orinai.org/#access_token=secret");
  expect(result.url).toBe("https://chat.orinai.org/");
});

test("missing and malformed targets fall back to the apex", () => {
  for (const value of ["", "   ", null, undefined, "not a url", "://x"]) {
    expect(safeReturn(value).url, String(value)).toBe("https://orinai.org/");
  }
});

import { test, expect } from "vitest";
import { readFile } from "node:fs/promises";

const password = await readFile(new URL("../../api/auth/password.js", import.meta.url), "utf8");
const signin = await readFile(new URL("../../api/signin.js", import.meta.url), "utf8");
const bff = await readFile(new URL("../../api/_lib/bff.js", import.meta.url), "utf8");

test("the browser sign-in page reuses the API credential path, not a copy", () => {
  // Two implementations of "check a password" is how one of them ends up weaker.
  expect(password).toMatch(/export async function authenticateWithPassword/);
  expect(signin).toMatch(/import \{ authenticateWithPassword \} from '\.\/auth\/password\.js'/);
  expect(signin).toMatch(/authenticateWithPassword\(\{ action: 'login'/);
  expect(password).toMatch(/authenticateWithPassword\(req\.body, clientIp\(req\)\)/);
});

test("rate limiting and the generic failure message are shared with the API", () => {
  const body = password.slice(password.indexOf("export async function authenticateWithPassword"));
  expect(body).toMatch(/auth-register:/);
  expect(body).toMatch(/auth-login-ip:/);
  expect(body).toMatch(/auth-login-id:/);
  // "No such account" and "wrong password" must be indistinguishable.
  expect(body).toMatch(/!lookupSnap\.exists\) throw httpError\(401, 'Invalid credentials'\)/);
  expect(body).toMatch(/!verifyPassword\(password, credSnap\.data\(\)\.hash\)\) \{/);
});

test("the sign-in form is CSRF-protected and the session cookie is HttpOnly", () => {
  expect(signin).toMatch(/orin_signin_csrf/);
  expect(signin).toMatch(/constantTimeEqual\(cookieToken, postedToken\)/);
  expect(signin).toMatch(/HttpOnly/);
  expect(signin).toMatch(/SameSite=Lax/);
  expect(signin).toMatch(/Cache-Control', 'no-store'/);
  expect(signin).toMatch(/X-Frame-Options', 'DENY'/);
});

test("a successful browser sign-in sets the BFF session and redirects", () => {
  expect(signin).toMatch(/createBffSession\(res, uid, 'orin-web', email\)/);
  expect(signin).toMatch(/res\.statusCode = 303/);
  expect(bff).toContain("const BFF_COOKIE = 'orin_session'");
});

test("the page is not indexed and does not leak internals", () => {
  expect(signin).toMatch(/name="robots" content="noindex"/);
  expect(signin).not.toMatch(/console\.log/);
});

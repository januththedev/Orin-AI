import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { fail } from "./repository.js";

const COOKIE = "orin_admin_session";
const LIFETIME = 8 * 60 * 60;
const digest = (value) => createHash("sha256").update(value).digest();

// Separate from Clerk: administrators enter only the server-configured password.
// Changing the password invalidates every existing admin session immediately.
export function createAdminAuth({
  getPassword = () => process.env.ORIN_ADMIN_PASSWORD || "",
  now = () => Date.now(),
} = {}) {
  const password = () => String(getPassword());
  const secret = () => digest(`orin-admin-session-v1\0${password()}`);
  function sameOrigin(req) {
    if (req.headers["sec-fetch-site"] === "cross-site")
      throw fail(403, "Open administration on this website to continue.");
    if (!req.headers.origin) return;
    let host;
    try {
      host = new URL(req.headers.origin).host;
    } catch {
      host = "";
    }
    if (!host || host !== req.headers.host)
      throw fail(403, "Open administration on this website to continue.");
  }
  function cookie(req, token, maxAge) {
    const secure =
      process.env.VERCEL ||
      process.env.NODE_ENV === "production" ||
      req.headers["x-forwarded-proto"] === "https";
    return `${COOKIE}=${token}; Path=/api; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
  }
  async function session(req) {
    if (password().length < 12) return null;
    const raw = String(req.headers.cookie || "")
      .split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith(`${COOKIE}=`))
      ?.slice(COOKIE.length + 1);
    if (!raw || raw.length > 2048) return null;
    try {
      const { payload } = await jwtVerify(raw, secret(), {
        algorithms: ["HS256"],
        issuer: "orin-admin",
        audience: "orin-administration",
        currentDate: new Date(now()),
        maxTokenAge: `${LIFETIME}s`,
      });
      if (payload.sub !== "password-admin" || !payload.exp) return null;
      return { id: "password-admin", role: "admin", name: "Administrator" };
    } catch {
      return null;
    }
  }
  return {
    session,
    async require(req) {
      sameOrigin(req);
      const account = await session(req);
      if (!account) throw fail(403, "Enter the admin password to continue.");
      return account;
    },
    async handle(action, req, res, repository) {
      if (!["admin.login", "admin.session", "admin.logout"].includes(action))
        return false;
      if (action === "admin.session") {
        res
          .status(200)
          .json({
            authenticated: !!(await session(req)),
            configured: password().length >= 12,
          });
        return true;
      }
      if (req.method !== "POST") throw fail(405, "POST required.");
      sameOrigin(req);
      if (action === "admin.logout") {
        res.setHeader("Set-Cookie", cookie(req, "", 0));
        res.status(200).json({ ok: true });
        return true;
      }
      if (password().length < 12)
        throw fail(
          503,
          "Set ORIN_ADMIN_PASSWORD to at least 12 characters in Vercel, then redeploy.",
        );
      // Atomic, shared limits in Neon; fail closed if the database is unavailable.
      const ip = String(
        req.headers["x-forwarded-for"] ||
          req.socket?.remoteAddress ||
          "unknown",
      )
        .split(",")[0]
        .trim();
      if (
        !(await repository.rate(
          `admin-login:${digest(ip).toString("hex")}`,
          8,
          15 * 60_000,
        )) ||
        !(await repository.rate("admin-login:global", 100, 60 * 60_000))
      )
        throw fail(429, "Too many password attempts. Try again later.");
      const supplied = req.body?.password;
      if (
        typeof supplied !== "string" ||
        supplied.length > 1024 ||
        !timingSafeEqual(digest(supplied), digest(password()))
      )
        throw fail(401, "Incorrect admin password.");
      const issuedAt = Math.floor(now() / 1000);
      const token = await new SignJWT({})
        .setProtectedHeader({ alg: "HS256" })
        .setIssuer("orin-admin")
        .setAudience("orin-administration")
        .setSubject("password-admin")
        .setJti(randomUUID())
        .setIssuedAt(issuedAt)
        .setExpirationTime(issuedAt + LIFETIME)
        .sign(secret());
      res.setHeader("Set-Cookie", cookie(req, token, LIFETIME));
      res.status(200).json({ authenticated: true });
      return true;
    },
  };
}
export const adminAuth = createAdminAuth();

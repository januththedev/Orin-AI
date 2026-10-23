import { createRemoteJWKSet, jwtVerify } from "jose";
import { fail } from "./repository.js";

export function createAuthenticator({
  issuer: configuredIssuer,
  keyResolver,
  adminIds: configuredAdmins,
  authorizedParties: configuredParties,
} = {}) {
  let cachedIssuer, jwks;
  return async function authenticate(req, repository) {
    const issuer = String(
      configuredIssuer || process.env.CLERK_ISSUER_URL || "",
    ).replace(/\/$/, "");
    if (!issuer.startsWith("https://"))
      throw fail(503, "Clerk is not configured. Set CLERK_ISSUER_URL.");
    const token = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || "")?.[1];
    if (!token) throw fail(401, "Sign in to continue.");
    if (cachedIssuer !== issuer) {
      cachedIssuer = issuer;
      jwks =
        keyResolver ||
        createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
    }
    let claims;
    try {
      ({ payload: claims } = await jwtVerify(token, jwks, {
        issuer,
        algorithms: ["RS256"],
        ...(process.env.CLERK_JWT_AUDIENCE
          ? { audience: process.env.CLERK_JWT_AUDIENCE }
          : {}),
      }));
    } catch {
      throw fail(401, "Your session expired. Please sign in again.");
    }
    if (!claims.sub || !claims.sid)
      throw fail(401, "A Clerk user session is required.");
    const origins =
      configuredParties ||
      (
        process.env.ORIN_AUTHORIZED_PARTIES ||
        "https://chat.orinai.org,https://orinai.org,https://www.orinai.org"
      )
        .split(",")
        .map((v) => v.trim());
    if (!claims.azp || !origins.includes(claims.azp))
      throw fail(401, "Session origin is not authorized.");
    const adminIds =
      configuredAdmins ||
      (process.env.ORIN_ADMIN_CLERK_IDS || "").split(",").map((v) => v.trim());
    // Identity is the verified subject. No implicit linking by email.
    const account = await repository.account(
      claims.sub,
      {
        name: String(claims.name || "Orin member"),
        email: String(claims.email || ""),
      },
      adminIds.includes(claims.sub),
    );
    return {
      ...account,
      role: adminIds.includes(claims.sub) ? "admin" : "member",
    };
  };
}
export const authenticate = createAuthenticator();
export function requireAdmin(account) {
  if (account.role !== "admin")
    throw fail(403, "Administrator access required.");
}

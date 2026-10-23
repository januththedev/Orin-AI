import { describe, it, expect, beforeAll } from "vitest";
import { generateKeyPair, SignJWT } from "jose";
import { createAuthenticator } from "../../api/_lib/workspace/auth.js";
import { MemoryRepository } from "../../api/_lib/workspace/repository.js";
let pair, other;
const issuer = "https://clerk.example.test";
beforeAll(async () => {
  pair = await generateKeyPair("RS256");
  other = await generateKeyPair("RS256");
});
async function token(claims = {}, signer = pair.privateKey) {
  return new SignJWT({
    sid: "sess_test",
    azp: "https://chat.orinai.org",
    ...claims,
  })
    .setProtectedHeader({ alg: "RS256" })
    .setIssuer(issuer)
    .setSubject("user_test")
    .setIssuedAt()
    .setExpirationTime("2m")
    .sign(signer);
}
const request = (t) => ({ headers: { authorization: `Bearer ${t}` } });
const auth = (admins = []) =>
  createAuthenticator({
    issuer,
    keyResolver: pair.publicKey,
    adminIds: admins,
    authorizedParties: ["https://chat.orinai.org"],
  });
describe("Clerk workspace authorization", () => {
  it("accepts a signed session from the configured issuer and authorized origin", async () => {
    expect(
      (
        await auth(["user_test"])(
          request(await token()),
          new MemoryRepository(),
        )
      ).role,
    ).toBe("admin");
  });
  it("rejects signatures from another key", async () => {
    await expect(
      auth()(
        request(await token({}, other.privateKey)),
        new MemoryRepository(),
      ),
    ).rejects.toMatchObject({ code: 401 });
  });
  it("rejects foreign origins even with a valid signature", async () => {
    await expect(
      auth()(
        request(await token({ azp: "https://attacker.test" })),
        new MemoryRepository(),
      ),
    ).rejects.toMatchObject({ code: 401 });
  });
  it("requires a session ID rather than accepting any JWT subject", async () => {
    await expect(
      auth()(request(await token({ sid: null })), new MemoryRepository()),
    ).rejects.toMatchObject({ code: 401 });
  });
  it("revokes admin access when the server allowlist changes", async () => {
    const repo = new MemoryRepository(),
      t = request(await token());
    await auth(["user_test"])(t, repo);
    expect((await auth([])(t, repo)).role).toBe("member");
  });
  it("does not link a new identity to someone else by matching email", async () => {
    const repo = new MemoryRepository();
    await repo.account("original", { email: "same@example.test" }, true);
    const account = await auth()(
      request(await token({ email: "same@example.test" })),
      repo,
    );
    expect(account.id).toBe("user_test");
    expect(account.role).toBe("member");
  });
});

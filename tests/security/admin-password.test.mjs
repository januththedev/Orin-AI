import { describe, it, expect } from "vitest";
import { createAdminAuth } from "../../api/_lib/workspace/admin-auth.js";
import { createWorkspaceHandler } from "../../api/_lib/workspace/handler.js";
import { MemoryRepository } from "../../api/_lib/workspace/repository.js";

const password = "test-only-admin-password-123";
const req = (body = {}, extra = {}) => ({
  method: "POST",
  url: "/api/workspace",
  headers: {
    host: "chat.orinai.org",
    origin: "https://chat.orinai.org",
    ...extra,
  },
  body,
});
function response() {
  return {
    headers: {},
    setHeader(k, v) {
      this.headers[k] = v;
    },
    status(code) {
      this.code = code;
      return this;
    },
    json(data) {
      this.data = data;
      return this;
    },
  };
}
async function loggedIn(options = {}) {
  const auth = createAdminAuth({ getPassword: () => password, ...options });
  const res = response();
  await auth.handle(
    "admin.login",
    req({ password }),
    res,
    new MemoryRepository(),
  );
  return { auth, res, cookie: res.headers["Set-Cookie"].split(";")[0] };
}
describe("password-only administration", () => {
  it("accepts only the configured password and issues an HttpOnly session without exposing the password", async () => {
    const { auth, res, cookie } = await loggedIn();
    expect(res.data).toEqual({ authenticated: true });
    expect(res.headers["Set-Cookie"]).toContain("HttpOnly; SameSite=Strict");
    expect(res.headers["Set-Cookie"]).toContain("Path=/api");
    expect(res.headers["Set-Cookie"]).not.toContain(password);
    expect((await auth.require(req({}, { cookie }))).role).toBe("admin");
  });
  it("rejects wrong passwords, missing cookies, and modified tokens", async () => {
    const { auth, cookie } = await loggedIn();
    await expect(
      auth.handle(
        "admin.login",
        req({ password: "wrong" }),
        response(),
        new MemoryRepository(),
      ),
    ).rejects.toMatchObject({ code: 401 });
    await expect(auth.require(req())).rejects.toMatchObject({ code: 403 });
    expect(
      await auth.session(req({}, { cookie: cookie + "tampered" })),
    ).toBeNull();
  });
  it("expires sessions after eight hours and revokes them when the environment password changes", async () => {
    let clock = Date.now(),
      currentPassword = password;
    const { auth, cookie } = await loggedIn({
      now: () => clock,
      getPassword: () => currentPassword,
    });
    currentPassword += "rotated";
    expect(await auth.session(req({}, { cookie }))).toBeNull();
    currentPassword = password;
    clock += 8 * 60 * 60 * 1000 + 1000;
    expect(await auth.session(req({}, { cookie }))).toBeNull();
  });
  it("rejects cross-site login and admin writes", async () => {
    const { auth, cookie } = await loggedIn();
    await expect(
      auth.handle(
        "admin.login",
        req({ password }, { origin: "https://other.test" }),
        response(),
        new MemoryRepository(),
      ),
    ).rejects.toMatchObject({ code: 403 });
    await expect(
      auth.require(req({}, { cookie, "sec-fetch-site": "cross-site" })),
    ).rejects.toMatchObject({ code: 403 });
  });
  it("limits password guessing with shared storage and fails closed on storage failure", async () => {
    const auth = createAdminAuth({ getPassword: () => password }),
      repository = new MemoryRepository();
    for (let i = 0; i < 8; i++)
      await expect(
        auth.handle(
          "admin.login",
          req({ password: "wrong" }),
          response(),
          repository,
        ),
      ).rejects.toMatchObject({ code: 401 });
    await expect(
      auth.handle("admin.login", req({ password }), response(), repository),
    ).rejects.toMatchObject({ code: 429 });
    await expect(
      auth.handle("admin.login", req({ password }), response(), {
        rate() {
          throw new Error("Database unavailable");
        },
      }),
    ).rejects.toThrow("Database unavailable");
  });
  it("requires explicit server configuration and supports logout", async () => {
    const empty = createAdminAuth({ getPassword: () => "" });
    await expect(
      empty.handle(
        "admin.login",
        req({ password }),
        response(),
        new MemoryRepository(),
      ),
    ).rejects.toMatchObject({ code: 503 });
    const { auth } = await loggedIn(),
      res = response();
    await auth.handle("admin.logout", req(), res, new MemoryRepository());
    expect(res.headers["Set-Cookie"]).toContain("Max-Age=0");
  });
  it("opens the actual dashboard without Clerk and prevents Clerk roles from bypassing the password", async () => {
    const before = process.env.ORIN_ADMIN_PASSWORD;
    process.env.ORIN_ADMIN_PASSWORD = password;
    try {
      const repository = new MemoryRepository();
      const handler = createWorkspaceHandler({
        repository,
        identify: async () => ({ id: "clerk-admin", role: "admin" }),
      });
      await expect(
        handler(req({ action: "admin.snapshot" }), response()),
      ).rejects.toMatchObject({ code: 403 });
      const login = response();
      await handler(req({ action: "admin.login", password }), login);
      const cookie = login.headers["Set-Cookie"].split(";")[0];
      const dashboard = response();
      await handler(req({ action: "admin.snapshot" }, { cookie }), dashboard);
      expect(dashboard.data.credentials).toEqual([]);
      expect(dashboard.code).toBe(200);
    } finally {
      if (before === undefined) delete process.env.ORIN_ADMIN_PASSWORD;
      else process.env.ORIN_ADMIN_PASSWORD = before;
    }
  });
});

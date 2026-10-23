import http from "node:http";
import { MemoryRepository } from "../api/_lib/workspace/repository.js";
import { createWorkspaceHandler } from "../api/_lib/workspace/handler.js";
import { apiHandler } from "../api/_lib/http.js";
const demo = process.argv.includes("--demo");
if (demo && (process.env.VERCEL || process.env.NODE_ENV === "production"))
  throw new Error("Local demo cannot run in production.");
if (demo && !process.env.TOKEN_ENCRYPTION_KEY)
  process.env.TOKEN_ENCRYPTION_KEY =
    "local-demo-only-key-not-for-production-000";
const repository = demo ? new MemoryRepository() : undefined;
if (repository) repository.localDemo = true;
const identify = demo
  ? async (req, repo) =>
      repo.account(
        "local-preview",
        { name: "Januth", email: "preview@localhost" },
        true,
      )
  : undefined;
const handler = apiHandler(
  createWorkspaceHandler({
    ...(repository ? { repository, identify } : {}),
    demo,
  }),
);
http
  .createServer(async (req, res) => {
    if (req.url?.split("?")[0] !== "/api/workspace") {
      res.writeHead(404);
      res.end();
      return;
    }
    const origin = req.headers.origin;
    if (
      origin &&
      !/^http:\/\/(localhost|127\.0\.0\.1):(5173|4173)$/.test(origin)
    ) {
      res.writeHead(403);
      res.end();
      return;
    }
    let raw = "";
    try {
      for await (const part of req) {
        raw += part;
        if (Buffer.byteLength(raw) > 600000) {
          res.writeHead(413);
          res.end();
          return;
        }
      }
      req.body = raw ? JSON.parse(raw) : {};
    } catch {
      res.writeHead(400);
      res.end();
      return;
    }
    res.status = (code) => {
      res.statusCode = code;
      return res;
    };
    res.json = (data) => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(data));
      return res;
    };
    await handler(req, res);
  })
  .listen(3001, "127.0.0.1", () =>
    console.log(
      `Workspace API on 127.0.0.1:3001 (${demo ? "DEMO: memory storage and deterministic answers" : "Clerk + Neon"})`,
    ),
  );

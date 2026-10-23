/** Deploy separately. All state and retry leases live in Neon, not Worker memory. */
export default {
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(
      (async () => {
        if (
          !env.ORIN_WORKSPACE_URL?.startsWith("https://") ||
          !env.ORIN_WORKER_SECRET
        )
          throw new Error("Configure scheduler URL and secret.");
        const response = await fetch(env.ORIN_WORKSPACE_URL, {
          method: "POST",
          headers: {
            authorization: `Bearer ${env.ORIN_WORKER_SECRET}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ action: "tick" }),
          signal: AbortSignal.timeout(55000),
        });
        if (!response.ok)
          throw new Error(`Workspace tick failed (${response.status})`);
      })(),
    );
  },
};

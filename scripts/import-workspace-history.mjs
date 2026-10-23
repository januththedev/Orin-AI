import { createHash, randomUUID } from "node:crypto";
import { Repository } from "../api/_lib/workspace/repository.js";
import { sdocGet, squery } from "../api/_lib/store.js";
// Explicit operator-verified identity mapping. No email-based automatic linking.
const [oldUid, clerkId, ...flags] = process.argv.slice(2);
if (!oldUid || !/^user_[a-zA-Z0-9]+$/.test(clerkId || ""))
  throw new Error(
    "Usage: npm run history:import -- OLD_ORIN_UID CLERK_USER_ID [--apply]",
  );
const apply = flags.includes("--apply");
const repo = new Repository();
function stableUuid(s) {
  const h = createHash("sha256").update(s).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
const user = await sdocGet("users", oldUid);
if (!user.exists) throw new Error("Legacy account not found.");
const profile = user.data();
let legacy = [];
try {
  legacy = JSON.parse(profile.historyBlob || "[]");
} catch {
  throw new Error("Invalid legacy history JSON; repair it before import.");
}
const v2 = await squery(
  "chat_v2_conversations",
  [{ field: "account_id", value: oldUid }],
  { limit: 500 },
);
if (v2.length === 500)
  throw new Error(
    "Legacy v2 query reached its limit. Export this account with a paginated query before migration.",
  );
const all = [...legacy, ...v2.map((d) => d.data())];
const grouped = new Map();
for (const c of all) {
  const id = String(c.id || "");
  if (!id) throw new Error("A legacy conversation has no ID.");
  const previous = grouped.get(id) || { ...c, messages: [] };
  const seen = new Set(
    previous.messages.map((m) => String(m.id || m.role + ":" + m.content)),
  );
  for (const m of c.messages || []) {
    const key = String(m.id || m.role + ":" + m.content);
    if (!seen.has(key)) {
      previous.messages.push(m);
      seen.add(key);
    }
  }
  grouped.set(id, previous);
}
console.log(
  JSON.stringify({
    mode: apply ? "APPLY" : "DRY RUN",
    conversations: grouped.size,
    messages: [...grouped.values()].reduce((n, c) => n + c.messages.length, 0),
  }),
);
if (apply) {
  await repo.account(clerkId, {
    name: profile.name || "Orin member",
    email: profile.email || "",
  });
  for (const [legacyId, c] of grouped) {
    const id = stableUuid(`${clerkId}:${oldUid}:${legacyId}`);
    await repo.createConversation(
      clerkId,
      id,
      String(c.title || "Imported conversation").slice(0, 120),
      !!c.thinkingMode,
    );
    let i = 0;
    for (const m of c.messages) {
      if (!["user", "assistant"].includes(m.role)) continue;
      const sequence = i++;
      const request_id = stableUuid(`${id}:${m.id || sequence}:${m.role}`);
      const original = new Date(
        m.timestamp ||
          m.created_at ||
          c.timestamp ||
          c.updated_at ||
          Date.now(),
      );
      const created_at = new Date(
        Number.isFinite(original.getTime())
          ? original.getTime() + sequence
          : Date.now() + sequence,
      ).toISOString();
      await repo.message({
        id: stableUuid(request_id + ":message"),
        conversation_id: id,
        account_id: clerkId,
        request_id,
        created_at,
        role: m.role,
        content: String(m.content || ""),
        status: "complete",
        model: m.model,
        metadata: {
          imported: true,
          legacyTimestamp: m.timestamp || m.created_at || null,
          legacySources: m.links || m.citations || [],
        },
      });
    }
  }
  await repo.put("migration", `${oldUid}:${clerkId}`, {
    id: `${oldUid}:${clerkId}`,
    legacyUid: oldUid,
    clerkId,
    at: new Date().toISOString(),
    conversations: grouped.size,
  });
  console.log(
    "History copied. Legacy records were retained. Re-running uses deterministic IDs.",
  );
}

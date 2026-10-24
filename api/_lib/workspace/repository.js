import { sql } from "../store.js";

export const fail = (code, message) =>
  Object.assign(new Error(message), { code });
const rows = (result) => result.rows || result;
const copy = (value) => JSON.parse(JSON.stringify(value));

export class Repository {
  constructor(
    query = async (text, values = []) => rows(await sql().query(text, values)),
  ) {
    this.query = query;
  }
  async account(clerkId, profile, admin = false) {
    const found = await this.query(
      `INSERT INTO orin_workspace_accounts(id,clerk_id,name,email,role) VALUES($1,$1,$2,$3,$4) ON CONFLICT(clerk_id) DO UPDATE SET name=CASE WHEN EXCLUDED.name='Orin member' THEN orin_workspace_accounts.name ELSE EXCLUDED.name END,email=CASE WHEN EXCLUDED.email='' THEN orin_workspace_accounts.email ELSE EXCLUDED.email END RETURNING *`,
      [
        clerkId,
        profile.name || "Orin member",
        profile.email || "",
        admin ? "admin" : "member",
      ],
    );
    return found[0];
  }
  async list(kind) {
    return (
      await this.query(
        "SELECT id,data FROM orin_workspace_records WHERE kind=$1 ORDER BY updated_at DESC",
        [kind],
      )
    ).map((r) => ({ ...r.data, id: r.id }));
  }
  async get(kind, id) {
    const r = await this.query(
      "SELECT data FROM orin_workspace_records WHERE kind=$1 AND id=$2",
      [kind, id],
    );
    return r[0]?.data || null;
  }
  async put(kind, id, data) {
    await this.query(
      "INSERT INTO orin_workspace_records(kind,id,data) VALUES($1,$2,$3::jsonb) ON CONFLICT(kind,id) DO UPDATE SET data=EXCLUDED.data,updated_at=now()",
      [kind, id, JSON.stringify(data)],
    );
    return data;
  }
  async delete(kind, id) {
    await this.query(
      "DELETE FROM orin_workspace_records WHERE kind=$1 AND id=$2",
      [kind, id],
    );
  }
  async patch(kind, id, patch) {
    const r = await this.query(
      "UPDATE orin_workspace_records SET data=data || $3::jsonb,updated_at=now() WHERE kind=$1 AND id=$2 RETURNING data",
      [kind, id, JSON.stringify(patch)],
    );
    return r[0]?.data;
  }
  async acquireLease(id, owner, ttlMs) {
    const now = Date.now();
    const result = await this.query(
      "INSERT INTO orin_workspace_records(kind,id,data) VALUES('leases',$1,jsonb_build_object('owner',$2::text,'until',$3::bigint)) ON CONFLICT(kind,id) DO UPDATE SET data=EXCLUDED.data,updated_at=now() WHERE COALESCE((orin_workspace_records.data->>'until')::bigint,0)<$4 RETURNING id",
      [id, owner, now + ttlMs, now],
    );
    return result.length > 0;
  }
  async releaseLease(id, owner) {
    await this.query(
      "DELETE FROM orin_workspace_records WHERE kind='leases' AND id=$1 AND data->>'owner'=$2",
      [id, owner],
    );
  }
  async leaseJob(id, owner) {
    const r = await this.query(
      "UPDATE orin_workspace_records SET data=data || jsonb_build_object('leaseOwner',$2::text,'leaseUntil',$3::bigint,'status','running'),updated_at=now() WHERE kind='jobs' AND id=$1 AND data->>'status' IN ('queued','running') AND COALESCE((data->>'leaseUntil')::bigint,0)<$4 RETURNING data",
      [id, owner, Date.now() + 90000, Date.now()],
    );
    return r[0]?.data || null;
  }
  async rate(key, limit, windowMs) {
    const now = Date.now();
    const r = await this.query(
      "INSERT INTO orin_workspace_records(kind,id,data) VALUES('limits',$1,jsonb_build_object('count',1,'start',$2::bigint)) ON CONFLICT(kind,id) DO UPDATE SET data=CASE WHEN COALESCE((orin_workspace_records.data->>'start')::bigint,0)<$3 THEN EXCLUDED.data ELSE jsonb_set(orin_workspace_records.data,'{count}',to_jsonb((orin_workspace_records.data->>'count')::int+1)) END RETURNING data",
      [key, now, now - windowMs],
    );
    return Number(r[0].data.count) <= limit;
  }
  async conversations(uid, { cursor, search = "", limit = 30 } = {}) {
    const r = await this.query(
      "SELECT * FROM orin_workspace_conversations WHERE account_id=$1 AND deleted_at IS NULL AND title ILIKE $2 AND ($3::timestamptz IS NULL OR (updated_at,id)<($3::timestamptz,$4::uuid)) ORDER BY updated_at DESC,id DESC LIMIT $5",
      [
        uid,
        `%${search.slice(0, 100)}%`,
        cursor?.at || null,
        cursor?.id || null,
        limit + 1,
      ],
    );
    const page = r.slice(0, limit);
    return {
      items: page,
      next:
        r.length > limit
          ? { at: page.at(-1).updated_at, id: page.at(-1).id }
          : null,
    };
  }
  async conversation(uid, id) {
    return (
      (
        await this.query(
          "SELECT * FROM orin_workspace_conversations WHERE id=$1 AND account_id=$2 AND deleted_at IS NULL",
          [id, uid],
        )
      )[0] || null
    );
  }
  async createConversation(uid, id, title, thinking) {
    await this.query(
      "INSERT INTO orin_workspace_conversations(id,account_id,title,thinking) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO NOTHING",
      [id, uid, title, thinking],
    );
    if (!(await this.conversation(uid, id)))
      throw fail(404, "Conversation not found");
    return this.conversation(uid, id);
  }
  async updateConversation(uid, id, patch) {
    const r = await this.query(
      "UPDATE orin_workspace_conversations SET title=COALESCE($3,title),thinking=COALESCE($4,thinking),deleted_at=CASE WHEN $5 THEN now() ELSE deleted_at END,updated_at=now() WHERE id=$1 AND account_id=$2 AND deleted_at IS NULL RETURNING *",
      [id, uid, patch.title ?? null, patch.thinking ?? null, !!patch.deleted],
    );
    if (!r[0]) throw fail(404, "Conversation not found");
    return r[0];
  }
  async messages(uid, id, before = null, limit = 60) {
    if (!(await this.conversation(uid, id)))
      throw fail(404, "Conversation not found");
    await this.query(
      "WITH stale AS (UPDATE orin_workspace_messages SET status='interrupted' WHERE account_id=$1 AND conversation_id=$2 AND status='pending' AND created_at<now()-interval '2 minutes' RETURNING request_id) UPDATE orin_workspace_requests SET status='failed' WHERE account_id=$1 AND id IN (SELECT request_id FROM stale)",
      [uid, id],
    );
    const r = await this.query(
      "SELECT * FROM orin_workspace_messages WHERE conversation_id=$1 AND account_id=$2 AND ($3::timestamptz IS NULL OR (created_at,id)<($3::timestamptz,$4::uuid)) ORDER BY created_at DESC,id DESC LIMIT $5",
      [id, uid, before?.at || null, before?.id || null, limit + 1],
    );
    const page = r.slice(0, limit);
    return {
      items: page.reverse(),
      next:
        r.length > limit ? { at: page[0].created_at, id: page[0].id } : null,
    };
  }
  async message(data) {
    await this.query(
      "INSERT INTO orin_workspace_messages(id,conversation_id,account_id,request_id,role,content,status,model,metadata,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::timestamptz) ON CONFLICT(account_id,request_id,role) DO UPDATE SET content=EXCLUDED.content,status=EXCLUDED.status,model=EXCLUDED.model,metadata=EXCLUDED.metadata",
      [
        data.id,
        data.conversation_id,
        data.account_id,
        data.request_id,
        data.role,
        data.content,
        data.status,
        data.model || null,
        JSON.stringify(data.metadata || {}),
        data.created_at || new Date().toISOString(),
      ],
    );
  }
  async request(uid, id) {
    const r = await this.query(
      "SELECT * FROM orin_workspace_requests WHERE account_id=$1 AND id=$2",
      [uid, id],
    );
    return r[0] || null;
  }
  async claimRequest(uid, id, conversationId) {
    const r = await this.query(
      "INSERT INTO orin_workspace_requests(id,account_id,conversation_id) VALUES($1,$2,$3) ON CONFLICT(id) DO NOTHING RETURNING id",
      [id, uid, conversationId],
    );
    return !!r.length;
  }
  async finishRequest(uid, id, status, response) {
    await this.query(
      "UPDATE orin_workspace_requests SET status=$3,response=$4::jsonb WHERE id=$1 AND account_id=$2",
      [id, uid, status, JSON.stringify(response)],
    );
  }
  async addChunks(chunks) {
    for (const c of chunks)
      await this.query(
        "INSERT INTO orin_workspace_chunks(id,document_id,version,ordinal,title,section,content,embedding_space,embedding) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::vector) ON CONFLICT(document_id,version,ordinal) DO UPDATE SET embedding_space=EXCLUDED.embedding_space,embedding=EXCLUDED.embedding",
        [
          c.id,
          c.document_id,
          c.version,
          c.ordinal,
          c.title,
          c.section,
          c.content,
          c.embedding_space || null,
          c.embedding ? JSON.stringify(c.embedding) : null,
        ],
      );
  }
  async chunks(documentId, version) {
    return this.query(
      "SELECT id,document_id,version,ordinal,title,section,content FROM orin_workspace_chunks WHERE document_id=$1 AND version=$2 ORDER BY ordinal",
      [documentId, version],
    );
  }
  async retrieve(query, embedding, space) {
    const values = [
      embedding ? JSON.stringify(embedding) : null,
      space || null,
    ];
    // Exact vector search is deliberate for small hobby corpora. Each space is filtered
    // before distance computation, so different dimensions/models never mix.
    const base =
      "FROM orin_workspace_chunks c JOIN orin_workspace_records d ON d.kind='documents' AND d.id=c.document_id AND d.data->>'publishedVersion'=c.version WHERE d.data->>'status'='published'";
    const keyword = await this.query(
      `SELECT c.id,c.document_id,c.version,c.title,c.section,c.content,ts_rank_cd(c.search,websearch_to_tsquery('simple',$1)) AS score ${base} AND c.search @@ websearch_to_tsquery('simple',$1) ORDER BY score DESC LIMIT 25`,
      [query],
    );
    const vector = embedding
      ? await this.query(
          `WITH compatible AS MATERIALIZED (SELECT c.* ${base} AND c.embedding_space=$2 AND c.embedding IS NOT NULL) SELECT id,document_id,version,title,section,content,1-(embedding <=> $1::vector) AS score FROM compatible ORDER BY embedding <=> $1::vector LIMIT 25`,
          values,
        )
      : [];
    return { keyword, vector };
  }
}

/** Explicitly injected by the loopback-only demo server/tests; never selected by an env var in production. */
export class MemoryRepository {
  constructor() {
    this.records = new Map();
    this.accounts = new Map();
    this.chats = new Map();
    this.msgs = new Map();
    this.requests = new Map();
    this.chunkRows = new Map();
    this.clock = 0;
  }
  async account(id, p, admin = false) {
    if (!this.accounts.has(id))
      this.accounts.set(id, {
        id,
        clerk_id: id,
        ...p,
        role: admin ? "admin" : "member",
      });
    return copy(this.accounts.get(id));
  }
  key(k, id) {
    return `${k}:${id}`;
  }
  async list(k) {
    return [...this.records.entries()]
      .filter(([id]) => id.startsWith(k + ":"))
      .map(([, v]) => copy(v));
  }
  async get(k, id) {
    return this.records.has(this.key(k, id))
      ? copy(this.records.get(this.key(k, id)))
      : null;
  }
  async put(k, id, d) {
    this.records.set(this.key(k, id), copy({ ...d, id }));
    return d;
  }
  async delete(k, id) {
    this.records.delete(this.key(k, id));
  }
  async patch(k, id, p) {
    const d = await this.get(k, id);
    if (d) return this.put(k, id, { ...d, ...p });
  }
  async acquireLease(id, owner, ttlMs) {
    const key = this.key("leases", id);
    if ((this.records.get(key)?.until || 0) >= Date.now()) return false;
    this.records.set(key, { id, owner, until: Date.now() + ttlMs });
    return true;
  }
  async releaseLease(id, owner) {
    const key = this.key("leases", id);
    if (this.records.get(key)?.owner === owner) this.records.delete(key);
  }
  async leaseJob(id, owner) {
    const j = await this.get("jobs", id);
    if (
      !j ||
      !["queued", "running"].includes(j.status) ||
      j.leaseUntil > Date.now()
    )
      return null;
    await this.patch("jobs", id, {
      leaseOwner: owner,
      leaseUntil: Date.now() + 90000,
      status: "running",
    });
    return this.get("jobs", id);
  }
  async rate(key, limit, ms) {
    const d = await this.get("limits", key);
    const next =
      !d || d.start < Date.now() - ms
        ? { count: 1, start: Date.now() }
        : { ...d, count: d.count + 1 };
    await this.put("limits", key, next);
    return next.count <= limit;
  }
  async conversations(uid, { cursor, search = "", limit = 30 } = {}) {
    let a = [...this.chats.values()]
      .filter(
        (c) =>
          c.account_id === uid &&
          !c.deleted_at &&
          c.title.toLowerCase().includes(search.toLowerCase()),
      )
      .sort(
        (a, b) =>
          b.updated_at.localeCompare(a.updated_at) || b.id.localeCompare(a.id),
      );
    if (cursor)
      a = a.filter(
        (c) =>
          c.updated_at < cursor.at ||
          (c.updated_at === cursor.at && c.id < cursor.id),
      );
    const items = a.slice(0, limit);
    return copy({
      items,
      next:
        a.length > limit
          ? { at: items.at(-1).updated_at, id: items.at(-1).id }
          : null,
    });
  }
  async conversation(uid, id) {
    const c = this.chats.get(id);
    return c && c.account_id === uid && !c.deleted_at ? copy(c) : null;
  }
  async createConversation(uid, id, title, thinking) {
    if (!this.chats.has(id))
      this.chats.set(id, {
        id,
        account_id: uid,
        title,
        thinking,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    if (!(await this.conversation(uid, id)))
      throw fail(404, "Conversation not found");
    return this.conversation(uid, id);
  }
  async updateConversation(uid, id, p) {
    const c = await this.conversation(uid, id);
    if (!c) throw fail(404, "Conversation not found");
    this.chats.set(id, {
      ...c,
      ...p,
      deleted_at: p.deleted ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    });
    return copy(this.chats.get(id));
  }
  async messages(uid, id, before = null, limit = 60) {
    if (!(await this.conversation(uid, id)))
      throw fail(404, "Conversation not found");
    let a = [...this.msgs.values()]
      .filter((m) => m.account_id === uid && m.conversation_id === id)
      .sort(
        (a, b) =>
          a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id),
      );
    if (before)
      a = a.filter(
        (m) =>
          m.created_at < before.at ||
          (m.created_at === before.at && m.id < before.id),
      );
    const items = a.slice(-limit);
    return copy({
      items,
      next:
        a.length > limit ? { at: items[0].created_at, id: items[0].id } : null,
    });
  }
  async message(d) {
    const old = [...this.msgs.values()].find(
      (m) =>
        m.account_id === d.account_id &&
        m.request_id === d.request_id &&
        m.role === d.role,
    );
    const id = old?.id || d.id;
    this.msgs.set(id, {
      ...d,
      id,
      created_at:
        old?.created_at ||
        d.created_at ||
        new Date(
          (this.clock = Math.max(Date.now(), this.clock + 1)),
        ).toISOString(),
    });
  }
  async request(uid, id) {
    const r = this.requests.get(id);
    return r?.account_id === uid ? copy(r) : null;
  }
  async claimRequest(uid, id, conversation_id) {
    if (this.requests.has(id)) return false;
    this.requests.set(id, {
      id,
      account_id: uid,
      conversation_id,
      status: "pending",
    });
    return true;
  }
  async finishRequest(uid, id, status, response) {
    const r = this.requests.get(id);
    if (r?.account_id === uid)
      this.requests.set(id, { ...r, status, response });
  }
  async addChunks(chunks) {
    for (const c of chunks)
      this.chunkRows.set(`${c.document_id}:${c.version}:${c.ordinal}`, copy(c));
  }
  async chunks(id, v) {
    return [...this.chunkRows.values()]
      .filter((c) => c.document_id === id && c.version === v)
      .sort((a, b) => a.ordinal - b.ordinal)
      .map(copy);
  }
  async retrieve(query, embedding, space) {
    const docs = await this.list("documents");
    const a = [...this.chunkRows.values()].filter((c) =>
      docs.some(
        (d) =>
          d.id === c.document_id &&
          d.status === "published" &&
          d.publishedVersion === c.version,
      ),
    );
    const words = query
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 2);
    return {
      keyword: a
        .map((c) => ({
          ...c,
          score: words.filter((w) =>
            (c.title + " " + c.content).toLowerCase().includes(w),
          ).length,
        }))
        .filter((c) => c.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 25),
      vector: embedding
        ? a
            .filter((c) => c.embedding_space === space && c.embedding)
            .slice(0, 25)
        : [],
    };
  }
}

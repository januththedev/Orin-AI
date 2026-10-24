import React, { useEffect, useRef, useState } from "react";
import {
  Activity,
  ArrowDownUp,
  ArrowUpRight,
  BookOpen,
  Check,
  ChevronRight,
  CircleHelp,
  FileText,
  KeyRound,
  Layers,
  LoaderCircle,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Trash2,
  Upload,
  X,
  Zap,
  Eye,
  Pause,
  Play,
  AlertCircle,
  Database,
  SlidersHorizontal,
} from "lucide-react";
import { type ApiCall } from "./api";
import { IconButton, Markdown, Modal } from "./WorkspaceApp";

const providerLabels: Record<string, string> = {
  openrouter: "OpenRouter",
  groq: "Groq",
  vercel: "Vercel AI Gateway",
  nim: "NVIDIA NIM",
};
const initialModel = {
  provider: "openrouter",
  model: "",
  label: "",
  service: "generation",
  costClass: "zero",
  context: 32768,
  reasoning: false,
  eligible: false,
  dimensions: 1024,
  embeddingSpace: "",
  benchmarkId: "",
  publicDataOnly: false,
};
function Badge({
  children,
  tone = "",
}: {
  children: React.ReactNode;
  tone?: string;
}) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
export default function WorkspaceAdmin({
  api,
  demo,
}: {
  api: ApiCall;
  demo: boolean;
}) {
  const [tab, setTab] = useState("overview"),
    [snapshot, setSnapshot] = useState<any>(null),
    [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [modal, setModal] = useState<
      "provider" | "model" | "upload" | "publish" | "rollback" | null
    >(null),
    [selected, setSelected] = useState<any>(null),
    [preview, setPreview] = useState<any>(null);
  const [provider, setProvider] = useState({
      provider: "openrouter",
      label: "",
      quotaPool: "",
      key: "",
    }),
    [model, setModel] = useState<any>(initialModel);
  const [upload, setUpload] = useState<any>({
      title: "",
      markdown: "",
      language: "en",
      source: "",
    }),
    [query, setQuery] = useState(""),
    [results, setResults] = useState<any>(null),
    [benchmarkKey, setBenchmarkKey] = useState(""),
    [space, setSpace] = useState("");
  const [testPublic, setTestPublic] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const load = async () => {
    const data = await api("admin.snapshot");
    setSnapshot(data);
    setSpace(data.retrieval?.embeddingSpace || "");
    return data;
  };
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, [api]);
  const run = async (
    action: string,
    body: Record<string, unknown> = {},
    success = "Saved",
  ) => {
    if (busy) return;
    setBusy(action);
    setError("");
    setNotice("");
    try {
      const data = await api(action, body);
      await load();
      setNotice(success);
      return data;
    } catch (e: any) {
      setError(e.message);
      throw e;
    } finally {
      setBusy("");
    }
  };
  const perform = (
    action: string,
    body: Record<string, unknown> = {},
    success?: string,
  ) => void run(action, body, success).catch(() => {});
  const readFile = async (f: File) => {
    if (!/\.(md|markdown)$/i.test(f.name))
      return setError("Choose a .md or .markdown file.");
    if (f.size > 512000)
      return setError("Choose a Markdown file smaller than 500 KB.");
    setUpload((u) => ({
      ...u,
      title: f.name.replace(/\.(md|markdown)$/i, ""),
      markdown: "",
    }));
    const text = await f.text();
    setUpload((u) => ({ ...u, markdown: text }));
    setModal("upload");
  };
  const indexDocument = async (doc: any) => {
    if (busy) return;
    const job = snapshot.jobs.find(
      (j: any) => j.documentId === doc.id && j.version === doc.version,
    );
    if (!job) return setError("No indexing job was found.");
    setBusy("indexing");
    setError("");
    try {
      if (job.status === "failed" || job.status === "complete")
        await api("knowledge.retry", { jobId: job.id });
      for (let i = 0; i < 100; i++) {
        const result = await api("knowledge.process", { jobId: job.id });
        await load();
        if (result.busy)
          throw new Error(
            "Another worker is indexing this document. Try refreshing shortly.",
          );
        if (result.complete) {
          setNotice(
            result.warning || "Document indexed. Review it before publishing.",
          );
          break;
        }
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy("");
    }
  };
  const importStudentPacks = async () => {
    if (busy) return;
    setBusy('knowledge.seed'); setError(''); setNotice('Preparing student packs…');
    try {
      let offset: number | null = 0;
      let processed = 0;
      while (offset !== null) {
        const result = await api('knowledge.seed', { offset, limit: 4 });
        processed += result.processed;
        setNotice(`Imported or checked ${processed} of ${result.total} student packs…`);
        offset = result.next;
      }
      await load();
      setNotice('Student packs are available as drafts. Review, index and publish the notes you want Orin to use. Existing published versions are preserved.');
    } catch (e: any) { setError(e.message); setNotice(''); }
    finally { setBusy(''); }
  };
  const tabs = [
    { id: "overview", label: "Overview", icon: Layers },
    { id: "knowledge", label: "Knowledge", icon: BookOpen },
    { id: "providers", label: "Providers", icon: KeyRound },
    { id: "models", label: "Models & routing", icon: ArrowDownUp },
    { id: "retrieval", label: "Retrieval lab", icon: Search },
    { id: "activity", label: "Activity", icon: Activity },
  ];
  if (!snapshot)
    return (
      <div className="admin-page">
        <div className="page-loading">
          {error ? (
            <>
              <AlertCircle />
              <p>{error}</p>
              <button
                className="button"
                onClick={() => void load().catch((e) => setError(e.message))}
              >
                Retry
              </button>
            </>
          ) : (
            <>
              <LoaderCircle className="spin" />
              Loading your control room…
            </>
          )}
        </div>
      </div>
    );
  const generation = snapshot.models.filter(
    (m: any) =>
      m.service === "generation" && m.enabled && m.status === "eligible",
  );
  const balanced = [...generation].sort(
    (a, b) => b.balancedScore - a.balancedScore,
  )[0];
  const best = [...generation]
    .filter((m) => m.reasoning)
    .sort((a, b) => b.bestScore - a.bestScore)[0];
  return (
    <div className="admin-page">
      <div className="admin-page-heading">
        <div>
          <span className="eyebrow">ORIN CONTROL ROOM</span>
          <h1>
            A thoughtful system,
            <br />
            under your control.
          </h1>
          <p>Shape what Orin knows, and how it finds an answer.</p>
        </div>
        <button
          className="button"
          disabled={!!busy}
          onClick={() => void load().catch((e) => setError(e.message))}
        >
          <RefreshCw size={15} />
          Refresh
        </button>
      </div>
      <nav className="admin-tabs" aria-label="Administration sections">
        {tabs.map((t) => (
          <button
            key={t.id}
            className={tab === t.id ? "active" : ""}
            onClick={() => {
              setTab(t.id);
              setNotice("");
              setError("");
            }}
          >
            <t.icon size={16} />
            {t.label}
          </button>
        ))}
      </nav>
      {error && (
        <div className="inline-alert error" role="alert">
          <AlertCircle size={17} />
          {error}
        </div>
      )}
      {notice && (
        <div className="inline-alert" role="status">
          <Check size={17} />
          {notice}
        </div>
      )}
      {busy && (
        <div className="operation-status" role="status">
          <LoaderCircle size={14} className="spin" />
          {busy === "indexing" ? "Indexing your document…" : "Working…"}
        </div>
      )}
      {tab === "overview" && (
        <>
          <div className="admin-stat-grid">
            <div className="stat-card">
              <span>
                Connected keys
                <KeyRound size={17} />
              </span>
              <strong>
                {snapshot.credentials.filter((c: any) => c.enabled).length}
              </strong>
              <small>Across your provider pools</small>
            </div>
            <div className="stat-card">
              <span>
                Published knowledge
                <BookOpen size={17} />
              </span>
              <strong>
                {
                  snapshot.documents.filter(
                    (d: any) => d.status === "published",
                  ).length
                }
              </strong>
              <small>Reviewed documents ready to retrieve</small>
            </div>
            <div className="stat-card">
              <span>
                Eligible models
                <Zap size={17} />
              </span>
              <strong>
                {
                  snapshot.models.filter(
                    (m: any) => m.status === "eligible" && m.enabled,
                  ).length
                }
              </strong>
              <small>Generation and retrieval services</small>
            </div>
          </div>
          <div className="admin-two-columns">
            <section className="admin-card routing-card">
              <div className="card-heading">
                <h2>The next answer starts here</h2>
                <span className="tiny-pill">Automatic routing</span>
              </div>
              <div className="route-tier">
                <span className="tier-icon">
                  <Zap size={20} />
                </span>
                <div>
                  <strong>Balanced</strong>
                  <p>{balanced?.label || "No eligible generation model yet"}</p>
                </div>
                <span className="muted">Thinking off</span>
              </div>
              <div className="route-tier">
                <span className="tier-icon best">
                  <ShieldCheck size={20} />
                </span>
                <div>
                  <strong>Best available</strong>
                  <p>{best?.label || "Add a reasoning-capable model"}</p>
                </div>
                <span className="muted">Thinking on</span>
              </div>
              <p className="card-footnote">
                Selections also depend on healthy keys, quota pools, and context
                size.
              </p>
            </section>
            <section className="admin-card getting-started">
              <div className="card-heading">
                <h2>Make it yours</h2>
                <span>01 — 03</span>
              </div>
              {[
                {
                  label: "Connect a provider",
                  detail: "Add a key and verify access.",
                  tab: "providers",
                  done: snapshot.credentials.length > 0,
                },
                {
                  label: "Configure your models",
                  detail: "Set free access, capabilities, and evaluation.",
                  tab: "models",
                  done: snapshot.models.length > 0,
                },
                {
                  label: "Give Orin something to know",
                  detail: "Upload, index, review, and publish Markdown.",
                  tab: "knowledge",
                  done: snapshot.documents.some(
                    (d: any) => d.status === "published",
                  ),
                },
              ].map((step, i) => (
                <button key={step.label} onClick={() => setTab(step.tab)}>
                  <span
                    className={step.done ? "step-number done" : "step-number"}
                  >
                    {step.done ? <Check size={14} /> : i + 1}
                  </span>
                  <span>
                    <strong>{step.label}</strong>
                    <small>{step.detail}</small>
                  </span>
                  <ChevronRight size={16} />
                </button>
              ))}
            </section>
          </div>
          <section className="admin-card quiet-card">
            <Database size={21} />
            <div>
              <h3>
                {demo
                  ? "A safe place to explore"
                  : "Built around your knowledge"}
              </h3>
              <p>
                {demo
                  ? "This preview uses memory storage and deterministic answers. Real API keys are unnecessary here."
                  : "Neon stores knowledge, conversation history, and routing configuration. Clerk secures user chats; the admin password protects this dashboard."}
              </p>
            </div>
          </section>
        </>
      )}
      {tab === "providers" && (
        <>
          <div className="section-heading">
            <div>
              <h2>Your provider connections</h2>
              <p>
                Keys stay encrypted. Credentials in the same quota pool share
                cooldowns.
              </p>
            </div>
            <button
              className="button primary"
              onClick={() => {
                setProvider({
                  provider: "openrouter",
                  label: "",
                  quotaPool: "",
                  key: "",
                });
                setModal("provider");
              }}
            >
              <Plus size={16} />
              Add API key
            </button>
          </div>
          <div className="provider-grid">
            {Object.entries(providerLabels).map(([id, label]) => (
              <section className="admin-card provider-card" key={id}>
                <div className="provider-heading">
                  <span className={`provider-symbol ${id}`}>
                    {id === "openrouter" ? (
                      <ArrowDownUp />
                    ) : id === "groq" ? (
                      <Zap />
                    ) : id === "vercel" ? (
                      <span>▲</span>
                    ) : (
                      <Layers />
                    )}
                  </span>
                  <div>
                    <h3>{label}</h3>
                    <small>
                      {id === "nim"
                        ? "Embeddings · Reranking"
                        : id === "openrouter"
                          ? "Generation · Retrieval · Decisions"
                          : "Answer generation"}
                    </small>
                  </div>
                </div>
                {snapshot.credentials
                  .filter((c: any) => c.provider === id)
                  .map((c: any) => (
                    <div className="credential" key={c.id}>
                      <div>
                        <strong>{c.label}</strong>
                        <code>{c.masked}</code>
                        <small>Pool: {c.quotaPool}</small>
                      </div>
                      <Badge
                        tone={
                          c.health === "healthy"
                            ? "green"
                            : c.enabled
                              ? ""
                              : "gray"
                        }
                      >
                        {!c.enabled ? "Disabled" : c.health}
                      </Badge>
                      <div className="credential-actions">
                        <button
                          className="text-button"
                          disabled={!!busy || demo}
                          onClick={() =>
                            perform(
                              "provider.test",
                              { id: c.id },
                              "Connection test complete. Check its health status.",
                            )
                          }
                        >
                          Test
                        </button>
                        <IconButton
                          label={c.enabled ? "Disable key" : "Enable key"}
                          disabled={!!busy}
                          onClick={() =>
                            perform("provider.toggle", {
                              id: c.id,
                              enabled: !c.enabled,
                            })
                          }
                        >
                          {c.enabled ? <Pause size={14} /> : <Play size={14} />}
                        </IconButton>
                        <IconButton
                          label="Remove key"
                          disabled={!!busy}
                          onClick={() =>
                            perform(
                              "provider.delete",
                              { id: c.id },
                              "Key removed",
                            )
                          }
                        >
                          <Trash2 size={14} />
                        </IconButton>
                      </div>
                    </div>
                  ))}
                {!snapshot.credentials.some((c: any) => c.provider === id) && (
                  <div className="provider-empty">
                    No keys connected
                    <button
                      className="text-button"
                      onClick={() => {
                        setProvider({
                          provider: id,
                          label: "",
                          quotaPool: "",
                          key: "",
                        });
                        setModal("provider");
                      }}
                    >
                      Connect {label}
                      <Plus size={13} />
                    </button>
                  </div>
                )}
              </section>
            ))}
          </div>
          <div className="admin-card quiet-card">
            <ShieldCheck size={20} />
            <div>
              <h3>Free access is a policy, not a promise</h3>
              <p>
                Configure zero-priced models or a provider’s confirmed free
                quota. Keep auto top-ups disabled at the provider. Adding
                multiple keys does not increase a shared account’s limits.
              </p>
            </div>
          </div>
        </>
      )}
      {tab === "knowledge" && (
        <>
          <div className="section-heading">
            <div>
              <h2>A library of better answers</h2>
              <p>Only published documents can appear in answers.</p>
            </div>
            <button
              className="button primary"
              onClick={() => {
                setUpload({
                  title: "",
                  markdown: "",
                  language: "en",
                  source: "",
                });
                setModal("upload");
              }}
            >
              <Plus size={16} />
              Add knowledge
            </button>
          </div>
          <section className="admin-card student-seed-card">
            <BookOpen size={23}/>
            <div><h3>Sri Lankan student foundations</h3><p>50 O/L & A/L packs and 8 practical Sri Lanka guides. Original notes and exercises with source-access details; teacher review pending. Importing creates drafts and makes no provider calls.</p><a href="/learn" target="_blank" rel="noreferrer">Browse the study library</a></div>
            <button className="button" disabled={!!busy} onClick={() => void importStudentPacks()}>{busy === 'knowledge.seed' ? <LoaderCircle className="spin" size={15}/> : <Plus size={15}/>}Import student drafts</button>
          </section>
          <input
            type="file"
            hidden
            ref={file}
            accept=".md,.markdown"
            onChange={(e) => {
              if (e.target.files?.[0]) void readFile(e.target.files[0]);
              e.target.value = "";
            }}
          />
          <button
            className="upload-zone"
            onClick={() => file.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (e.dataTransfer.files[0])
                void readFile(e.dataTransfer.files[0]);
            }}
          >
            <span className="upload-icon">
              <Upload size={24} />
            </span>
            <strong>Drop something worth knowing.</strong>
            <span>Drag a Markdown file here, or click to browse</span>
            <small>
              .md / .markdown · up to 500 KB · reviewed before publishing
            </small>
          </button>
          {snapshot.documents.length > 0 ? (
            <div className="document-list">
              {snapshot.documents.map((d: any) => (
                <section className="admin-card document-card" key={d.id}>
                  <div className="document-icon">
                    <FileText size={23} />
                  </div>
                  <div className="document-info">
                    <h3>{d.title}</h3>
                    <p>
                      {d.chunkCount} sections · {d.language.toUpperCase()} ·{" "}
                      {new Date(d.createdAt).toLocaleDateString()}
                    </p>
                    <div>
                      <Badge tone={d.status === "published" ? "green" : ""}>
                        {d.status}
                      </Badge>
                      <Badge>{d.indexStatus.replace("_", " ")}</Badge>
                    </div>
                    {d.indexWarning && (
                      <small className="warning-text">{d.indexWarning}</small>
                    )}
                  </div>
                  <div className="document-actions">
                    <button
                      className="button small"
                      disabled={!!busy}
                      onClick={() =>
                        void api("knowledge.preview", { id: d.id })
                          .then(setPreview)
                          .catch((e) => setError(e.message))
                      }
                    >
                      <Eye size={14} />
                      Review
                    </button>
                    {d.status !== "archived" && (
                      <>
                        <button
                          className="button small"
                          disabled={!!busy}
                          onClick={() => void indexDocument(d)}
                        >
                          {d.indexStatus === "ready" ? "Re-index" : "Index"}
                        </button>
                        {(d.status !== "published" ||
                          d.publishedVersion !== d.version) && (
                          <button
                            className="button small primary"
                            disabled={
                              !!busy ||
                              !["ready", "keyword_ready"].includes(
                                d.indexStatus,
                              )
                            }
                            onClick={() => {
                              setSelected(d);
                              setModal("publish");
                            }}
                          >
                            {d.status === "published"
                              ? "Publish update"
                              : "Publish"}
                          </button>
                        )}
                        <IconButton
                          label="Archive document"
                          disabled={!!busy}
                          onClick={() =>
                            perform(
                              "knowledge.archive",
                              { id: d.id },
                              "Document archived; it is no longer retrieved.",
                            )
                          }
                        >
                          <Trash2 size={15} />
                        </IconButton>
                      </>
                    )}
                  </div>
                </section>
              ))}
            </div>
          ) : (
            <p className="centered-empty">
              A fresh start. Add your first reference document above.
            </p>
          )}
        </>
      )}
      {tab === "models" && (
        <>
          <div className="section-heading">
            <div>
              <h2>The right model for the moment</h2>
              <p>
                Measured evidence, transparent rankings, and controlled
                fallback.
              </p>
            </div>
            <div className="button-group">
              <button
                className="button"
                disabled={!!busy || demo}
                onClick={() =>
                  perform(
                    "catalog.refresh",
                    {},
                    "Catalog refreshed. New models await screening or review.",
                  )
                }
              >
                <RefreshCw size={15} />
                Discover models
              </button>
              <button
                className="button primary"
                onClick={() => {
                  setModel(initialModel);
                  setModal("model");
                }}
              >
                <Plus size={16} />
                Configure model
              </button>
            </div>
          </div>
          <div className="table-scroll admin-card">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Model</th>
                  <th>Service</th>
                  <th>Access</th>
                  <th>Evidence</th>
                  <th>Status</th>
                  <th>Controls</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.models.map((m: any) => (
                  <tr key={m.id}>
                    <td>
                      <strong>{m.label}</strong>
                      <small>
                        {providerLabels[m.provider]}
                        {m.stealth ? " · Stealth" : ""}
                      </small>
                    </td>
                    <td>
                      {m.service}
                      {m.reasoning && <small>Reasoning enabled</small>}
                    </td>
                    <td>
                      <Badge>{m.costClass.replace("_", " ")}</Badge>
                    </td>
                    <td>
                      {m.evaluation ? (
                        <>
                          <strong>{m.evaluation.score}/100</strong>
                          <small>Screening only</small>
                        </>
                      ) : (
                        <span className="muted">Not evaluated</span>
                      )}
                      {m.benchmark && <small>AA: {m.benchmark.score}</small>}
                    </td>
                    <td>
                      <Badge
                        tone={
                          m.status === "eligible" && m.enabled ? "green" : ""
                        }
                      >
                        {!m.enabled ? "disabled" : m.status}
                      </Badge>
                    </td>
                    <td>
                      <div className="button-group">
                        <button
                          className="text-button"
                          onClick={() => {
                            setModel({
                              ...initialModel,
                              ...m,
                              eligible: m.status === "eligible",
                            });
                            setModal("model");
                          }}
                        >
                          Edit
                        </button>
                        {m.service === "generation" && (
                          <button
                            className="text-button"
                            disabled={
                              !!busy || demo || m.costClass === "unknown"
                            }
                            onClick={() =>
                              perform(
                                "model.screen",
                                { id: m.id },
                                "Screening finished. This is a small test suite, not a broad accuracy score.",
                              )
                            }
                          >
                            Screen
                          </button>
                        )}
                        <IconButton
                          label={m.enabled ? "Disable model" : "Enable model"}
                          disabled={!!busy}
                          onClick={() =>
                            perform("model.toggle", {
                              id: m.id,
                              enabled: !m.enabled,
                            })
                          }
                        >
                          {m.enabled ? <Pause size={13} /> : <Play size={13} />}
                        </IconButton>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!snapshot.models.length && (
              <div className="centered-empty">
                Connect a provider and discover models, or configure one
                directly.
              </div>
            )}
          </div>
          <div className="admin-two-columns">
            <section className="admin-card">
              <h3>Live benchmark data</h3>
              <p className="muted">
                Map exact model IDs to Artificial Analysis IDs in the model
                editor. Unmapped models keep an unknown benchmark score.
              </p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(
                    "benchmark.key",
                    { key: benchmarkKey },
                    "Benchmark key saved",
                  )
                    .then(() => setBenchmarkKey(""))
                    .catch(() => {});
                }}
                className="inline-form"
              >
                <input
                  aria-label="Artificial Analysis API key"
                  type="password"
                  value={benchmarkKey}
                  onChange={(e) => setBenchmarkKey(e.target.value)}
                  placeholder={
                    snapshot.benchmarks?.configured
                      ? "Replace data API key"
                      : "Artificial Analysis data API key"
                  }
                  autoComplete="off"
                />
                <button className="button" disabled={!!busy || !benchmarkKey}>
                  Save
                </button>
              </form>
              <button
                className="text-button"
                disabled={!!busy || !snapshot.benchmarks?.configured || demo}
                onClick={() =>
                  perform(
                    "benchmark.refresh",
                    {},
                    "Benchmark snapshot refreshed",
                  )
                }
              >
                Refresh benchmarks
                <RefreshCw size={13} />
              </button>
              <a
                className="attribution"
                href="https://artificialanalysis.ai/"
                target="_blank"
                rel="noreferrer"
              >
                Benchmark data: Artificial Analysis ↗
              </a>
            </section>
            <section className="admin-card">
              <h3>Balanced versus Best</h3>
              <p className="muted">
                Thinking off prioritizes quality and response speed. Thinking on
                increases quality weights and requires reasoning support.
                Missing evaluations carry an uncertainty penalty.
              </p>
              <p className="muted">
                Keys, context limits, cooldowns, and shared quotas are checked
                for every request.
              </p>
            </section>
          </div>
        </>
      )}
      {tab === "retrieval" && (
        <>
          <div className="section-heading">
            <div>
              <h2>See what Orin can find</h2>
              <p>
                Test the published knowledge before relying on it in
                conversations.
              </p>
            </div>
          </div>
          <section className="admin-card">
            <label className="checkbox-field">
              <input
                type="checkbox"
                checked={testPublic}
                onChange={(e) => setTestPublic(e.target.checked)}
              />
              Use public-only retrieval providers for this non-confidential test
              query
            </label>
            <form
              className="retrieval-search"
              onSubmit={(e) => {
                e.preventDefault();
                void run(
                  "knowledge.search",
                  { query, allowPublicProcessing: testPublic },
                  "Retrieval complete",
                )
                  .then((d) => setResults(d))
                  .catch(() => {});
              }}
            >
              <Search size={20} />
              <input
                aria-label="Test retrieval query"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Ask something your documents should answer…"
              />
              <button
                className="button primary"
                disabled={!!busy || !query.trim()}
              >
                Find passages
              </button>
            </form>
          </section>
          {results && (
            <>
              <div className="section-heading">
                <p>
                  {results.sources.length} passages retrieved
                  {results.degraded.length
                    ? " · Some retrieval services were unavailable"
                    : ""}
                </p>
                <Badge>{results.embeddingSpace || "Keyword search"}</Badge>
              </div>
              {results.sources.map((s: any) => (
                <section className="admin-card retrieval-result" key={s.id}>
                  <span className="source-number">{s.index}</span>
                  <div>
                    <h3>{s.title}</h3>
                    <small>{s.section}</small>
                    <div className="prose">
                      <Markdown>{s.content}</Markdown>
                    </div>
                  </div>
                </section>
              ))}
              {!results.sources.length && (
                <div className="centered-empty">
                  No relevant published passages found. Try a specific term from
                  your document.
                </div>
              )}
            </>
          )}
          <section className="admin-card">
            <h3>Primary embedding space</h3>
            <p className="muted">
              Only compatible model/version/dimension combinations can share an
              index. Another model requires its own index. Leave empty to use
              the first published space.
            </p>
            <form
              className="inline-form"
              onSubmit={(e) => {
                e.preventDefault();
                perform("retrieval.settings", { embeddingSpace: space });
              }}
            >
              <input
                aria-label="Primary embedding space"
                value={space}
                onChange={(e) => setSpace(e.target.value)}
                placeholder="e.g. nemotron-embed-v1-1024"
              />
              <button className="button" disabled={!!busy}>
                Save
              </button>
            </form>
          </section>
        </>
      )}
      {tab === "activity" && (
        <>
          <div className="section-heading">
            <div>
              <h2>A record of the changes</h2>
              <p>
                Configuration changes are recorded without API keys or chat
                contents.
              </p>
            </div>
          </div>
          <section className="admin-card audit-list">
            {snapshot.audit.map((a: any) => (
              <div key={a.id}>
                <span className="audit-dot" />
                <div>
                  <strong>{a.action.replaceAll(".", " / ")}</strong>
                  <small>
                    {new Date(a.at).toLocaleString()} · {a.actor}
                  </small>
                </div>
                <Check size={15} />
              </div>
            ))}
            {!snapshot.audit.length && (
              <div className="centered-empty">
                Changes you make here will appear in this log.
              </div>
            )}
          </section>
        </>
      )}
      {modal === "provider" && (
        <Modal
          error={error}
          title="Connect a provider"
          onClose={() => setModal(null)}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void run("provider.add", provider, "API key saved securely")
                .then(() => {
                  setProvider({ ...provider, key: "" });
                  setModal(null);
                })
                .catch(() => {});
            }}
          >
            <label className="field">
              Provider
              <select
                value={provider.provider}
                onChange={(e) =>
                  setProvider({ ...provider, provider: e.target.value })
                }
              >
                {Object.entries(providerLabels).map(([id, label]) => (
                  <option value={id} key={id}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Connection name
              <input
                value={provider.label}
                onChange={(e) =>
                  setProvider({ ...provider, label: e.target.value })
                }
                placeholder="e.g. Personal OpenRouter"
                maxLength={80}
              />
            </label>
            <label className="field">
              Quota pool
              <input
                value={provider.quotaPool}
                onChange={(e) =>
                  setProvider({ ...provider, quotaPool: e.target.value })
                }
                placeholder="Same provider account = same pool"
                maxLength={80}
              />
              <small>
                Leave empty to share the default pool for this provider.
              </small>
            </label>
            <label className="field">
              API key
              <input
                type="password"
                value={provider.key}
                onChange={(e) =>
                  setProvider({ ...provider, key: e.target.value })
                }
                required
                minLength={8}
                autoComplete="off"
                placeholder="Paste your API key"
              />
            </label>
            {demo && (
              <p className="muted">
                Use a dummy key in this local demo. Live connection tests are
                disabled.
              </p>
            )}
            <div className="dialog-actions">
              <button
                className="button"
                type="button"
                onClick={() => setModal(null)}
              >
                Cancel
              </button>
              <button className="button primary" disabled={!!busy}>
                Save connection
              </button>
            </div>
          </form>
        </Modal>
      )}
      {modal === "model" && (
        <Modal
          error={error}
          title="Configure a model"
          onClose={() => setModal(null)}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void run("model.save", model, "Model configuration saved")
                .then(() => setModal(null))
                .catch(() => {});
            }}
          >
            <div className="form-grid">
              <label className="field">
                Provider
                <select
                  value={model.provider}
                  onChange={(e) =>
                    setModel({ ...model, provider: e.target.value })
                  }
                >
                  {Object.entries(providerLabels).map(([id, label]) => (
                    <option value={id} key={id}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                Service
                <select
                  value={model.service}
                  onChange={(e) =>
                    setModel({ ...model, service: e.target.value })
                  }
                >
                  <option value="generation">Generation</option>
                  <option value="embedding">Embedding</option>
                  <option value="rerank">Reranking</option>
                  <option value="decision">Decision</option>
                </select>
              </label>
            </div>
            <label className="field">
              Exact model ID
              <input
                required
                value={model.model}
                onChange={(e) => setModel({ ...model, model: e.target.value })}
                placeholder="nvidia/nemotron-3.5-super-vl:free"
              />
            </label>
            <label className="field">
              Display name
              <input
                value={model.label}
                onChange={(e) => setModel({ ...model, label: e.target.value })}
                placeholder="An optional friendly name"
              />
            </label>
            <div className="form-grid">
              <label className="field">
                Free access
                <select
                  value={model.costClass}
                  onChange={(e) =>
                    setModel({ ...model, costClass: e.target.value })
                  }
                >
                  <option value="zero">Zero-priced model</option>
                  <option value="free_quota">Confirmed free quota</option>
                  <option value="unknown">Unknown / blocked</option>
                </select>
              </label>
              <label className="field">
                Context tokens
                <input
                  type="number"
                  min={1024}
                  max={2000000}
                  value={model.context}
                  onChange={(e) =>
                    setModel({ ...model, context: Number(e.target.value) })
                  }
                />
              </label>
            </div>
            {model.service === "embedding" && (
              <>
                <label className="field">
                  Embedding space ID
                  <input
                    required
                    value={model.embeddingSpace || ""}
                    onChange={(e) =>
                      setModel({ ...model, embeddingSpace: e.target.value })
                    }
                    placeholder="model-version-dimensions"
                  />
                </label>
                <label className="field">
                  Vector dimensions
                  <input
                    type="number"
                    min={1}
                    max={4096}
                    value={model.dimensions || 1024}
                    onChange={(e) =>
                      setModel({ ...model, dimensions: Number(e.target.value) })
                    }
                  />
                </label>
              </>
            )}
            {model.service === "generation" && (
              <>
                <label className="checkbox-field">
                  <input
                    type="checkbox"
                    checked={model.reasoning}
                    onChange={(e) =>
                      setModel({ ...model, reasoning: e.target.checked })
                    }
                  />
                  Supports configurable reasoning
                </label>
                <label className="field">
                  Artificial Analysis model ID
                  <input
                    value={model.benchmarkId || ""}
                    onChange={(e) =>
                      setModel({ ...model, benchmarkId: e.target.value })
                    }
                    placeholder="Optional exact benchmark ID"
                  />
                </label>
              </>
            )}
            <label className="checkbox-field">
              <input
                type="checkbox"
                checked={model.publicDataOnly || false}
                onChange={(e) =>
                  setModel({ ...model, publicDataOnly: e.target.checked })
                }
              />
              Provider permits public, non-confidential data only
            </label>
            <label className="checkbox-field">
              <input
                type="checkbox"
                checked={model.eligible}
                onChange={(e) =>
                  setModel({ ...model, eligible: e.target.checked })
                }
              />
              I have reviewed its access terms and allow routing to this model
            </label>
            <p className="muted">
              Only enable confirmed free access. Embedding failover requires an
              identical embedding space. Decision models use the Decisions API.
            </p>
            <div className="dialog-actions">
              <button
                type="button"
                className="button"
                onClick={() => setModal(null)}
              >
                Cancel
              </button>
              <button className="button primary" disabled={!!busy}>
                Save model
              </button>
            </div>
          </form>
        </Modal>
      )}
      {modal === "upload" && (
        <Modal
          error={error}
          title="Give Orin something to know"
          onClose={() => setModal(null)}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void run(
                "knowledge.upload",
                upload,
                "Document added as a draft. Index and review it before publishing.",
              )
                .then(() => setModal(null))
                .catch(() => {});
            }}
          >
            <label className="field">
              Document title
              <input
                required
                value={upload.title}
                onChange={(e) =>
                  setUpload({ ...upload, title: e.target.value })
                }
                placeholder="A clear, descriptive title"
                maxLength={140}
              />
            </label>
            <div className="form-grid">
              <label className="field">
                Language
                <select
                  value={upload.language}
                  onChange={(e) =>
                    setUpload({ ...upload, language: e.target.value })
                  }
                >
                  <option value="en">English</option>
                  <option value="si">Sinhala</option>
                  <option value="ta">Tamil</option>
                  <option value="mixed">Multiple languages</option>
                </select>
              </label>
              <label className="field">
                Source / reference
                <input
                  value={upload.source}
                  onChange={(e) =>
                    setUpload({ ...upload, source: e.target.value })
                  }
                  placeholder="Optional source URL or note"
                />
              </label>
            </div>
            <label className="field">
              Markdown content
              <textarea
                required
                rows={9}
                value={upload.markdown}
                onChange={(e) =>
                  setUpload({ ...upload, markdown: e.target.value })
                }
                placeholder={
                  "# Your reference\n\nVerified facts, worked examples, and sources…"
                }
              />
            </label>
            <label className="checkbox-field">
              <input
                type="checkbox"
                checked={upload.allowPublicProcessing || false}
                onChange={(e) =>
                  setUpload({
                    ...upload,
                    allowPublicProcessing: e.target.checked,
                  })
                }
              />
              This document may be processed by retrieval providers restricted
              to public, non-confidential inputs
            </label>
            <p className="muted">
              AI-generated documents should be checked for errors. Uploads
              remain drafts until you publish them.
            </p>
            <div className="dialog-actions">
              <button
                className="button"
                type="button"
                onClick={() => setModal(null)}
              >
                Cancel
              </button>
              <button className="button primary" disabled={!!busy}>
                Save draft
              </button>
            </div>
          </form>
        </Modal>
      )}
      {modal === "publish" && selected && (
        <Modal
          error={error}
          title="Publish this knowledge?"
          onClose={() => setModal(null)}
        >
          <p>
            <strong>{selected.title}</strong> will become available to everyone
            using this workspace.
          </p>
          {selected.indexStatus === "keyword_ready" && (
            <div className="inline-alert">
              <AlertCircle size={18} />
              Embeddings are unavailable. This document will use keyword search
              until you re-index it.
            </div>
          )}
          <p className="muted">
            Confirm the content is reviewed and suitable for public retrieval.
          </p>
          <div className="dialog-actions">
            <button className="button" onClick={() => setModal(null)}>
              Keep as draft
            </button>
            <button
              className="button primary"
              disabled={!!busy}
              onClick={() =>
                void run(
                  "knowledge.publish",
                  {
                    id: selected.id,
                    allowKeyword: selected.indexStatus === "keyword_ready",
                  },
                  "Document published",
                )
                  .then(() => setModal(null))
                  .catch(() => {})
              }
            >
              Publish document
            </button>
          </div>
        </Modal>
      )}
      {modal === "rollback" && selected && (
        <Modal
          error={error}
          title="Restore this published version?"
          onClose={() => setModal(null)}
        >
          <p>
            The selected indexed version will be used for future answers. Your
            current draft is retained.
          </p>
          <div className="dialog-actions">
            <button className="button" onClick={() => setModal(null)}>
              Cancel
            </button>
            <button
              className="button primary"
              disabled={!!busy}
              onClick={() =>
                void run(
                  "knowledge.rollback",
                  selected,
                  "Published version restored",
                )
                  .then(() => setModal(null))
                  .catch(() => {})
              }
            >
              Restore version
            </button>
          </div>
        </Modal>
      )}
      {preview && (
        <Modal
          error={error}
          title={preview.document.title}
          onClose={() => setPreview(null)}
        >
          <div className="document-preview prose">
            <Markdown>{preview.document.markdown}</Markdown>
          </div>
          <p className="muted">
            {preview.chunks.length} indexed chunks · Version{" "}
            {preview.document.version.slice(0, 8)}
          </p>
          <button
            className="button"
            onClick={() => {
              setUpload({
                id: preview.document.id,
                title: preview.document.title,
                markdown: preview.document.markdown,
                language: preview.document.language,
                source: preview.document.source,
                allowPublicProcessing: preview.document.allowPublicProcessing,
              });
              setPreview(null);
              setModal("upload");
            }}
          >
            Edit as a new version
          </button>
          {preview.versions?.length > 1 && (
            <div className="version-list">
              <h3>Version history</h3>
              {preview.versions.map((v: any) => (
                <div key={v.version}>
                  <span>
                    {v.version.slice(0, 8)} · {v.indexStatus}
                  </span>
                  {v.version !== preview.document.publishedVersion &&
                    ["ready", "keyword_ready"].includes(v.indexStatus) && (
                      <button
                        className="text-button"
                        onClick={() => {
                          setSelected({
                            id: preview.document.id,
                            version: v.version,
                          });
                          setPreview(null);
                          setModal("rollback");
                        }}
                      >
                        Restore published version
                      </button>
                    )}
                </div>
              ))}
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}

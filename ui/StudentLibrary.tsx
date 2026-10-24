import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  Download,
  ExternalLink,
  GraduationCap,
  Search,
  X,
} from "lucide-react";
import "./student-library.css";
interface RecordItem {
  id: string;
  question: string;
  answer: string;
}
interface Pack {
  id: string;
  number: number;
  level: string;
  title: string;
  subjects: string[];
  aliases: string;
  depth: string;
  scope: string;
  reviewStatus: string;
  sourceIds: string[];
  markdownUrl: string;
  records: RecordItem[];
}
interface Catalog {
  academicPacks: number;
  practicalPacks: number;
  totalRecords: number;
  datasets: Pack[];
  sources: {
    id: string;
    title: string;
    url: string;
    access: string;
    edition: string | null;
    role: string;
  }[];
}
const progressKey = "orin_study_completed_v1";
export default function StudentLibrary({
  onAsk,
}: {
  onAsk: (prompt: string) => void;
}) {
  const [catalog, setCatalog] = useState<Catalog | null>(null),
    [error, setError] = useState(""),
    [query, setQuery] = useState(""),
    [level, setLevel] = useState("ALL"),
    [selected, setSelected] = useState<Pack | null>(null),
    [practice, setPractice] = useState(false),
    [question, setQuestion] = useState(0),
    [revealed, setRevealed] = useState(false),
    [attempt, setAttempt] = useState("");
  const [completed, setCompleted] = useState<string[]>(() => {
    try {
      const p = JSON.parse(localStorage.getItem(progressKey) || "[]");
      return Array.isArray(p) ? p.filter((x) => typeof x === "string") : [];
    } catch {
      return [];
    }
  });
  const dialog = useRef<HTMLDialogElement>(null);
  const load = async (signal?: AbortSignal) => {
    setError("");
    try {
      const r = await fetch("/student-knowledge/catalog.json", { signal });
      if (!r.ok)
        throw Error("The study library could not be loaded. Please retry.");
      const data = await r.json();
      if (!Array.isArray(data.datasets) || !Array.isArray(data.sources))
        throw Error("The library files are incomplete.");
      setCatalog(data);
      const id = new URLSearchParams(location.search).get("pack");
      if (id) setSelected(data.datasets.find((p: Pack) => p.id === id) || null);
    } catch (e: any) {
      if (e.name !== "AbortError") setError(e.message);
    }
  };
  useEffect(() => {
    const c = new AbortController();
    void load(c.signal);
    return () => c.abort();
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(progressKey, JSON.stringify(completed));
    } catch {}
  }, [completed]);
  useEffect(() => {
    if (selected) {
      dialog.current?.showModal();
      setPractice(false);
      setQuestion(0);
      setRevealed(false);
      setAttempt("");
    } else dialog.current?.close();
  }, [selected]);
  const packs = useMemo(
    () =>
      catalog?.datasets.filter(
        (p) =>
          (level === "ALL" || p.level === level) &&
          `${p.title} ${p.subjects.join(" ")} ${p.aliases}`
            .toLocaleLowerCase()
            .includes(query.toLocaleLowerCase().trim()),
      ) || [],
    [catalog, level, query],
  );
  const current = selected?.records[question];
  const changeQuestion = (index: number) => {
    setQuestion(index);
    setRevealed(false);
    setAttempt("");
  };
  return (
    <div className="student-library">
      <header className="study-header">
        <a className="study-brand" href="/#home">
          <img src="/favicon.svg" alt="Orin logo" />
          orin<span>study</span>
        </a>
        <nav aria-label="Study navigation">
          <a href="/#home">
            <ArrowLeft size={15} />
            Home
          </a>
          <button
            onClick={() =>
              onAsk(
                "Help me study for Sri Lankan O/L or A/L. Ask me my level, exam year, subject, topic and preferred language first.",
              )
            }
            className="study-primary"
          >
            Ask Orin
            <ArrowRight size={16} />
          </button>
        </nav>
      </header>
      <main className="study-main">
        <section className="study-hero">
          <div>
            <span className="study-eyebrow">
              <GraduationCap size={16} /> FOR SRI LANKAN STUDENTS
            </span>
            <h1>
              A little practice.
              <br />
              <em>A clearer tomorrow.</em>
            </h1>
            <p>
              O/L and A/L foundations, worked examples, and practical guides for
              what comes next. Find a topic, try a question, and learn at your
              own pace.
            </p>
            <div className="study-totals">
              <span>
                <strong>{catalog?.academicPacks ?? 50}</strong> academic packs
              </span>
              <span>
                <strong>{catalog?.practicalPacks ?? 8}</strong> Sri Lanka guides
              </span>
              <span>
                <strong>{catalog?.totalRecords ?? 332}</strong> practice &
                reference records
              </span>
            </div>
          </div>
          <aside className="study-note">
            <BookOpen size={25} />
            <h2>A starting point, with sources.</h2>
            <p>
              These are original foundation notes and practice questions. They
              are not complete syllabi or official past papers. Subject-teacher
              review is pending.
            </p>
            <p>
              Notes are in English. Search subjects in English, Sinhala or
              Tamil. Check the prescribed syllabus and exam-year requirements
              through the linked official sources.
            </p>
          </aside>
        </section>
        <section className="study-downloads" aria-label="Dataset downloads">
          <div>
            <strong>Take your learning with you.</strong>
            <span>Markdown for RAG, structured Q&A for your own tools.</span>
          </div>
          <a href="/student-knowledge/orin-student-knowledge.zip" download>
            <Download size={16} />
            All packs · ZIP
          </a>
          <a href="/student-knowledge/records.jsonl" download>
            Q&A · JSONL
          </a>
          <a href="/student-knowledge/manifest.json" download>
            Sources & coverage
          </a>
        </section>
        <section aria-labelledby="study-catalog-title">
          <div className="study-section-heading">
            <div>
              <span className="study-eyebrow">YOUR NEXT TOPIC</span>
              <h2 id="study-catalog-title">Find a little clarity.</h2>
            </div>
            <label className="study-search">
              <Search size={18} />
              <span className="study-sr-only">Search study packs</span>
              <input
                aria-label="Search study packs"
                placeholder="Search a subject or topic…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              {query && (
                <button aria-label="Clear search" onClick={() => setQuery("")}>
                  <X size={16} />
                </button>
              )}
            </label>
          </div>
          <div className="study-filter-row">
            <div className="study-filters" aria-label="Study level">
              {[
                ["ALL", "All packs"],
                ["OL", "O/L"],
                ["AL", "A/L"],
                ["GENERAL", "Sri Lanka life"],
              ].map(([value, label]) => (
                <button
                  key={value}
                  aria-pressed={level === value}
                  className={level === value ? "active" : ""}
                  onClick={() => setLevel(value)}
                >
                  {label}
                </button>
              ))}
            </div>
            <p role="status">
              {catalog ? `${packs.length} packs found` : "Loading library…"}
              {completed.length > 0
                ? ` · ${completed.length} self-reviewed questions`
                : ""}
            </p>
          </div>
          {error ? (
            <div className="study-empty" role="alert">
              <h3>Let’s try that again.</h3>
              <p>{error}</p>
              <button className="study-primary" onClick={() => void load()}>
                Retry
              </button>
            </div>
          ) : (
            <div className="study-grid">
              {packs.map((p) => (
                <button
                  className="study-card"
                  key={p.id}
                  onClick={() => setSelected(p)}
                >
                  <div className="study-card-top">
                    <span className={`study-level ${p.level.toLowerCase()}`}>
                      {p.level === "GENERAL"
                        ? "LIFE IN SRI LANKA"
                        : p.level === "OL"
                          ? "O/L · GRADES 10–11"
                          : "A/L · GRADES 12–13"}
                    </span>
                    <span>{String(p.number).padStart(2, "0")}</span>
                  </div>
                  <h3>{p.title}</h3>
                  <p>{p.subjects.join(" · ")}</p>
                  <div className="study-card-bottom">
                    <span>{p.records.length} questions & notes</span>
                    <ArrowRight size={18} />
                  </div>
                </button>
              ))}
            </div>
          )}
          {catalog && !error && packs.length === 0 && (
            <div className="study-empty">
              <h3>No exact match yet.</h3>
              <p>Try a broader subject name or clear the level filter.</p>
              <button
                className="study-primary"
                onClick={() => {
                  setQuery("");
                  setLevel("ALL");
                }}
              >
                Show all packs
              </button>
            </div>
          )}
        </section>
        <section className="study-sources-note">
          <h2>Use the right source for the right question.</h2>
          <p>
            Official resource directories help identify subjects and further
            reading. They do not make these original answers
            government-approved. Some source checks were limited to search
            metadata; access and edition limits are listed with every pack.
            Timetables, fees, admissions cutoffs and safety alerts need a
            current official check.
          </p>
        </section>
      </main>
      <footer className="study-footer">
        <a href="/student-knowledge/README.md" download>
          Read coverage & reuse notes
        </a>
        <span>Original study content · References included</span>
        <a href="/admin">Administration</a>
      </footer>
      <dialog
        ref={dialog}
        className="study-dialog"
        aria-labelledby="study-pack-title"
        onCancel={() => setSelected(null)}
        onClose={() => setSelected(null)}
      >
        {selected && (
          <>
            <header className="study-dialog-header">
              <div>
                <span className="study-eyebrow">
                  {selected.level === "GENERAL"
                    ? "STUDENT LIFE"
                    : `${selected.level} FOUNDATION PACK`}
                </span>
                <h2 id="study-pack-title">{selected.title}</h2>
              </div>
              <button
                className="study-close"
                aria-label="Close study pack"
                onClick={() => setSelected(null)}
              >
                <X size={21} />
              </button>
            </header>
            <div className="study-dialog-body">
              <p className="study-pack-scope">
                {selected.scope} {selected.reviewStatus}
              </p>
              <div className="study-pack-actions">
                <button
                  className={practice ? "" : "active"}
                  aria-pressed={!practice}
                  onClick={() => setPractice(false)}
                >
                  Read notes
                </button>
                <button
                  className={practice ? "active" : ""}
                  aria-pressed={practice}
                  onClick={() => {
                    setPractice(true);
                    changeQuestion(0);
                  }}
                >
                  Practise questions
                </button>
                <a href={selected.markdownUrl} download>
                  <Download size={14} />
                  Markdown
                </a>
              </div>
              {practice && current ? (
                <section
                  className="study-practice"
                  aria-label="Practice question"
                >
                  <p className="study-eyebrow">
                    QUESTION {question + 1} OF {selected.records.length}
                  </p>
                  <h3>{current.question}</h3>
                  <label htmlFor="study-attempt">
                    Try your answer first <span>(stays on this page)</span>
                  </label>
                  <textarea
                    id="study-attempt"
                    value={attempt}
                    onChange={(e) => setAttempt(e.target.value)}
                    placeholder="Think it through, or write a few steps…"
                  />
                  <button
                    className="study-primary"
                    aria-expanded={revealed}
                    onClick={() => setRevealed((v) => !v)}
                  >
                    {revealed
                      ? "Hide reference answer"
                      : "Show reference answer"}
                  </button>
                  {revealed && (
                    <div className="study-reference">
                      <span className="study-eyebrow">
                        ORIGINAL FOUNDATION ANSWER
                      </span>
                      <p>{current.answer}</p>
                      <button
                        onClick={() =>
                          setCompleted((ids) =>
                            ids.includes(current.id)
                              ? ids
                              : [...ids, current.id],
                          )
                        }
                      >
                        <Check size={15} />
                        {completed.includes(current.id)
                          ? "Self-reviewed"
                          : "Mark as self-reviewed"}
                      </button>
                      <small>
                        This is a self-check, not an automatic grade.
                      </small>
                    </div>
                  )}
                  <div className="study-question-nav">
                    <button
                      disabled={question === 0}
                      onClick={() => changeQuestion(question - 1)}
                    >
                      <ArrowLeft size={16} />
                      Previous
                    </button>
                    <button
                      disabled={question === selected.records.length - 1}
                      onClick={() => changeQuestion(question + 1)}
                    >
                      Next
                      <ArrowRight size={16} />
                    </button>
                  </div>
                  <button
                    className="study-ask"
                    onClick={() =>
                      onAsk(
                        `I am studying ${selected.level} ${selected.title}. Please teach this question step by step: ${current.question} Ask my exam year and preferred language if needed. Treat the foundation note as an original study aid, not an official marking scheme.`,
                      )
                    }
                  >
                    Work through this with Orin
                    <ArrowRight size={16} />
                  </button>
                </section>
              ) : (
                <div className="study-note-list">
                  {selected.records.map((r) => (
                    <article key={r.id}>
                      <h3>{r.question}</h3>
                      <p>{r.answer}</p>
                    </article>
                  ))}
                </div>
              )}
              <section className="study-pack-sources">
                <h3>References & access notes</h3>
                <p>
                  The questions and explanations above are original editorial
                  content. These links provide official resource or service
                  context.
                </p>
                {selected.sourceIds.map((id) => {
                  const s = catalog?.sources.find((x) => x.id === id);
                  return s ? (
                    <div key={id}>
                      <a href={s.url} target="_blank" rel="noreferrer">
                        {s.title}
                        <ExternalLink size={12} />
                      </a>
                      <small>
                        {s.role} · {s.access.replaceAll("-", " ")}
                        {s.edition ? ` · ${s.edition}` : ""}
                      </small>
                    </div>
                  ) : null;
                })}
              </section>
            </div>
          </>
        )}
      </dialog>
    </div>
  );
}

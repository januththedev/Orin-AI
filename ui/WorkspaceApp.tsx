import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  lazy,
  Suspense,
} from "react";
import { ClerkProvider, useAuth, useClerk, useUser } from "@clerk/react";
import {
  ArrowUp,
  ArrowUpRight,
  Plus,
  Search,
  PanelLeftClose,
  PanelLeft,
  MessageSquare,
  Sparkles,
  ChevronDown,
  ChevronRight,
  X,
  Sun,
  Moon,
  Settings,
  LogOut,
  Shield,
  BookOpen,
  Copy,
  Check,
  RotateCcw,
  MoreHorizontal,
  Trash2,
  Pencil,
  LoaderCircle,
  ArrowLeft,
  FileText,
  Brain,
  CircleHelp,
  Download,
  Command,
  AlertCircle,
  Paperclip,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { makeApi, type ApiCall, type Conversation, type Message } from "./api";
import "./workspace.css";
const Admin = lazy(() => import("./WorkspaceAdmin"));
const noopToken = async () => null;
const env = (import.meta as any).env;

export function Mark({ small = false }: { small?: boolean }) {
  return <img className={small ? "orin-mark small" : "orin-mark"} src="/favicon.svg" alt="" aria-hidden="true" />;
}

function citationPlugin() {
  return (tree: any) => {
    const walk = (node: any) => {
      if (["link", "code", "inlineCode"].includes(node.type)) return;
      if (node.children)
        node.children = node.children.flatMap((child: any) => {
          if (child.type !== "text") {
            walk(child);
            return [child];
          }
          const parts = child.value.split(/(\[\d+\])/g);
          return parts.map((part: string) =>
            /^\[\d+\]$/.test(part)
              ? {
                  type: "link",
                  url: "#orin-source-" + part.slice(1, -1),
                  children: [{ type: "text", value: part }],
                }
              : { type: "text", value: part },
          );
        });
    };
    walk(tree);
  };
}
export function Markdown({
  children,
  onCitation,
}: {
  children: string;
  onCitation?: (index: number) => void;
}) {
  return (
    <ReactMarkdown
      remarkPlugins={[
        remarkGfm,
        remarkMath,
        ...(onCitation ? [citationPlugin] : []),
      ]}
      rehypePlugins={[rehypeKatex]}
      components={{
        a: ({ children, ...p }) =>
          p.href?.startsWith("#orin-source-") && onCitation ? (
            <button
              className="inline-citation"
              onClick={() => onCitation(Number(p.href!.split("-").pop()))}
            >
              {children}
            </button>
          ) : (
            <a {...p} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
      }}
    >
      {children}
    </ReactMarkdown>
  );
}
export function IconButton({
  label,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      className="icon-button"
      title={label}
      aria-label={label}
      {...props}
    >
      {children}
    </button>
  );
}
export function Modal({
  error,
  title,
  children,
  onClose,
}: {
  error?: string;
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    const handle = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRef.current();
      if (e.key === "Tab") {
        const focusable = box.current?.querySelectorAll<HTMLElement>(
          "button,input,textarea,select,a[href]",
        );
        if (!focusable?.length) return;
        const first = focusable[0],
          last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    (
      box.current?.querySelector<HTMLElement>("input,textarea,select") ||
      box.current?.querySelector<HTMLElement>("button")
    )?.focus();
    document.addEventListener("keydown", handle);
    return () => {
      document.removeEventListener("keydown", handle);
      previous?.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={box}
      >
        <div className="modal-title">
          <h2>{title}</h2>
          <IconButton label="Close dialog" onClick={onClose}>
            <X size={19} />
          </IconButton>
        </div>
        {error && (
          <div className="inline-alert error" role="alert">
            {error}
          </div>
        )}
        {children}
      </div>
    </div>
  );
}
function ClerkSession() {
  const { isLoaded, isSignedIn, userId, getToken } = useAuth();
  const clerk = useClerk();
  const { user } = useUser();
  const token = useCallback(() => getToken(), [getToken]);
  return (
    <Shell
      identity={isSignedIn ? userId : null}
      authLoading={!isLoaded}
      getToken={token}
      name={user?.firstName || undefined}
      login={() => clerk.openSignIn()}
      logout={() => void clerk.signOut()}
    />
  );
}
export default function WorkspaceApp() {
  const key = env.VITE_CLERK_PUBLISHABLE_KEY;
  if (key)
    return (
      <ClerkProvider
        publishableKey={key}
        appearance={{
          variables: {
            colorPrimary: "#b86b50",
            borderRadius: "0.8rem",
            fontFamily: "Inter Variable, system-ui, sans-serif",
          },
        }}
      >
        <ClerkSession />
      </ClerkProvider>
    );
  const demo = env.DEV && env.VITE_ORIN_LOCAL_DEMO === "1";
  return (
    <Shell
      identity={demo ? "local-preview" : null}
      authLoading={false}
      getToken={noopToken}
      demo={demo}
    />
  );
}
function Shell({
  identity,
  authLoading,
  getToken,
  name,
  login,
  logout,
  demo = false,
}: {
  identity: string | null;
  authLoading: boolean;
  getToken: () => Promise<string | null>;
  name?: string;
  login?: () => void;
  logout?: () => void;
  demo?: boolean;
}) {
  const api = useMemo(() => makeApi(getToken), [getToken]);
  const [account, setAccount] = useState<any>(null);
  const [chats, setChats] = useState<Conversation[]>([]),
    [next, setNext] = useState<any>(null),
    [active, setActive] = useState<string | null>(null),
    [messages, setMessages] = useState<Message[]>([]),
    [messageNext, setMessageNext] = useState<any>(null);
  const [prompt, setPrompt] = useState(() => { try { return sessionStorage.getItem("orin_landing_prompt") || ""; } catch { return ""; } }),
    [thinking, setThinking] = useState(false),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(false),
    [historyLoading, setHistoryLoading] = useState(false);
  const [view, setView] = useState<"chat" | "admin">("chat"),
    [mobile, setMobile] = useState(false),
    [collapsed, setCollapsed] = useState(false),
    [search, setSearch] = useState("");
  const [dialog, setDialog] = useState<
      "settings" | "signin" | "delete" | "rename" | null
    >(null),
    [error, setError] = useState(""),
    [sources, setSources] = useState<any[] | null>(null),
    [copied, setCopied] = useState<string | null>(null),
    [rename, setRename] = useState("");
  const [theme, setTheme] = useState(
    () => localStorage.getItem("orin_workspace_theme") || "light",
  );
  const activeRef = useRef(active);
  activeRef.current = active;
  const [allowPublic, setAllowPublic] = useState(false);
  const [language, setLanguage] = useState(
    () => localStorage.getItem("orin_workspace_language") || "auto",
  );
  const end = useRef<HTMLDivElement>(null),
    input = useRef<HTMLTextAreaElement>(null),
    request = useRef<AbortController | null>(null);
  const identityRef = useRef(identity);
  identityRef.current = identity;
  const reloadChats = useCallback(async () => {
    const owner = identityRef.current;
    const d = await api("conversations", { search });
    if (identityRef.current === owner) {
      setChats(d.items);
      setNext(d.next);
    }
  }, [api, search]);
  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    localStorage.setItem("orin_workspace_theme", theme);
  }, [theme]);
  useEffect(() => {
    localStorage.setItem("orin_workspace_language", language);
  }, [language]);
  useEffect(() => {
    let alive = true;
    setAllowPublic(false);
    setAccount(null);
    setChats([]);
    setMessages([]);
    setActive(null);
    setError("");
    setSources(null);
    setView("chat");
    request.current?.abort();
    if (!identity) return;
    setLoading(true);
    api("bootstrap")
      .then((d) => {
        if (alive) setAccount(d.account);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [identity, api]);
  useEffect(() => {
    if (!account) return;
    let alive = true;
    const timer = setTimeout(() => {
      setHistoryLoading(true);
      api("conversations", { search })
        .then((d) => {
          if (alive) {
            setChats(d.items);
            setNext(d.next);
          }
        })
        .catch((e) => {
          if (alive) setError(e.message);
        })
        .finally(() => {
          if (alive) setHistoryLoading(false);
        });
    }, 180);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [account, api, search]);
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);
  useEffect(() => {
    if (input.current) {
      input.current.style.height = "auto";
      input.current.style.height = `${Math.min(180, input.current.scrollHeight)}px`;
    }
  }, [prompt]);
  const signIn = () => {
    if (login) login();
    else setDialog("signin");
  };
  useEffect(() => { try { sessionStorage.removeItem("orin_landing_prompt"); } catch {} }, []);
  useEffect(() => {
    if (!authLoading && window.location.hash === '#signin') {
      window.location.hash = 'chat';
      if (!identity) signIn();
    }
  }, [authLoading, identity, login]);
  const newChat = useCallback(() => {
    setActive(null);
    setMessages([]);
    setMessageNext(null);
    setPrompt("");
    setError("");
    setSources(null);
    setView("chat");
    setMobile(false);
    input.current?.focus();
  }, []);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setCollapsed(false);
        setMobile(true);
        document
          .querySelector<HTMLInputElement>(".history-search input")
          ?.focus();
      }
      if (
        (e.metaKey || e.ctrlKey) &&
        e.shiftKey &&
        e.key.toLowerCase() === "o"
      ) {
        e.preventDefault();
        newChat();
      }
      if (e.key === "Escape") {
        setMobile(false);
        setSources(null);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [newChat]);
  const openChat = async (c: Conversation) => {
    setActive(c.id);
    activeRef.current = c.id;
    setView("chat");
    setMobile(false);
    setThinking(c.thinking);
    setMessages([]);
    setLoading(true);
    setError("");
    setSources(null);
    try {
      const d = await api("messages", { id: c.id });
      if (activeRef.current === c.id) {
        setMessages(d.items);
        setMessageNext(d.next);
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };
  const send = async (text = prompt) => {
    if (!text.trim() || busy) return;
    if (!account) {
      signIn();
      return;
    }
    const id = active || crypto.randomUUID(),
      requestId = crypto.randomUUID(),
      sent = text.trim(),
      who = identity;
    setActive(id);
    activeRef.current = id;
    setView("chat");
    setPrompt("");
    setBusy(true);
    setError("");
    const optimistic: Message = {
      id: requestId,
      role: "user",
      content: sent,
      status: "complete",
    };
    setMessages((m) => [...m, optimistic]);
    const controller = new AbortController();
    request.current = controller;
    try {
      const d = await api(
        "chat",
        {
          conversationId: id,
          requestId,
          prompt: sent,
          thinking,
          language,
          allowPublicProcessing: allowPublic,
        },
        controller.signal,
        (delta) => {
          if (identityRef.current !== who || activeRef.current !== id) return;
          setMessages((current) => {
            const existing = current.find(
              (m) => m.id === "stream-" + requestId,
            );
            return existing
              ? current.map((m) =>
                  m.id === existing.id
                    ? { ...m, content: m.content + delta }
                    : m,
                )
              : [
                  ...current,
                  {
                    id: "stream-" + requestId,
                    role: "assistant",
                    content: delta,
                    status: "streaming",
                  },
                ];
          });
        },
      );
      if (identityRef.current === who && activeRef.current === id)
        setMessages((m) => [
          ...m.filter((x) => x.id !== "stream-" + requestId),
          d.message,
        ]);
      if (identityRef.current === who) await reloadChats();
    } catch (e: any) {
      if (identityRef.current === who) {
        setMessages((current) =>
          current.map((m) =>
            m.id === "stream-" + requestId
              ? { ...m, status: "interrupted" }
              : m,
          ),
        );
        setError(
          e.name === "AbortError"
            ? "Stopped waiting. The server may still finish this answer; reopen the conversation to check."
            : e.message,
        );
      }
    } finally {
      setBusy(false);
      request.current = null;
    }
  };
  const copy = async (m: Message) => {
    try {
      await navigator.clipboard.writeText(m.content);
      setCopied(m.id);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      setError("Clipboard is unavailable in this browser.");
    }
  };
  const activeChat = chats.find((c) => c.id === active);
  const firstName = name || account?.name?.split(" ")[0];
  const suggestions = [
    {
      icon: Pencil,
      label: "Plan my revision",
      prompt: "Help me make a realistic revision plan. Ask my O/L or A/L level, exam year, subjects, preferred language and available study time first.",
    },
    {
      icon: BookOpen,
      label: "Explain a topic",
      prompt: "Help me understand a Sri Lankan O/L or A/L topic with a simple example. Ask my subject, exam year and preferred language.",
    },
    {
      icon: Brain,
      label: "Quiz me",
      prompt: "Quiz me on a topic I am revising. Ask my subject and level, give one original practice question at a time, and explain my mistakes.",
    },
    {
      icon: Command,
      label: "Check my working",
      prompt: "Help me check my working step by step. Ask for the question, my attempt, level and subject. Do not call it an official marking scheme.",
    },
  ];
  const composer = (
    <div className="composer-region">
      <div className="composer">
        <textarea
          ref={input}
          rows={2}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (
              e.key === "Enter" &&
              !e.shiftKey &&
              !e.nativeEvent.isComposing
            ) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder="What’s on your mind?"
          aria-label="Message Orin"
          disabled={loading || authLoading}
        />
        <div className="composer-tools">
          <div className="composer-left">
            <button
              className={`thinking-button ${thinking ? "enabled" : ""}`}
              onClick={() => setThinking((t) => !t)}
              aria-pressed={thinking}
            >
              <Brain size={16} />
              <span>Thinking</span>
              <span className="toggle-track">
                <i />
              </span>
            </button>
            <span className="composer-divider" />
            <span className="routing-label">
              <Sparkles size={13} />
              {thinking ? "Best available" : "Balanced"}
            </span>
          </div>
          <button
            className="send-button"
            aria-label="Send message"
            disabled={!prompt.trim() || busy || loading || authLoading}
            onClick={() => void send()}
          >
            {busy ? (
              <LoaderCircle size={20} className="spin" />
            ) : (
              <ArrowUp size={21} />
            )}
          </button>
        </div>
      </div>
      <p className="composer-footnote">
        Orin can make mistakes. Check important information.
        <span>Shift + Enter for a new line</span>
      </p>
    </div>
  );
  return (
    <div className={`orin-workspace ${collapsed ? "sidebar-collapsed" : ""}`}>
      {mobile && (
        <button
          className="sidebar-scrim"
          aria-label="Close navigation"
          onClick={() => setMobile(false)}
        />
      )}
      <aside
        className={`workspace-sidebar ${mobile ? "mobile-open" : ""}`}
        aria-label="Main navigation"
      >
        <div className="sidebar-brand">
          <button onClick={newChat} className="wordmark">
            <Mark small />
            <span>
              orin<span className="wordmark-dot">.</span>
            </span>
          </button>
          <IconButton
            label="Collapse sidebar"
            onClick={() => {
              setCollapsed(true);
              setMobile(false);
            }}
          >
            <PanelLeftClose size={19} />
          </IconButton>
        </div>
        <button className="new-chat" onClick={newChat}>
          <Plus size={18} />
          <span>New conversation</span>
          <kbd>⌘ O</kbd>
        </button>
        <label className="history-search">
          <Search size={16} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search conversations"
            aria-label="Search conversations"
          />
          <kbd>⌘ K</kbd>
        </label>
        <div className="sidebar-label">
          Your conversations{" "}
          {historyLoading && <LoaderCircle size={12} className="spin" />}
        </div>
        <nav className="conversation-list" aria-label="Conversation history">
          {chats.map((c) => (
            <button
              key={c.id}
              className={`conversation-link ${active === c.id && view === "chat" ? "selected" : ""}`}
              onClick={() => void openChat(c)}
            >
              <MessageSquare size={15} />
              <span>{c.title}</span>
            </button>
          ))}
          {!chats.length && !historyLoading && (
            <div className="history-empty">
              <MessageSquare size={22} />
              <p>
                {account
                  ? "A little space for your next big idea."
                  : "Your conversations, all in one place."}
              </p>
              <span>
                {account
                  ? "Start a conversation to see it here."
                  : "Sign in to pick up where you left off."}
              </span>
            </div>
          )}
          {next && (
            <button
              className="text-button history-more"
              onClick={() =>
                void api("conversations", { cursor: next, search })
                  .then((d) => {
                    setChats((c) => [...c, ...d.items]);
                    setNext(d.next);
                  })
                  .catch((e) => setError(e.message))
              }
            >
              Load older conversations
            </button>
          )}
        </nav>
        <div className="sidebar-bottom">
          <button className="sidebar-action" onClick={() => window.location.assign('/learn')}><BookOpen size={17}/><span>Student library</span></button>
            <button
              className={`sidebar-action ${view === "admin" ? "selected" : ""}`}
              onClick={() => {
                if (demo) setView("admin");
                else window.location.assign("/admin");
                setMobile(false);
                setSources(null);
              }}
            >
              <Shield size={17} />
              <span>Administration</span>
              <span className="tiny-pill">Admin</span>
            </button>
          <button
            className="sidebar-action"
            onClick={() => setDialog("settings")}
          >
            <Settings size={17} />
            <span>Settings & preferences</span>
          </button>
          <button
            className="account-button"
            onClick={() => (account ? setDialog("settings") : signIn())}
          >
            <span className="avatar">
              {(firstName || "O").charAt(0).toUpperCase()}
            </span>
            <span>
              <strong>
                {account ? account.name : "Make yourself at home"}
              </strong>
              <small>
                {demo
                  ? "Local preview"
                  : account
                    ? "Personal workspace"
                    : "Sign in to save your chats"}
              </small>
            </span>
            <ChevronDown size={14} />
          </button>
        </div>
      </aside>
      <main className="workspace-main">
        <header className="workspace-header">
          <div className="header-left">
            <span className="expand-sidebar">
              <IconButton
                label="Open sidebar"
                onClick={() => {
                  setCollapsed(false);
                  setMobile(true);
                }}
              >
                <PanelLeft size={20} />
              </IconButton>
            </span>
            <button
              className="header-location"
              onClick={() => {
                setView("chat");
              }}
            >
              {view === "admin"
                ? "Administration"
                : activeChat?.title || "Personal workspace"}
              <ChevronDown size={13} />
            </button>
          </div>
          <div className="header-actions">
            {demo && (
              <span className="preview-badge">
                <span />
                Local preview
              </span>
            )}
            {!account && (
              <button className="button small primary" onClick={signIn}>
                Sign in <ArrowUpRight size={14} />
              </button>
            )}
            {account && active && view === "chat" && (
              <>
                <IconButton
                  label="Rename conversation"
                  onClick={() => {
                    setRename(activeChat?.title || "");
                    setDialog("rename");
                  }}
                >
                  <Pencil size={16} />
                </IconButton>
                <IconButton
                  label="Delete conversation"
                  onClick={() => setDialog("delete")}
                >
                  <Trash2 size={16} />
                </IconButton>
              </>
            )}
            {account && <span className="header-monogram">O</span>}
          </div>
        </header>
        {error && (
          <div className="error-banner" role="alert">
            <AlertCircle size={17} />
            <span>{error}</span>
            <IconButton label="Dismiss error" onClick={() => setError("")}>
              <X size={15} />
            </IconButton>
          </div>
        )}
        {view === "admin" && account?.role === "admin" ? (
          <Suspense
            fallback={
              <div className="page-loading">
                <LoaderCircle className="spin" />
                Opening administration…
              </div>
            }
          >
            <Admin api={api} demo={demo} />
          </Suspense>
        ) : (
          <>
            <div
              className={`conversation-scroll ${messages.length ? "has-messages" : ""}`}
            >
              {loading || authLoading ? (
                <div className="page-loading">
                  <LoaderCircle size={20} className="spin" />
                  Getting your workspace ready…
                </div>
              ) : messages.length ? (
                <div className="messages-column">
                  {messageNext && (
                    <button
                      className="text-button older-messages"
                      onClick={() =>
                        void api("messages", {
                          id: active,
                          before: messageNext,
                        })
                          .then((d) => {
                            setMessages((m) => [...d.items, ...m]);
                            setMessageNext(d.next);
                          })
                          .catch((e) => setError(e.message))
                      }
                    >
                      Load earlier messages
                    </button>
                  )}
                  {messages.map((m) => (
                    <article key={m.id} className={`message ${m.role}`}>
                      <div className="message-avatar">
                        {m.role === "assistant" ? (
                          <Mark small />
                        ) : (
                          <span>{(firstName || "Y").charAt(0)}</span>
                        )}
                      </div>
                      <div className="message-body">
                        {m.status === "pending" ? (
                          <p className="muted">
                            This answer is still processing. Reopen this
                            conversation shortly.
                          </p>
                        ) : m.status === "failed" ? (
                          <p className="muted">
                            This answer could not be completed. You can retry
                            your last message.
                          </p>
                        ) : (
                          <div className="prose">
                            <Markdown
                              onCitation={
                                m.metadata?.sources?.length
                                  ? () => setSources(m.metadata.sources)
                                  : undefined
                              }
                            >
                              {m.content}
                            </Markdown>
                          </div>
                        )}
                        {m.role === "assistant" && m.status === "complete" && (
                          <>
                            <div className="answer-sources">
                              {m.metadata?.sources?.length > 0 && (
                                <button
                                  onClick={() => setSources(m.metadata.sources)}
                                >
                                  <BookOpen size={13} />
                                  {m.metadata.sources.length} sources
                                  <ArrowUpRight size={12} />
                                </button>
                              )}
                              {m.metadata?.degraded?.length > 0 && (
                                <span title={m.metadata.degraded.join(", ")}>
                                  Limited retrieval
                                </span>
                              )}
                            </div>
                            <div className="message-actions">
                              <IconButton
                                label="Copy answer"
                                onClick={() => void copy(m)}
                              >
                                {copied === m.id ? (
                                  <Check size={14} />
                                ) : (
                                  <Copy size={14} />
                                )}
                              </IconButton>
                              {m.model && (
                                <span>
                                  {m.model === "local-demo"
                                    ? "Preview responder"
                                    : m.model.split("/").pop()}{" "}
                                  ·{" "}
                                  {m.metadata?.mode === "best"
                                    ? "Best"
                                    : "Balanced"}
                                </span>
                              )}
                              {m.metadata?.citations?.invalid?.length > 0 && (
                                <span className="warning-text">
                                  Some source references could not be verified
                                </span>
                              )}
                            </div>
                          </>
                        )}
                      </div>
                    </article>
                  ))}
                  {busy && (
                    <div className="working-indicator" role="status">
                      <Mark small />
                      <span>
                        {thinking ? "Thinking carefully" : "Working on it"}
                        <i>…</i>
                      </span>
                      <button onClick={() => request.current?.abort()}>
                        Stop waiting
                      </button>
                    </div>
                  )}
                  <div ref={end} />
                </div>
              ) : (
                <div className="welcome">
                  <div className="welcome-eyebrow">
                    <span className="status-dot" />A little clarity goes a long
                    way
                  </div>
                  <div className="welcome-heading">
                    <Mark />
                    <h1>
                      {firstName
                        ? `Good to see you, ${firstName}.`
                        : "A space for your next idea."}
                    </h1>
                  </div>
                  <p>
                    Understand a topic. Practise a question. Find your next step.
                  </p>
                  {composer}
                  <div className="suggestion-row">
                    {suggestions.map((s) => (
                      <button
                        key={s.label}
                        onClick={() => {
                          setPrompt(s.prompt);
                          input.current?.focus();
                        }}
                      >
                        <s.icon size={16} />
                        {s.label}
                      </button>
                    ))}
                  </div>
                  <div className="welcome-note">
                    <span className="note-line" />
                    <span>Thoughtful answers. Grounded in knowledge.</span>
                    <span className="note-line" />
                  </div>
                </div>
              )}
            </div>
            {(messages.length > 0 || loading || authLoading) && composer}
          </>
        )}
      </main>
      {sources && (
        <aside className="sources-drawer" aria-label="Answer sources">
          <div className="drawer-title">
            <div>
              <BookOpen size={18} />
              <h2>Behind the answer</h2>
            </div>
            <IconButton label="Close sources" onClick={() => setSources(null)}>
              <X size={18} />
            </IconButton>
          </div>
          <p className="muted">
            The exact passages provided to Orin for this answer.
          </p>
          {sources.map((s) => (
            <div className="source-card" key={s.id}>
              <span className="source-number">{s.index}</span>
              <h3>{s.title}</h3>
              <small>{s.section}</small>
              <div className="prose">
                <Markdown>{s.content}</Markdown>
              </div>
            </div>
          ))}
        </aside>
      )}
      {dialog === "settings" && (
        <Modal title="Your workspace" onClose={() => setDialog(null)}>
          <div className="settings-section">
            <label>Appearance</label>
            <div className="segmented">
              <button
                className={theme === "light" ? "active" : ""}
                onClick={() => setTheme("light")}
              >
                <Sun size={16} />
                Light
              </button>
              <button
                className={theme === "dark" ? "active" : ""}
                onClick={() => setTheme("dark")}
              >
                <Moon size={16} />
                Dark
              </button>
            </div>
          </div>
          <div className="settings-section">
            <label htmlFor="response-language">Response language</label>
            <select
              id="response-language"
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
            >
              <option value="auto">Match my message</option>
              <option value="en">English</option>
              <option value="si">සිංහල</option>
              <option value="ta">தமிழ்</option>
            </select>
          </div>
          <div className="settings-section">
            <label>Provider data policies</label>
            <label className="checkbox-field">
              <input
                type="checkbox"
                checked={allowPublic}
                onChange={(e) => setAllowPublic(e.target.checked)}
              />
              Allow models restricted to public, non-confidential inputs for
              this session
            </label>
            <p className="muted">
              Some free endpoints, including NVIDIA free endpoints on
              OpenRouter, log inputs for improvement and exclude personal or
              confidential data. Keep this off for private material.
            </p>
          </div>
          <div className="settings-section">
            <label>Account</label>
            <p className="muted">
              {account
                ? `${account.name} · ${demo ? "Local demo account" : account.email || "Signed in with Clerk"}`
                : "Sign in to save conversations and access them on another device."}
            </p>
            {account && !demo ? (
              <button className="button" onClick={logout}>
                <LogOut size={15} />
                Sign out
              </button>
            ) : !account ? (
              <button className="button primary" onClick={signIn}>
                Sign in
              </button>
            ) : (
              <span className="tiny-pill">
                Preview data resets when the demo API restarts
              </span>
            )}
          </div>
          <div className="settings-links">
            <a href="#privacy">Privacy</a>
            <a href="#terms">Terms</a>
            <a href="#downloads">Downloads</a>
          </div>
        </Modal>
      )}
      {dialog === "signin" && (
        <Modal title="Make yourself at home" onClose={() => setDialog(null)}>
          <div className="signin-intro">
            <Mark />
            <p>Your conversations, ready whenever you are.</p>
            <p className="muted">
              Sign-in is not configured for this environment yet. Add the Clerk
              publishable key to enable the secure sign-in screen.
            </p>
            <button className="button" onClick={() => setDialog(null)}>
              Back to workspace
            </button>
          </div>
        </Modal>
      )}
      {dialog === "delete" && (
        <Modal
          title="Delete this conversation?"
          onClose={() => setDialog(null)}
        >
          <p className="muted">
            It will be removed from your history on all devices.
          </p>
          <div className="dialog-actions">
            <button className="button" onClick={() => setDialog(null)}>
              Keep conversation
            </button>
            <button
              className="button danger"
              onClick={() =>
                void api("conversation.update", { id: active, deleted: true })
                  .then(() => {
                    setDialog(null);
                    newChat();
                    void reloadChats();
                  })
                  .catch((e) => setError(e.message))
              }
            >
              Delete conversation
            </button>
          </div>
        </Modal>
      )}
      {dialog === "rename" && (
        <Modal title="Rename conversation" onClose={() => setDialog(null)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void api("conversation.update", { id: active, title: rename })
                .then(() => {
                  setDialog(null);
                  void reloadChats();
                })
                .catch((e) => setError(e.message));
            }}
          >
            <label className="field">
              Conversation title
              <input
                autoFocus
                value={rename}
                onChange={(e) => setRename(e.target.value)}
                maxLength={120}
                required
              />
            </label>
            <div className="dialog-actions">
              <button
                className="button"
                type="button"
                onClick={() => setDialog(null)}
              >
                Cancel
              </button>
              <button className="button primary" disabled={!rename.trim()}>
                Save title
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

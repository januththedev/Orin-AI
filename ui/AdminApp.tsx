import React, {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  ArrowLeft,
  ArrowRight,
  LoaderCircle,
  LockKeyhole,
  LogOut,
} from "lucide-react";
import { makeApi, type ApiCall } from "./api";
import "./workspace.css";
const Dashboard = lazy(() => import("./WorkspaceAdmin"));
const anonymousToken = async () => null;

export default function AdminApp() {
  const rawApi = useMemo(() => makeApi(anonymousToken), []);
  const [authenticated, setAuthenticated] = useState(false);
  const [checking, setChecking] = useState(true);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [configured, setConfigured] = useState(true);
  const api: ApiCall = useCallback(
    async (...args) => {
      try {
        return await rawApi(...args);
      } catch (e: any) {
        if (e.status === 401 || e.status === 403) {
          setAuthenticated(false);
          setError("Your admin session ended. Enter the password again.");
        }
        throw e;
      }
    },
    [rawApi],
  );
  useEffect(() => {
    let active = true;
    void rawApi("admin.session")
      .then((s) => {
        if (!active) return;
        setAuthenticated(s.authenticated);
        setConfigured(s.configured);
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setChecking(false);
      });
    return () => {
      active = false;
    };
  }, [rawApi]);
  async function login(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    const submitted = password;
    setPassword("");
    try {
      await rawApi("admin.login", { password: submitted });
      setAuthenticated(true);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function logout() {
    setBusy(true);
    try {
      await rawApi("admin.logout");
      setAuthenticated(false);
      setError("");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="orin-workspace password-admin">
      <header className="password-admin-header">
        <a className="password-admin-brand" href="/#home">
          <img src="/favicon.svg" alt="Orin logo" />
          <span>
            Orin <span>Administration</span>
          </span>
        </a>
        {authenticated ? (
          <button
            className="button"
            onClick={() => void logout()}
            disabled={busy}
          >
            <LogOut size={16} /> Sign out
          </button>
        ) : (
          <a className="text-button" href="/#home">
            <ArrowLeft size={16} /> Back to Orin
          </a>
        )}
      </header>
      {checking ? (
        <main
          className="password-admin-loading"
          aria-label="Checking admin session"
        >
          <LoaderCircle className="spin" size={24} />
        </main>
      ) : authenticated ? (
        <main className="password-admin-content">
          <Suspense
            fallback={
              <div className="password-admin-loading">
                <LoaderCircle className="spin" />
              </div>
            }
          >
            <Dashboard
              api={api}
              demo={
                (import.meta as any).env.DEV &&
                (import.meta as any).env.VITE_ORIN_LOCAL_DEMO === "1"
              }
            />
          </Suspense>
        </main>
      ) : (
        <main className="password-admin-login">
          <section
            className="password-admin-card"
            aria-labelledby="admin-title"
          >
            <div className="password-admin-lock">
              <LockKeyhole size={25} />
            </div>
            <p className="eyebrow">YOUR WORKSPACE, BEHIND THE SCENES</p>
            <h1 id="admin-title">Welcome back.</h1>
            <p className="password-admin-description">
              Manage your models, API keys, and knowledge. Enter your admin
              password to continue.
            </p>
            {error && (
              <div className="inline-alert error" role="alert">
                {error}
              </div>
            )}
            {!configured && (
              <div className="inline-alert" role="status">
                Set <code>ORIN_ADMIN_PASSWORD</code> in Vercel to at least 12
                characters, then redeploy to enable administration.
              </div>
            )}
            <form onSubmit={(event) => void login(event)}>
              <label htmlFor="admin-password">Admin password</label>
              <input
                id="admin-password"
                type="password"
                name="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                required
                autoFocus
                disabled={busy}
              />
              <button
                className="button primary"
                type="submit"
                disabled={busy || !password || !configured}
              >
                {busy ? (
                  <LoaderCircle className="spin" size={17} />
                ) : (
                  <>
                    Open administration <ArrowRight size={17} />
                  </>
                )}
              </button>
            </form>
            <p className="password-admin-footnote">
              <LockKeyhole size={12} /> A private space for the people who run
              Orin.
            </p>
          </section>
        </main>
      )}
    </div>
  );
}

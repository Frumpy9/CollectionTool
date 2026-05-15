import {
  BarChart3,
  Camera,
  ChevronDown,
  CircleDollarSign,
  Database,
  Gem,
  Grid2X2,
  ListFilter,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  Tags
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { AuthMeResponse, AuthUser, CollectionSummary } from "@collection-tool/shared";
import { api } from "./api";

type HealthState =
  | { status: "loading" }
  | { status: "ok"; timestamp: string; migrationsApplied: number }
  | { status: "error"; message: string };

const starterStats = [
  { label: "Total cards", value: "0", icon: Grid2X2 },
  { label: "Estimated value", value: "$0.00", icon: CircleDollarSign },
  { label: "Needs review", value: "0", icon: Sparkles },
  { label: "Price refresh", value: "Ready", icon: BarChart3 }
];

const roadmapItems = [
  "Manual card lookup",
  "Full accounts",
  "PSA slab import",
  "CGC cert drafts",
  "eBay sold comps",
  "Continuous scan mode"
];

export function App() {
  const [auth, setAuth] = useState<AuthMeResponse | null>(null);
  const [needsBootstrap, setNeedsBootstrap] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);
  const [health, setHealth] = useState<HealthState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;

    Promise.all([api.bootstrapStatus(), api.me()])
      .then(([bootstrapStatus, me]) => {
        if (!cancelled) {
          setNeedsBootstrap(bootstrapStatus.needsBootstrap);
          setAuth(me);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAuth({ user: null, collections: [] });
        }
      })
      .finally(() => {
        if (!cancelled) {
          setAuthLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    fetch("/health", { credentials: "include" })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`API returned ${response.status}`);
        }
        return response.json() as Promise<{
          timestamp: string;
          database: { migrationsApplied: number };
        }>;
      })
      .then((payload) => {
        if (!cancelled) {
          setHealth({
            status: "ok",
            timestamp: payload.timestamp,
            migrationsApplied: payload.database.migrationsApplied
          });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setHealth({
            status: "error",
            message: error instanceof Error ? error.message : "Unable to reach API"
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const healthText = useMemo(() => {
    if (health.status === "loading") {
      return "Checking API";
    }

    if (health.status === "error") {
      return "API offline";
    }

    return "API online";
  }, [health]);

  if (authLoading) {
    return <LoadingScreen />;
  }

  if (!auth?.user) {
    return (
      <AuthScreen
        mode={needsBootstrap ? "bootstrap" : "login"}
        onAuthenticated={(nextAuth) => {
          setAuth(nextAuth);
          setNeedsBootstrap(false);
        }}
      />
    );
  }

  return (
    <WorkspaceShell
      authUser={auth.user}
      collections={auth.collections}
      health={health}
      healthText={healthText}
      onLogout={async () => {
        await api.logout();
        setAuth({ user: null, collections: [] });
      }}
    />
  );
}

function WorkspaceShell({
  authUser,
  collections,
  health,
  healthText,
  onLogout
}: {
  authUser: AuthUser;
  collections: CollectionSummary[];
  health: HealthState;
  healthText: string;
  onLogout: () => Promise<void>;
}) {
  const activeCollection = collections[0];

  return (
    <main className="app-shell">
      <aside className="sidebar" aria-label="Collection navigation">
        <div className="brand-lockup">
          <div className="brand-mark">
            <Gem size={22} aria-hidden="true" />
          </div>
          <div>
            <p className="eyebrow">Collection Tool</p>
            <h1>Pokemon Vault</h1>
          </div>
        </div>

        <button className="collection-switcher" type="button">
          <span>
            <strong>{activeCollection?.name ?? "No collection"}</strong>
            <small>
              {activeCollection
                ? `${activeCollection.role} workspace`
                : "Create a collection to begin"}
            </small>
          </span>
          <ChevronDown size={18} aria-hidden="true" />
        </button>

        <nav className="nav-stack" aria-label="Primary">
          <a className="nav-item active" href="#collection">
            <Grid2X2 size={18} aria-hidden="true" />
            Collection
          </a>
          <a className="nav-item" href="#graded">
            <ShieldCheck size={18} aria-hidden="true" />
            Graded cards
          </a>
          <a className="nav-item" href="#tags">
            <Tags size={18} aria-hidden="true" />
            Tags & storage
          </a>
          <a className="nav-item" href="#data">
            <Database size={18} aria-hidden="true" />
            Data sources
          </a>
        </nav>

        <div className={`system-card ${health.status}`}>
          <span className="pulse" aria-hidden="true" />
          <div>
            <strong>{healthText}</strong>
            <small>
              {health.status === "ok"
                ? `${health.migrationsApplied} migrations applied this run`
                : health.status === "error"
                  ? health.message
                  : "Waiting for /health"}
            </small>
          </div>
        </div>

        <div className="account-card">
          <span>
            <strong>{authUser.displayName}</strong>
            <small>{authUser.email}</small>
          </span>
          <button type="button" onClick={onLogout}>
            Log out
          </button>
        </div>
      </aside>

      <section className="workspace" aria-labelledby="workspace-title">
        <header className="topbar">
          <div>
            <p className="eyebrow">First milestone</p>
            <h2 id="workspace-title">Collection workspace</h2>
          </div>
          <div className="topbar-actions">
            <button className="icon-button" type="button" aria-label="Filter collection">
              <ListFilter size={20} aria-hidden="true" />
            </button>
            <button className="primary-button" type="button">
              <Plus size={18} aria-hidden="true" />
              Add card
            </button>
          </div>
        </header>

        <section className="command-panel" aria-label="Add cards">
          <div className="search-control">
            <Search size={20} aria-hidden="true" />
            <input
              aria-label="Search or add card"
              placeholder="Enter a card name, PSA cert, or set/card number like s10a 073/071"
            />
          </div>
          <div className="mode-actions">
            <button type="button">
              <Search size={18} aria-hidden="true" />
              Lookup
            </button>
            <button type="button">
              <ShieldCheck size={18} aria-hidden="true" />
              Cert
            </button>
            <button type="button">
              <Camera size={18} aria-hidden="true" />
              Scan
            </button>
          </div>
        </section>

        <section className="stats-grid" aria-label="Collection summary">
          {starterStats.map((stat) => {
            const Icon = stat.icon;
            return (
              <article className="stat-tile" key={stat.label}>
                <Icon size={20} aria-hidden="true" />
                <span>{stat.label}</span>
                <strong>{stat.value}</strong>
              </article>
            );
          })}
        </section>

        <section className="empty-state" id="collection">
          <div className="empty-visual" aria-hidden="true">
            <div className="card-stack card-stack-one" />
            <div className="card-stack card-stack-two" />
            <div className="card-stack card-stack-three" />
          </div>
          <div className="empty-copy">
            <p className="eyebrow">Ready for inventory</p>
            <h3>Your collection will live here.</h3>
            <p>
              The shell is wired for the next milestones: accounts, card lookup, graded
              cert import, comps, and scan drafts.
            </p>
          </div>
        </section>

        <section className="roadmap-panel" aria-label="Upcoming build milestones">
          {roadmapItems.map((item) => (
            <span key={item}>{item}</span>
          ))}
        </section>
      </section>
    </main>
  );
}

function LoadingScreen() {
  return (
    <main className="auth-layout">
      <section className="auth-panel">
        <p className="eyebrow">Collection Tool</p>
        <h1>Loading your vault</h1>
        <p>Checking the local API and account setup.</p>
      </section>
    </main>
  );
}

function AuthScreen({
  mode,
  onAuthenticated
}: {
  mode: "bootstrap" | "login";
  onAuthenticated: (auth: AuthMeResponse) => void;
}) {
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isBootstrap = mode === "bootstrap";

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);

    try {
      const nextAuth = isBootstrap
        ? await api.bootstrap({ displayName, email, password })
        : await api.login({ email, password });
      onAuthenticated(nextAuth);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unable to sign in.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="auth-layout">
      <section className="auth-panel">
        <div className="brand-lockup">
          <div className="brand-mark">
            <Gem size={22} aria-hidden="true" />
          </div>
          <div>
            <p className="eyebrow">Pokemon Vault</p>
            <h1>{isBootstrap ? "Create the first admin" : "Welcome back"}</h1>
          </div>
        </div>

        <form className="auth-form" onSubmit={handleSubmit}>
          {isBootstrap ? (
            <label>
              Display name
              <input
                autoComplete="name"
                minLength={2}
                onChange={(event) => setDisplayName(event.target.value)}
                required
                value={displayName}
              />
            </label>
          ) : null}
          <label>
            Email
            <input
              autoComplete="email"
              inputMode="email"
              onChange={(event) => setEmail(event.target.value)}
              required
              type="email"
              value={email}
            />
          </label>
          <label>
            Password
            <input
              autoComplete={isBootstrap ? "new-password" : "current-password"}
              minLength={isBootstrap ? 12 : undefined}
              onChange={(event) => setPassword(event.target.value)}
              required
              type="password"
              value={password}
            />
          </label>
          {error ? <p className="form-error">{error}</p> : null}
          <button className="primary-button" disabled={isSubmitting} type="submit">
            {isSubmitting ? "Working..." : isBootstrap ? "Create admin" : "Log in"}
          </button>
        </form>
      </section>
    </main>
  );
}

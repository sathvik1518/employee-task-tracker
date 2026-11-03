import { useCallback, useEffect, useState } from "react";
import Dashboard from "./components/Dashboard.jsx";
import Employees from "./components/Employees.jsx";
import Tasks from "./components/Tasks.jsx";
import { Icon } from "./components/ui.jsx";
import { remember } from "./utils.js";

const PAGES = [
  { id: "dashboard", label: "Dashboard", icon: "dashboard", subtitle: "How the team is doing right now" },
  { id: "employees", label: "Employees", icon: "users", subtitle: "Your team and what each person is working on" },
  { id: "tasks", label: "Tasks", icon: "tasks", subtitle: "Create, assign and move work forward" },
];

const pageFromHash = () => {
  const id = window.location.hash.replace("#/", "");
  return PAGES.some((p) => p.id === id) ? id : "dashboard";
};

export default function App() {
  const [page, setPage] = useState(pageFromHash);
  // A dashboard tile can open Tasks with a filter already applied: { status, overdue, employeeId, create }
  const [preset, setPreset] = useState({});
  const [theme, setTheme] = useState(() => document.documentElement.getAttribute("data-theme") || "light");

  useEffect(() => {
    const onHash = () => {
      setPage(pageFromHash());
      setPreset({});
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const go = useCallback((id, nextPreset = {}) => {
    setPreset(nextPreset);
    setPage(id);
    if (window.location.hash !== `#/${id}`) window.history.pushState(null, "", `#/${id}`);
    window.scrollTo({ top: 0 });
  }, []);

  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    remember("tt-theme", next);
  }

  const current = PAGES.find((p) => p.id === page);

  return (
    <div className="app">
      <aside className="rail">
        <a className="brand" href="#/dashboard" aria-label="Employee Task Tracker home">
          <span className="brand-mark">
            <Icon name="check" size={20} />
          </span>
          <span className="brand-text">
            <strong>Task Tracker</strong>
            <small>Team workspace</small>
          </span>
        </a>

        <nav className="nav" aria-label="Main">
          {PAGES.map((p) => (
            <a
              key={p.id}
              href={`#/${p.id}`}
              className={page === p.id ? "nav-item active" : "nav-item"}
              aria-current={page === p.id ? "page" : undefined}
              onClick={(e) => {
                e.preventDefault();
                go(p.id);
              }}
            >
              <Icon name={p.icon} size={20} />
              <span>{p.label}</span>
            </a>
          ))}
        </nav>

        <p className="rail-foot">React, FastAPI and PostgreSQL</p>
      </aside>

      <div className="main">
        <header className="topbar">
          <div>
            <h1>{current.label}</h1>
            <p>{current.subtitle}</p>
          </div>
          <button className="icon-btn icon-btn-big" onClick={toggleTheme} aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"} title="Switch theme">
            <Icon name={theme === "dark" ? "sun" : "moon"} />
          </button>
        </header>

        <main className="content">
          {/* key={...} resets a screen when a dashboard shortcut sends it new filters */}
          {page === "dashboard" && <Dashboard go={go} />}
          {page === "employees" && <Employees go={go} />}
          {page === "tasks" && <Tasks key={JSON.stringify(preset)} go={go} preset={preset} />}
        </main>
      </div>
    </div>
  );
}
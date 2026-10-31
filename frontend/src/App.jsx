import { useState } from "react";
import Dashboard from "./components/Dashboard.jsx";
import Employees from "./components/Employees.jsx";
import Tasks from "./components/Tasks.jsx";

const PAGES = ["Dashboard", "Employees", "Tasks"];

export default function App() {
  const [page, setPage] = useState("Dashboard");

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">Employee Task Tracker</span>
        <span className="topbar-sub">Manage your team and their tasks</span>
      </header>

      <div className="layout">
        <nav className="sidenav">
          {PAGES.map((name) => (
            <button key={name} className={page === name ? "nav-item active" : "nav-item"} onClick={() => setPage(name)}>
              {name}
            </button>
          ))}
        </nav>

        <main className="content">
          <h1>{page}</h1>
          {/* Each screen loads its own data from the API when it appears. */}
          {page === "Dashboard" && <Dashboard />}
          {page === "Employees" && <Employees />}
          {page === "Tasks" && <Tasks />}
        </main>
      </div>

      <footer className="footer">Employee Task Tracker · React, FastAPI and PostgreSQL</footer>
    </div>
  );
}
import { useState } from "react";
import Dashboard from "./components/Dashboard.jsx";
import Employees from "./components/Employees.jsx";
import Tasks from "./components/Tasks.jsx";

const TABS = ["Dashboard", "Employees", "Tasks"];

export default function App() {
  const [tab, setTab] = useState("Dashboard");

  return (
    <div className="container">
      <h1>Employee Task Tracker</h1>

      <nav className="tabs">
        {TABS.map((name) => (
          <button key={name} className={tab === name ? "tab active" : "tab"} onClick={() => setTab(name)}>
            {name}
          </button>
        ))}
      </nav>

      {/* Each screen loads its own data from the API when it appears. */}
      {tab === "Dashboard" && <Dashboard />}
      {tab === "Employees" && <Employees />}
      {tab === "Tasks" && <Tasks />}
    </div>
  );
}
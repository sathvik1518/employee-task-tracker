import { useEffect, useState } from "react";
import { getDashboard } from "../api.js";

export default function Dashboard() {
  const [stats, setStats] = useState(null);
  const [error, setError] = useState("");

  // useEffect with [] runs once, when the screen first appears.
  useEffect(() => {
    getDashboard().then(setStats).catch((e) => setError(e.message));
  }, []);

  if (error) return <p className="error">{error}</p>;
  if (!stats) return <p>Loading...</p>;

  const cards = [
    ["Total employees", stats.total_employees],
    ["Total tasks", stats.total_tasks],
    ["Completed tasks", stats.completed_tasks],
    ["Pending tasks", stats.pending_tasks],
    ["In progress", stats.in_progress_tasks],
  ];

  // Data for the chart: label, number of tasks, bar colour.
  const bars = [
    ["Pending", stats.pending_tasks, "#f59e0b"],
    ["In Progress", stats.in_progress_tasks, "#3b82f6"],
    ["Completed", stats.completed_tasks, "#16a34a"],
  ];
  const total = Math.max(stats.total_tasks, 1); // avoid dividing by zero

  return (
    <div>
      <div className="cards">
        {cards.map(([label, value]) => (
          <div className="card" key={label}>
            <div className="card-number">{value}</div>
            <div className="card-label">{label}</div>
          </div>
        ))}
      </div>

      <h2>Tasks by status</h2>
      <div className="chart">
        {bars.map(([label, value, color]) => (
          <div className="bar-row" key={label}>
            <span className="bar-label">{label}</span>
            <div className="bar-track">
              <div className="bar-fill" style={{ width: `${(value / total) * 100}%`, background: color }} />
            </div>
            <span className="bar-value">{value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
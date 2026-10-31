import { useEffect, useState } from "react";
import { getDashboard, getTasks } from "../api.js";

export default function Dashboard() {
  const [stats, setStats] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [error, setError] = useState("");

  // Load the dashboard numbers and the task list when the screen appears.
  useEffect(() => {
    Promise.all([getDashboard(), getTasks()])
      .then(([statsData, taskList]) => {
        setStats(statsData);
        setTasks(taskList);
      })
      .catch((e) => setError(e.message));
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

  // Graph data: how many tasks are due on each date, sorted by date.
  const counts = {};
  tasks.forEach((t) => {
    counts[t.due_date] = (counts[t.due_date] || 0) + 1;
  });
  const points = Object.keys(counts)
    .sort()
    .map((date) => ({ date, count: counts[date] }));

  // Size of the graph and the space around it.
  const W = 640;
  const H = 240;
  const PAD = 40;
  const maxCount = Math.max(...points.map((p) => p.count), 1);
  const x = (i) => (points.length === 1 ? W / 2 : PAD + (i * (W - 2 * PAD)) / (points.length - 1));
  const y = (count) => H - PAD - (count / maxCount) * (H - 2 * PAD);
  const linePoints = points.map((p, i) => `${x(i)},${y(p.count)}`).join(" ");

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

      <h2>Tasks due by date</h2>
      <div className="graph">
        {points.length === 0 ? (
          <p className="muted">No tasks yet. Create a task to see the graph.</p>
        ) : (
          <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Line graph of tasks due by date">
            {/* the two axes */}
            <line x1={PAD} y1={PAD / 2} x2={PAD} y2={H - PAD} stroke="#b6bdc7" />
            <line x1={PAD} y1={H - PAD} x2={W - PAD / 2} y2={H - PAD} stroke="#b6bdc7" />

            {/* the line */}
            {points.length > 1 && <polyline points={linePoints} fill="none" stroke="#1d4ed8" strokeWidth="3" />}

            {/* one dot, one count and one date label per point */}
            {points.map((p, i) => (
              <g key={p.date}>
                <circle cx={x(i)} cy={y(p.count)} r="5" fill="#1d4ed8" />
                <text x={x(i)} y={y(p.count) - 12} textAnchor="middle" fontSize="13" fontWeight="700" fill="#1f2933">
                  {p.count}
                </text>
                <text x={x(i)} y={H - PAD + 20} textAnchor="middle" fontSize="12" fill="#52606d">
                  {p.date.slice(5)}
                </text>
              </g>
            ))}
          </svg>
        )}
        <div className="graph-note">Number of tasks due on each date (month-day)</div>
      </div>
    </div>
  );
}
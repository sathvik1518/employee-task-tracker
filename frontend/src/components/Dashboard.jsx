import { useEffect, useState } from "react";
import { getDashboard, getTasks } from "../api.js";

// "2026-11-15" -> "15 Nov"
const shortDate = (iso) => new Date(iso + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" });

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

  // Graph size and the space left around it for labels.
  const W = 680, H = 280, L = 48, R = 24, T = 24, B = 44;
  const top = Math.max(...points.map((p) => p.count), 1);
  const step = Math.max(1, Math.ceil(top / 4)); // gap between grid lines
  const yMax = Math.ceil(top / step) * step;
  const ticks = [];
  for (let v = 0; v <= yMax; v += step) ticks.push(v);

  const base = H - B;
  const x = (i) => (points.length === 1 ? (L + W - R) / 2 : L + (i * (W - L - R)) / (points.length - 1));
  const y = (count) => base - (count / yMax) * (H - T - B);

  // A smooth curve through all the points.
  let curve = "";
  points.forEach((p, i) => {
    if (i === 0) {
      curve = `M ${x(0)} ${y(p.count)}`;
    } else {
      const mid = (x(i - 1) + x(i)) / 2;
      curve += ` C ${mid} ${y(points[i - 1].count)}, ${mid} ${y(p.count)}, ${x(i)} ${y(p.count)}`;
    }
  });
  const area = points.length > 1 ? `${curve} L ${x(points.length - 1)} ${base} L ${x(0)} ${base} Z` : "";
  const labelEvery = Math.ceil(points.length / 8); // avoid crowded date labels

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
            <defs>
              <linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#1d4ed8" stopOpacity="0.28" />
                <stop offset="100%" stopColor="#1d4ed8" stopOpacity="0.02" />
              </linearGradient>
            </defs>

            {/* grid lines with the numbers on the left */}
            {ticks.map((v) => (
              <g key={v}>
                <line x1={L} y1={y(v)} x2={W - R} y2={y(v)} stroke="#e5e9f0" strokeDasharray={v === 0 ? "0" : "4 4"} />
                <text x={L - 10} y={y(v) + 4} textAnchor="end" fontSize="12" fill="#66717d">
                  {v}
                </text>
              </g>
            ))}

            {/* soft area under the line, then the line itself */}
            {area && <path d={area} fill="url(#areaFill)" />}
            {points.length > 1 && <path d={curve} fill="none" stroke="#1d4ed8" strokeWidth="3" strokeLinecap="round" />}

            {/* dots, with a tooltip on hover, and the date labels */}
            {points.map((p, i) => (
              <g key={p.date}>
                <circle cx={x(i)} cy={y(p.count)} r="6" fill="#fff" stroke="#1d4ed8" strokeWidth="3">
                  <title>{`${p.count} ${p.count === 1 ? "task" : "tasks"} due on ${shortDate(p.date)}`}</title>
                </circle>
                {i % labelEvery === 0 && (
                  <text x={x(i)} y={base + 24} textAnchor="middle" fontSize="12" fill="#52606d">
                    {shortDate(p.date)}
                  </text>
                )}
              </g>
            ))}
          </svg>
        )}
        <div className="graph-note">Number of tasks due on each date. Hover a dot to see the details.</div>
      </div>
    </div>
  );
}
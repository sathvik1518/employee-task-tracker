import { useEffect, useState } from "react";
import { getDashboard } from "../api.js";

export default function Dashboard() {
  const [stats, setStats] = useState(null);
  const [error, setError] = useState("");

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

  return (
    <div className="cards">
      {cards.map(([label, value]) => (
        <div className="card" key={label}>
          <div className="card-number">{value}</div>
          <div className="card-label">{label}</div>
        </div>
      ))}
    </div>
  );
}
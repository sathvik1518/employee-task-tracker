import { useCallback, useEffect, useRef, useState } from "react";
import { getDashboard } from "../api.js";
import { addDays, daysBetween, dueInfo, formatDate, formatLongDate, plural } from "../utils.js";
import { Avatar, ErrorNotice, Icon, PriorityBadge, Skeleton } from "./ui.jsx";

export default function Dashboard({ go }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    getDashboard()
      .then((d) => {
        setData(d);
        setError("");
      })
      .catch((err) => setError(err.message));
  }, []);

  useEffect(load, [load]);

  if (error) return <ErrorNotice message={error} onRetry={load} />;
  if (!data) {
    return (
      <div className="stack">
        <Skeleton height={190} />
        <div className="tiles">
          <Skeleton height={96} count={5} />
        </div>
        <Skeleton height={300} />
      </div>
    );
  }

  const open = data.pending_tasks + data.in_progress_tasks;

  return (
    <div className="dash">
      <Briefing data={data} open={open} go={go} />

      <div className="tiles">
        <Tile label="Total employees" value={data.total_employees} icon="users" onClick={() => go("employees")} />
        <Tile label="Total tasks" value={data.total_tasks} icon="tasks" onClick={() => go("tasks")} />
        <Tile label="Completed" value={data.completed_tasks} tone="done" icon="check" onClick={() => go("tasks", { status: "Completed" })} />
        <Tile label="In progress" value={data.in_progress_tasks} tone="progress" icon="clock" onClick={() => go("tasks", { status: "In Progress" })} />
        <Tile label="Pending" value={data.pending_tasks} tone="pending" icon="flag" onClick={() => go("tasks", { status: "Pending" })} />
      </div>

      <div className="dash-grid">
        <section className="panel panel-wide">
          <header className="panel-head">
            <h2>Open tasks by due date</h2>
            <span className="panel-note">Past 3 days and next 2 weeks</span>
          </header>
          <DueChart data={data} />
        </section>

        <section className="panel">
          <header className="panel-head">
            <h2>Needs attention</h2>
            <span className="panel-note">Overdue or due within 3 days</span>
          </header>
          {data.attention.length === 0 ? (
            <p className="panel-empty">Nothing urgent. Enjoy the calm.</p>
          ) : (
            <ul className="attention">
              {data.attention.map((t) => {
                const due = dueInfo(t);
                return (
                  <li key={t.id}>
                    <Avatar id={t.employee_id} name={t.employee_name} size={32} />
                    <div className="attention-main">
                      <strong>{t.title}</strong>
                      <span>{t.employee_name}</span>
                    </div>
                    <div className="attention-side">
                      <span className={`due due-${due.tone}`}>{due.text}</span>
                      <PriorityBadge priority={t.priority} />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          {data.overdue_tasks > 0 && (
            <button className="btn btn-ghost btn-block" onClick={() => go("tasks", { overdue: true })}>
              View all {data.overdue_tasks} overdue
            </button>
          )}
        </section>

        <section className="panel panel-wide">
          <header className="panel-head">
            <h2>Workload by employee</h2>
            <Legend />
          </header>
          <Workload rows={data.workload} />
        </section>

        <section className="panel">
          <header className="panel-head">
            <h2>Open tasks by priority</h2>
          </header>
          <PriorityBars counts={data.by_priority} />
        </section>
      </div>
    </div>
  );
}

// ------------------------------------------------------------ top panel
function Briefing({ data, open, go }) {
  const overdue = data.overdue_tasks;
  let headline;
  let detail;
  if (data.total_tasks === 0) {
    headline = "No tasks yet.";
    detail = "Add an employee, then create the first task.";
  } else if (overdue > 0) {
    headline = `${plural(overdue, "task")} ${overdue === 1 ? "is" : "are"} overdue.`;
    detail = `${plural(open, "task")} still open, ${data.due_this_week} due in the next 7 days.`;
  } else if (open === 0) {
    headline = "Everything is done.";
    detail = `All ${plural(data.total_tasks, "task")} completed. Time to plan the next round.`;
  } else {
    headline = "Nothing is overdue.";
    detail = `${plural(open, "task")} open, ${data.due_this_week} due in the next 7 days.`;
  }

  return (
    <section className={overdue > 0 ? "briefing briefing-late" : "briefing"}>
      <div className="briefing-text">
        <p className="briefing-date">{formatLongDate(data.today)}</p>
        <h2>{headline}</h2>
        <p>{detail}</p>
        <div className="briefing-actions">
          {overdue > 0 && (
            <button className="btn btn-primary" onClick={() => go("tasks", { overdue: true })}>
              Review overdue
            </button>
          )}
          <button className={overdue > 0 ? "btn" : "btn btn-primary"} onClick={() => go("tasks", { create: true })}>
            <Icon name="plus" size={18} /> New task
          </button>
        </div>
      </div>
      <Ring data={data} />
    </section>
  );
}

function Ring({ data }) {
  const total = data.total_tasks;
  const R = 56;
  const C = 2 * Math.PI * R;
  const parts = [
    { label: "Completed", value: data.completed_tasks, color: "var(--done)" },
    { label: "In progress", value: data.in_progress_tasks, color: "var(--progress)" },
    { label: "Pending", value: data.pending_tasks, color: "var(--pending)" },
  ];
  let offset = 0;

  return (
    <figure className="ring" aria-label={`${data.completion_rate}% of tasks completed`}>
      <svg viewBox="0 0 140 140" role="img">
        <circle cx="70" cy="70" r={R} fill="none" stroke="var(--track)" strokeWidth="14" />
        {total > 0 &&
          parts.map((p) => {
            const len = (p.value / total) * C;
            const el = (
              <circle
                key={p.label}
                cx="70"
                cy="70"
                r={R}
                fill="none"
                stroke={p.color}
                strokeWidth="14"
                strokeDasharray={`${Math.max(len - 2, 0)} ${C}`}
                strokeDashoffset={-offset}
                transform="rotate(-90 70 70)"
              >
                <title>{`${p.label}: ${p.value}`}</title>
              </circle>
            );
            offset += len;
            return el;
          })}
        <text x="70" y="68" textAnchor="middle" className="ring-value">
          {data.completion_rate}%
        </text>
        <text x="70" y="88" textAnchor="middle" className="ring-label">
          complete
        </text>
      </svg>
    </figure>
  );
}

function Tile({ label, value, icon, tone = "brand", onClick }) {
  return (
    <button className={`tile tile-${tone}`} onClick={onClick}>
      <span className="tile-icon">
        <Icon name={icon} size={20} />
      </span>
      <span className="tile-value">{value}</span>
      <span className="tile-label">{label}</span>
    </button>
  );
}

// ------------------------------------------------------------ line chart
// Smooth line that never overshoots between points.
function smoothPath(points) {
  return points.reduce((d, p, i) => {
    if (i === 0) return `M${p.x},${p.y}`;
    const prev = points[i - 1];
    const mid = (prev.x + p.x) / 2;
    return `${d} C${mid},${prev.y} ${mid},${p.y} ${p.x},${p.y}`;
  }, "");
}

function DueChart({ data }) {
  const [hover, setHover] = useState(null);
  // The chart is drawn at the real width of its box, so it stays sharp and never gets too tall on wide screens.
  const box = useRef(null);
  const [W, setW] = useState(720);
  useEffect(() => {
    const el = box.current;
    if (!el) return undefined;
    const update = () => setW(Math.max(320, Math.round(el.clientWidth)));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const counts = Object.fromEntries(data.due_by_date.map((r) => [String(r.date).slice(0, 10), r.count]));

  // One point per day, so days with no tasks show as zero instead of disappearing.
  const FROM = -3;
  const TO = 14;
  const days = Array.from({ length: TO - FROM + 1 }, (_, i) => {
    const date = addDays(data.today, FROM + i);
    return { date, count: counts[date] || 0, isToday: FROM + i === 0 };
  });
  const outside = data.due_by_date
    .filter((r) => {
      const diff = daysBetween(data.today, String(r.date).slice(0, 10));
      return diff < FROM || diff > TO;
    })
    .reduce((sum, r) => sum + r.count, 0);

  const H = W < 520 ? 250 : 320;
  const L = 40;
  const R = 16;
  const T = 18;
  const B = 36;
  const max = Math.max(...days.map((d) => d.count), 1);
  const step = Math.ceil(max / 4);
  const top = step * 4; // the scale grows with the data, so a busy week never runs off the chart
  const x = (i) => L + (i * (W - L - R)) / (days.length - 1);
  const y = (v) => T + (1 - v / top) * (H - T - B);
  const points = days.map((d, i) => ({ x: x(i), y: y(d.count) }));
  const line = smoothPath(points);
  const area = `${line} L${x(days.length - 1)},${y(0)} L${x(0)},${y(0)} Z`;
  const todayIndex = days.findIndex((d) => d.isToday);
  const active = hover === null ? null : days[hover];

  return (
    <div className="chart" ref={box}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Line chart of open tasks due each day">
        <defs>
          <linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--brand)" stopOpacity="0.28" />
            <stop offset="100%" stopColor="var(--brand)" stopOpacity="0" />
          </linearGradient>
        </defs>

        {[0, 1, 2, 3, 4].map((i) => (
          <g key={i}>
            <line x1={L} x2={W - R} y1={y(i * step)} y2={y(i * step)} className="grid-line" />
            <text x={L - 10} y={y(i * step) + 4} textAnchor="end" className="axis">
              {i * step}
            </text>
          </g>
        ))}

        <line x1={x(todayIndex)} x2={x(todayIndex)} y1={T} y2={H - B} className="today-line" />
        <path d={area} fill="url(#areaFill)" />
        <path d={line} fill="none" stroke="var(--brand)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />

        {days.map((d, i) =>
          d.count > 0 ? <circle key={d.date} cx={x(i)} cy={y(d.count)} r={hover === i ? 6 : 4.5} className="dot" /> : null
        )}

        {days.map((d, i) =>
          i % 3 === 0 || d.isToday ? (
            <text key={d.date} x={x(i)} y={H - 12} textAnchor="middle" className={d.isToday ? "axis axis-today" : "axis"}>
              {d.isToday ? "Today" : formatDate(d.date).replace(/ \d{4}$/, "")}
            </text>
          ) : null
        )}

        {active && (
          <g pointerEvents="none">
            <rect x={Math.min(Math.max(x(hover) - 58, L), W - R - 116)} y={Math.max(y(active.count) - 52, 2)} width="116" height="40" rx="8" className="tip" />
            <text x={Math.min(Math.max(x(hover), L + 58), W - R - 58)} y={Math.max(y(active.count) - 34, 20)} textAnchor="middle" className="tip-title">
              {formatDate(active.date)}
            </text>
            <text x={Math.min(Math.max(x(hover), L + 58), W - R - 58)} y={Math.max(y(active.count) - 19, 35)} textAnchor="middle" className="tip-text">
              {plural(active.count, "open task")}
            </text>
          </g>
        )}

        {days.map((d, i) => (
          <rect
            key={d.date}
            x={x(i) - (W - L - R) / (days.length - 1) / 2}
            y={T}
            width={(W - L - R) / (days.length - 1)}
            height={H - T - B}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          />
        ))}
      </svg>
      <p className="chart-note">
        Each point is the number of open tasks due that day. Hover a day for details.
        {outside > 0 && ` ${plural(outside, "other open task")} fall outside this range.`}
      </p>
    </div>
  );
}

// ------------------------------------------------------------ bars
function Legend() {
  return (
    <span className="legend">
      <span className="legend-item done">Completed</span>
      <span className="legend-item progress">In progress</span>
      <span className="legend-item pending">Pending</span>
    </span>
  );
}

function Workload({ rows }) {
  if (rows.length === 0) return <p className="panel-empty">Add employees and assign tasks to see who is carrying what.</p>;
  const most = Math.max(...rows.map((r) => r.pending + r.in_progress + r.completed), 1);
  return (
    <ul className="workload">
      {rows.map((r) => {
        const total = r.pending + r.in_progress + r.completed;
        return (
          <li key={r.id}>
            <span className="workload-name">
              <Avatar id={r.id} name={r.name} size={26} />
              {r.name}
            </span>
            <span className="bar" role="img" aria-label={`${r.name}: ${r.completed} completed, ${r.in_progress} in progress, ${r.pending} pending`}>
              <span className="seg-done" style={{ width: `${(r.completed / most) * 100}%` }} />
              <span className="seg-progress" style={{ width: `${(r.in_progress / most) * 100}%` }} />
              <span className="seg-pending" style={{ width: `${(r.pending / most) * 100}%` }} />
            </span>
            <span className="workload-total">{total}</span>
          </li>
        );
      })}
    </ul>
  );
}

function PriorityBars({ counts }) {
  const rows = ["High", "Medium", "Low"].map((p) => ({ p, n: counts[p] || 0 }));
  const most = Math.max(...rows.map((r) => r.n), 1);
  if (rows.every((r) => r.n === 0)) return <p className="panel-empty">No open tasks.</p>;
  return (
    <ul className="priority-bars">
      {rows.map(({ p, n }) => (
        <li key={p}>
          <PriorityBadge priority={p} />
          <span className="bar">
            <span className={`fill fill-${p.toLowerCase()}`} style={{ width: `${(n / most) * 100}%` }} />
          </span>
          <span className="workload-total">{n}</span>
        </li>
      ))}
    </ul>
  );
}
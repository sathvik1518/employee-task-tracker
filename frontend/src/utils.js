// Small helpers shared by every screen.

export const STATUSES = ["Pending", "In Progress", "Completed"];
export const PRIORITIES = ["Low", "Medium", "High"];

// "In Progress" -> "progress" (used for CSS class names)
export const statusKey = (status) => ({ Pending: "pending", "In Progress": "progress", Completed: "done" }[status] || "pending");

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// "2026-11-03" -> a Date at local noon (avoids time-zone off-by-one bugs).
export function parseDate(iso) {
  const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d, 12);
}

export function toISO(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export const todayISO = () => toISO(new Date());

export function addDays(iso, days) {
  const d = parseDate(iso);
  d.setDate(d.getDate() + days);
  return toISO(d);
}

export function daysBetween(fromISO, toISOstr) {
  return Math.round((parseDate(toISOstr) - parseDate(fromISO)) / 86400000);
}

export function formatDate(iso, withYear = false) {
  const d = parseDate(iso);
  const base = `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  return withYear || d.getFullYear() !== new Date().getFullYear() ? `${base} ${d.getFullYear()}` : base;
}

export function formatLongDate(iso) {
  return parseDate(iso).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
}

// What to print next to a due date, and how loudly.
export function dueInfo(task) {
  const due = String(task.due_date).slice(0, 10);
  if (task.status === "Completed") return { text: formatDate(due), tone: "calm" };
  const diff = daysBetween(todayISO(), due);
  if (task.is_overdue || diff < 0) {
    const n = Math.abs(diff) || 1;
    return { text: `${n} day${n === 1 ? "" : "s"} overdue`, tone: "late" };
  }
  if (diff === 0) return { text: "Due today", tone: "soon" };
  if (diff === 1) return { text: "Due tomorrow", tone: "soon" };
  if (diff <= 7) return { text: `Due in ${diff} days`, tone: "soon" };
  return { text: formatDate(due), tone: "calm" };
}

export function initials(name = "") {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

// Every person gets a steady colour, based on their id.
export const avatarHue = (id) => (Number(id) * 47 + 215) % 360;

export function plural(n, word, pluralWord) {
  return `${n} ${n === 1 ? word : pluralWord || word + "s"}`;
}

export function downloadCSV(filename, rows) {
  const escape = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const text = rows.map((r) => r.map(escape).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// localStorage can be blocked (private windows), so every use is wrapped.
export function remember(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}
export function recall(key, fallback) {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}
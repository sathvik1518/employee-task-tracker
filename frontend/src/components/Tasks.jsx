import { useCallback, useEffect, useRef, useState } from "react";
import { addTask, deleteTask, getEmployees, getTasks, updateTaskStatus } from "../api.js";
import { PRIORITIES, STATUSES, downloadCSV, dueInfo, plural, recall, remember, statusKey, todayISO } from "../utils.js";
import TaskForm from "./TaskForm.jsx";
import { useToast } from "./Toast.jsx";
import { Avatar, EmptyState, ErrorNotice, Icon, PriorityBadge, Skeleton } from "./ui.jsx";

const PRIORITY_ORDER = { High: 0, Medium: 1, Low: 2 };
const SORTS = {
  due: { label: "Due date", fn: (a, b) => String(a.due_date).localeCompare(String(b.due_date)) || a.id - b.id },
  priority: { label: "Priority", fn: (a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] || String(a.due_date).localeCompare(String(b.due_date)) },
  employee: { label: "Employee", fn: (a, b) => a.employee_name.localeCompare(b.employee_name) },
  title: { label: "Title", fn: (a, b) => a.title.localeCompare(b.title) },
};

export default function Tasks({ go, preset = {} }) {
  const toast = useToast();
  // Coming from a dashboard tile with a status picked? Start in the list so that filter is visible.
  const [view, setView] = useState(() => (preset.status ? "list" : recall("tt-view", "board")));
  const [filters, setFilters] = useState({
    search: "",
    status: preset.status || "",
    priority: "",
    employeeId: preset.employeeId || "",
    overdue: Boolean(preset.overdue),
  });
  const [sort, setSort] = useState("due");
  const [tasks, setTasks] = useState(null); // null = still loading
  const [employees, setEmployees] = useState(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(preset.create ? "new" : null); // null | "new" | task
  const requestNo = useRef(0);

  const setFilter = (key, value) => setFilters((f) => ({ ...f, [key]: value }));
  const filtering = Boolean(filters.search || filters.priority || filters.employeeId || filters.overdue || (view === "list" && filters.status));

  const changeView = (next) => {
    setView(next);
    remember("tt-view", next);
  };

  useEffect(() => {
    getEmployees().then(setEmployees).catch((err) => setError(err.message));
  }, []);

  // Search and filters run in the database (see GET /tasks). The board always shows every status.
  const load = useCallback(async () => {
    const mine = ++requestNo.current;
    try {
      const rows = await getTasks({
        search: filters.search,
        status: view === "list" ? filters.status : "",
        priority: filters.priority,
        employee_id: filters.employeeId,
        overdue: filters.overdue,
      });
      if (mine !== requestNo.current) return; // an older request finished late: ignore it
      setTasks(rows);
      setError("");
    } catch (err) {
      if (mine === requestNo.current) setError(err.message);
    }
  }, [filters, view]);

  useEffect(() => {
    const timer = setTimeout(load, filters.search ? 250 : 0); // wait for the person to stop typing
    return () => clearTimeout(timer);
  }, [load, filters.search]);

  // Optimistic update: the screen changes at once, and goes back if the server says no.
  async function changeStatus(task, status) {
    if (task.status === status) return;
    setTasks((list) => list.map((t) => (t.id === task.id ? { ...t, status } : t)));
    try {
      const saved = await updateTaskStatus(task.id, status);
      setTasks((list) => list.map((t) => (t.id === task.id ? saved : t)));
      toast(`"${task.title}" moved to ${status}`);
    } catch (err) {
      setTasks((list) => list.map((t) => (t.id === task.id ? task : t)));
      toast(`Could not move the task. ${err.message}`, { tone: "error" });
    }
  }

  async function removeTask(task) {
    setTasks((list) => list.filter((t) => t.id !== task.id));
    try {
      await deleteTask(task.id);
      toast(`"${task.title}" deleted`, {
        action: {
          label: "Undo",
          onClick: async () => {
            try {
              await addTask({
                title: task.title,
                description: task.description,
                priority: task.priority,
                status: task.status,
                due_date: String(task.due_date).slice(0, 10),
                employee_id: task.employee_id,
              });
              toast("Task restored");
              load();
            } catch (err) {
              toast(err.message, { tone: "error" });
            }
          },
        },
      });
    } catch (err) {
      toast(err.message, { tone: "error" });
      load();
    }
  }

  function exportCSV() {
    downloadCSV(`tasks-${todayISO()}.csv`, [
      ["ID", "Title", "Description", "Employee", "Department", "Priority", "Status", "Due date", "Overdue"],
      ...tasks.map((t) => [t.id, t.title, t.description, t.employee_name, t.employee_department, t.priority, t.status, String(t.due_date).slice(0, 10), t.is_overdue ? "Yes" : "No"]),
    ]);
  }

  const noEmployees = employees && employees.length === 0;
  const sorted = tasks ? [...tasks].sort(SORTS[sort].fn) : null;

  return (
    <section>
      <div className="toolbar">
        <div className="search">
          <Icon name="search" size={18} />
          <input
            value={filters.search}
            onChange={(e) => setFilter("search", e.target.value)}
            placeholder="Search tasks or employees"
            aria-label="Search tasks"
          />
        </div>
        <select value={filters.employeeId} onChange={(e) => setFilter("employeeId", e.target.value)} aria-label="Filter by employee">
          <option value="">All employees</option>
          {(employees || []).map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
        <select value={filters.priority} onChange={(e) => setFilter("priority", e.target.value)} aria-label="Filter by priority">
          <option value="">Any priority</option>
          {PRIORITIES.map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
        <button
          className={filters.overdue ? "chip-btn active late" : "chip-btn"}
          aria-pressed={filters.overdue}
          onClick={() => setFilter("overdue", !filters.overdue)}
        >
          <Icon name="alert" size={16} /> Overdue
        </button>
        {filtering && (
          <button className="btn btn-ghost btn-small" onClick={() => setFilters({ search: "", status: "", priority: "", employeeId: "", overdue: false })}>
            Clear filters
          </button>
        )}
        <span className="toolbar-spacer" />
        <div className="segmented segmented-icons" role="group" aria-label="View">
          <button className={view === "board" ? "seg active" : "seg"} onClick={() => changeView("board")} aria-pressed={view === "board"}>
            <Icon name="board" size={18} /> Board
          </button>
          <button className={view === "list" ? "seg active" : "seg"} onClick={() => changeView("list")} aria-pressed={view === "list"}>
            <Icon name="list" size={18} /> List
          </button>
        </div>
        <button className="btn btn-icon" onClick={exportCSV} disabled={!tasks || tasks.length === 0} title="Export the tasks on screen as a CSV file" aria-label="Export tasks as CSV">
          <Icon name="download" size={18} />
        </button>
        <button className="btn btn-primary" onClick={() => setEditing("new")} disabled={noEmployees}>
          <Icon name="plus" size={18} /> New task
        </button>
      </div>

      {view === "list" && (
        <div className="toolbar toolbar-sub">
          <div className="chips" role="group" aria-label="Filter by status">
            {["", ...STATUSES].map((s) => (
              <button key={s || "all"} className={filters.status === s ? "chip-btn active" : "chip-btn"} aria-pressed={filters.status === s} onClick={() => setFilter("status", s)}>
                {s || "All statuses"}
              </button>
            ))}
          </div>
          <span className="toolbar-spacer" />
          <label className="sort">
            Sort by
            <select value={sort} onChange={(e) => setSort(e.target.value)}>
              {Object.entries(SORTS).map(([key, s]) => (
                <option key={key} value={key}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      {error && <ErrorNotice message={error} onRetry={load} />}

      {noEmployees && (
        <EmptyState
          title="Add an employee first"
          text="Every task is assigned to someone, so the team needs at least one person."
          action={
            <button className="btn btn-primary" onClick={() => go("employees")}>
              <Icon name="users" size={18} /> Go to employees
            </button>
          }
        />
      )}

      {!noEmployees && sorted === null && !error && (
        <div className={view === "board" ? "board" : "stack"}>
          <Skeleton height={view === "board" ? 320 : 64} count={view === "board" ? 3 : 6} />
        </div>
      )}

      {!noEmployees && sorted && sorted.length === 0 && (
        <EmptyState
          title={filtering ? "No tasks match those filters" : "No tasks yet"}
          text={filtering ? "Try fewer filters, or clear them to see everything." : "Create a task and assign it to someone on the team."}
          action={
            !filtering && (
              <button className="btn btn-primary" onClick={() => setEditing("new")}>
                <Icon name="plus" size={18} /> New task
              </button>
            )
          }
        />
      )}

      {!noEmployees && sorted && sorted.length > 0 && (
        <>
          <p className="result-count">{plural(sorted.length, "task")}</p>
          {view === "board" ? (
            <Board tasks={sorted} onMove={changeStatus} onEdit={setEditing} onDelete={removeTask} />
          ) : (
            <TaskTable tasks={sorted} onMove={changeStatus} onEdit={setEditing} onDelete={removeTask} />
          )}
        </>
      )}

      {editing && employees && (
        <TaskForm
          task={editing === "new" ? null : editing}
          employees={employees}
          defaultEmployeeId={filters.employeeId}
          onClose={() => setEditing(null)}
          onSaved={(saved, wasEdit) => {
            toast(wasEdit ? "Task updated" : "Task created");
            setEditing(null);
            load();
          }}
        />
      )}
    </section>
  );
}

function DueLabel({ task }) {
  const due = dueInfo(task);
  return (
    <span className={`due due-${due.tone}`}>
      <Icon name={due.tone === "late" ? "alert" : "calendar"} size={15} />
      {due.text}
    </span>
  );
}

function StatusSelect({ task, onMove }) {
  return (
    <select className={`status-select st-${statusKey(task.status)}`} value={task.status} onChange={(e) => onMove(task, e.target.value)} aria-label={`Status of ${task.title}`}>
      {STATUSES.map((s) => (
        <option key={s}>{s}</option>
      ))}
    </select>
  );
}

// ---------------------------------------------------------------- board
function Board({ tasks, onMove, onEdit, onDelete }) {
  const [overColumn, setOverColumn] = useState(null);
  const [dragging, setDragging] = useState(null);

  return (
    <div className="board">
      {STATUSES.map((status) => {
        const items = tasks.filter((t) => t.status === status);
        return (
          <div
            key={status}
            className={`column col-${statusKey(status)}${overColumn === status ? " drop" : ""}`}
            onDragOver={(e) => {
              e.preventDefault();
              setOverColumn(status);
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget)) setOverColumn(null);
            }}
            onDrop={(e) => {
              e.preventDefault();
              setOverColumn(null);
              const task = tasks.find((t) => t.id === Number(e.dataTransfer.getData("text/plain")));
              if (task) onMove(task, status);
            }}
          >
            <header className="column-head">
              <span className="column-dot" />
              <h3>{status}</h3>
              <span className="count">{items.length}</span>
            </header>
            <div className="column-body">
              {items.map((t) => (
                <article
                  key={t.id}
                  className={`card${dragging === t.id ? " dragging" : ""}${t.is_overdue ? " card-late" : ""}`}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData("text/plain", String(t.id));
                    e.dataTransfer.effectAllowed = "move";
                    setDragging(t.id);
                  }}
                  onDragEnd={() => {
                    setDragging(null);
                    setOverColumn(null);
                  }}
                >
                  <div className="card-top">
                    <PriorityBadge priority={t.priority} />
                    <DueLabel task={t} />
                  </div>
                  <h4>{t.title}</h4>
                  {t.description && <p className="card-text">{t.description}</p>}
                  <footer>
                    <span className="assignee" title={`${t.employee_name}, ${t.employee_department}`}>
                      <Avatar id={t.employee_id} name={t.employee_name} size={26} />
                      {t.employee_name.split(" ")[0]}
                    </span>
                    <span className="row-actions">
                      <button className="icon-btn" aria-label={`Edit ${t.title}`} onClick={() => onEdit(t)}>
                        <Icon name="edit" size={17} />
                      </button>
                      <button className="icon-btn icon-btn-danger" aria-label={`Delete ${t.title}`} onClick={() => onDelete(t)}>
                        <Icon name="trash" size={17} />
                      </button>
                    </span>
                  </footer>
                  <label className="move">
                    <span>Move to</span>
                    <StatusSelect task={t} onMove={onMove} />
                  </label>
                </article>
              ))}
              {items.length === 0 && <p className="column-empty">{overColumn === status ? "Drop to move here" : "Nothing here. Drag a task in."}</p>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------- list
function TaskTable({ tasks, onMove, onEdit, onDelete }) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Task</th>
            <th>Assigned to</th>
            <th>Priority</th>
            <th>Due</th>
            <th>Status</th>
            <th aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {tasks.map((t) => (
            <tr key={t.id} className={t.is_overdue ? "row-late" : ""}>
              <td data-label="Task">
                <strong className="task-title">{t.title}</strong>
                {t.description && <span className="task-desc">{t.description}</span>}
              </td>
              <td data-label="Assigned to">
                <span className="assignee">
                  <Avatar id={t.employee_id} name={t.employee_name} size={28} />
                  {t.employee_name}
                </span>
              </td>
              <td data-label="Priority">
                <PriorityBadge priority={t.priority} />
              </td>
              <td data-label="Due">
                <DueLabel task={t} />
              </td>
              <td data-label="Status">
                <StatusSelect task={t} onMove={onMove} />
              </td>
              <td className="actions-cell">
                <span className="row-actions">
                  <button className="icon-btn" aria-label={`Edit ${t.title}`} onClick={() => onEdit(t)}>
                    <Icon name="edit" size={18} />
                  </button>
                  <button className="icon-btn icon-btn-danger" aria-label={`Delete ${t.title}`} onClick={() => onDelete(t)}>
                    <Icon name="trash" size={18} />
                  </button>
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
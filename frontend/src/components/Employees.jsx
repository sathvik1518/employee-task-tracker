import { useCallback, useEffect, useRef, useState } from "react";
import { deleteEmployee, getEmployees } from "../api.js";
import { plural } from "../utils.js";
import EmployeeForm from "./EmployeeForm.jsx";
import { useToast } from "./Toast.jsx";
import { Avatar, ConfirmDialog, EmptyState, ErrorNotice, Icon, Skeleton } from "./ui.jsx";

export default function Employees({ go }) {
  const toast = useToast();
  const [employees, setEmployees] = useState(null); // null = still loading
  const [allDepartments, setAllDepartments] = useState([]);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [department, setDepartment] = useState("");
  const [editing, setEditing] = useState(null); // null | "new" | employee
  const [removing, setRemoving] = useState(null);
  const [busy, setBusy] = useState(false);
  const requestNo = useRef(0);

  // Search and department filter run in the database (see GET /employees).
  const load = useCallback(async () => {
    const mine = ++requestNo.current;
    try {
      const rows = await getEmployees({ search, department });
      if (mine !== requestNo.current) return; // an older request finished late: ignore it
      setEmployees(rows);
      setError("");
      if (!search && !department) setAllDepartments([...new Set(rows.map((r) => r.department))].sort());
    } catch (err) {
      if (mine === requestNo.current) setError(err.message);
    }
  }, [search, department]);

  useEffect(() => {
    const timer = setTimeout(load, search ? 250 : 0); // wait for the person to stop typing
    return () => clearTimeout(timer);
  }, [load, search]);

  // The department list must not shrink while filtering, so load it once without filters.
  useEffect(() => {
    getEmployees().then((rows) => setAllDepartments([...new Set(rows.map((r) => r.department))].sort())).catch(() => {});
  }, []);

  async function confirmDelete() {
    setBusy(true);
    try {
      await deleteEmployee(removing.id);
      toast(`${removing.name} deleted${removing.task_count ? ` along with ${plural(removing.task_count, "task")}` : ""}`);
      setRemoving(null);
      load();
    } catch (err) {
      toast(err.message, { tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  const filtering = Boolean(search || department);

  return (
    <section>
      <div className="toolbar">
        <div className="search">
          <Icon name="search" size={18} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name or email" aria-label="Search employees" />
        </div>
        <select value={department} onChange={(e) => setDepartment(e.target.value)} aria-label="Filter by department">
          <option value="">All departments</option>
          {allDepartments.map((d) => (
            <option key={d}>{d}</option>
          ))}
        </select>
        <span className="toolbar-spacer" />
        <button className="btn btn-primary" onClick={() => setEditing("new")}>
          <Icon name="plus" size={18} /> Add employee
        </button>
      </div>

      {error && <ErrorNotice message={error} onRetry={load} />}

      {employees === null && !error && (
        <div className="people-grid">
          <Skeleton height={190} count={6} />
        </div>
      )}

      {employees && employees.length === 0 && (
        <EmptyState
          title={filtering ? "No one matches those filters" : "No employees yet"}
          text={filtering ? "Try a different name or clear the department filter." : "Add your first employee, then give them tasks."}
          action={
            !filtering && (
              <button className="btn btn-primary" onClick={() => setEditing("new")}>
                <Icon name="plus" size={18} /> Add employee
              </button>
            )
          }
        />
      )}

      {employees && employees.length > 0 && (
        <>
          <p className="result-count">{plural(employees.length, "employee")}</p>
          <div className="people-grid">
            {employees.map((e) => (
              <article key={e.id} className="person">
                <header>
                  <Avatar id={e.id} name={e.name} size={46} />
                  <div className="person-id">
                    <h3>{e.name}</h3>
                    <span className="chip">{e.department}</span>
                  </div>
                  <div className="row-actions">
                    <button className="icon-btn" aria-label={`Edit ${e.name}`} onClick={() => setEditing(e)}>
                      <Icon name="edit" size={18} />
                    </button>
                    <button className="icon-btn icon-btn-danger" aria-label={`Delete ${e.name}`} onClick={() => setRemoving(e)}>
                      <Icon name="trash" size={18} />
                    </button>
                  </div>
                </header>

                <a className="person-mail" href={`mailto:${e.email}`}>
                  <Icon name="mail" size={16} /> {e.email}
                </a>

                <dl className="person-stats">
                  <div>
                    <dt>Open</dt>
                    <dd>{e.open_tasks}</dd>
                  </div>
                  <div>
                    <dt>Done</dt>
                    <dd>{e.completed_tasks}</dd>
                  </div>
                  <div className={e.overdue_tasks ? "late" : ""}>
                    <dt>Overdue</dt>
                    <dd>{e.overdue_tasks}</dd>
                  </div>
                </dl>

                <button className="btn btn-ghost" onClick={() => go("tasks", { employeeId: String(e.id) })}>
                  View {e.task_count ? plural(e.task_count, "task") : "tasks"}
                </button>
              </article>
            ))}
          </div>
        </>
      )}

      {editing && (
        <EmployeeForm
          employee={editing === "new" ? null : editing}
          departments={allDepartments}
          onClose={() => setEditing(null)}
          onSaved={(saved, wasEdit) => {
            toast(wasEdit ? `${saved.name} updated` : `${saved.name} added`);
            setEditing(null);
            load();
            getEmployees().then((rows) => setAllDepartments([...new Set(rows.map((r) => r.department))].sort())).catch(() => {});
          }}
        />
      )}

      {removing && (
        <ConfirmDialog title={`Delete ${removing.name}?`} busy={busy} onConfirm={confirmDelete} onClose={() => setRemoving(null)}>
          <p>
            This removes {removing.name} from the team
            {removing.task_count > 0 && (
              <>
                {" "}
                and permanently deletes their <strong>{plural(removing.task_count, "task")}</strong>
              </>
            )}
            . You can't undo this.
          </p>
        </ConfirmDialog>
      )}
    </section>
  );
}
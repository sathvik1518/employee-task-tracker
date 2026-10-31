import { useEffect, useState } from "react";
import { addTask, getEmployees, getTasks, updateTaskStatus } from "../api.js";

const STATUSES = ["Pending", "In Progress", "Completed"];
const EMPTY = { title: "", description: "", priority: "Medium", due_date: "", employee_id: "" };

export default function Tasks() {
  const [tasks, setTasks] = useState([]);
  const [employees, setEmployees] = useState([]); 
  const [form, setForm] = useState(EMPTY);
  const [statusFilter, setStatusFilter] = useState("All"); 
  const [search, setSearch] = useState("");                
  const [error, setError] = useState("");

  async function load() {
    try {
      const [taskList, employeeList] = await Promise.all([getTasks(), getEmployees()]);
      setTasks(taskList);
      setEmployees(employeeList);
    } catch (e) {
      setError(e.message);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function handleChange(event) {
    setForm({ ...form, [event.target.name]: event.target.value });
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    try {
      await addTask({ ...form, employee_id: Number(form.employee_id) }); 
      setForm(EMPTY);
      load();
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleStatusChange(taskId, status) {
    setError("");
    try {
      await updateTaskStatus(taskId, status); 
      load();
    } catch (e) {
      setError(e.message);
    }
  }

  
  const visible = tasks.filter(
    (t) =>
      (statusFilter === "All" || t.status === statusFilter) &&
      t.employee_name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div>
      <h2>Create task</h2>
      {employees.length === 0 ? (
        <p className="muted">Add an employee first (Employees tab), then you can assign tasks.</p>
      ) : (
        <form className="form" onSubmit={handleSubmit}>
          <input name="title" placeholder="Title" value={form.title} onChange={handleChange} required />
          <textarea name="description" placeholder="Description" value={form.description} onChange={handleChange} rows={2} />
          <select name="priority" value={form.priority} onChange={handleChange}>
            <option>Low</option>
            <option>Medium</option>
            <option>High</option>
          </select>
          <input name="due_date" type="date" value={form.due_date} onChange={handleChange} required />
          <select name="employee_id" value={form.employee_id} onChange={handleChange} required>
            <option value="">Assign to...</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
          <button type="submit">Create task</button>
        </form>
      )}
      {error && <p className="error">{error}</p>}

      <h2>Tasks ({visible.length})</h2>
      <div className="toolbar">
        <input placeholder="Search by employee name" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Filter by status">
          <option>All</option>
          {STATUSES.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </div>

      {visible.length === 0 ? (
        <p className="muted">{tasks.length === 0 ? "No tasks yet." : "No tasks match your search or filter."}</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Title</th>
              <th>Priority</th>
              <th>Due date</th>
              <th>Assigned to</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((t) => (
              <tr key={t.id}>
                <td>
                  {t.title}
                  {t.description && <div className="muted small">{t.description}</div>}
                </td>
                <td>
                  <span className={`badge ${t.priority.toLowerCase()}`}>{t.priority}</span>
                </td>
                <td>{t.due_date}</td>
                <td>{t.employee_name}</td>
                <td>
                  <select value={t.status} onChange={(e) => handleStatusChange(t.id, e.target.value)} aria-label={`Status of ${t.title}`}>
                    {STATUSES.map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
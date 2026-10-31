import { useEffect, useState } from "react";
import { addEmployee, deleteEmployee, getEmployees } from "../api.js";

const EMPTY = { name: "", email: "", department: "" };

export default function Employees() {
  const [employees, setEmployees] = useState([]);
  const [form, setForm] = useState(EMPTY);
  const [search, setSearch] = useState(""); 
  const [error, setError] = useState("");

  async function load() {
    try {
      setEmployees(await getEmployees());
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
      await addEmployee(form); 
      setForm(EMPTY);
      load();
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleDelete(employee) {
    const warning = employee.task_count > 0 ? ` Their ${employee.task_count} task(s) will be deleted too.` : "";
    if (!window.confirm(`Delete ${employee.name}?${warning}`)) return;
    setError("");
    try {
      await deleteEmployee(employee.id); 
      load();
    } catch (e) {
      setError(e.message);
    }
  }

  const visible = employees.filter((e) => e.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <div>
      <h2>Add employee</h2>
      <form className="form" onSubmit={handleSubmit}>
        <input name="name" placeholder="Name" value={form.name} onChange={handleChange} required />
        <input name="email" type="email" placeholder="Email" value={form.email} onChange={handleChange} required />
        <input name="department" placeholder="Department" value={form.department} onChange={handleChange} required />
        <button type="submit">Add employee</button>
      </form>
      {error && <p className="error">{error}</p>}

      <h2>Employees ({visible.length})</h2>
      <div className="toolbar">
        <input placeholder="Search by employee name" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {visible.length === 0 ? (
        <p className="muted">{employees.length === 0 ? "No employees yet. Add one above." : "No employee matches that name."}</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Department</th>
              <th>Tasks</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {visible.map((e) => (
              <tr key={e.id}>
                <td>{e.name}</td>
                <td>{e.email}</td>
                <td>{e.department}</td>
                <td>{e.task_count}</td>
                <td>
                  <button className="danger" onClick={() => handleDelete(e)}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
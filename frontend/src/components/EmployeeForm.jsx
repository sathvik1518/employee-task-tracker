import { useState } from "react";
import { addEmployee, updateEmployee } from "../api.js";
import { Field, Modal } from "./ui.jsx";

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// Add a new employee, or edit one when `employee` is given.
export default function EmployeeForm({ employee, departments, onSaved, onClose }) {
  const editing = Boolean(employee);
  const [form, setForm] = useState({
    name: employee?.name ?? "",
    email: employee?.email ?? "",
    department: employee?.department ?? "",
  });
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState("");
  const [saving, setSaving] = useState(false);

  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  function validate() {
    const found = {};
    if (form.name.trim().length < 2) found.name = "Enter the employee's full name (at least 2 letters).";
    if (!EMAIL.test(form.email.trim())) found.email = "Enter a valid email, like name@company.com.";
    if (form.department.trim().length < 2) found.department = "Enter a department, like Engineering.";
    setErrors(found);
    return Object.keys(found).length === 0;
  }

  async function submit(e) {
    e.preventDefault();
    setServerError("");
    if (!validate()) return;
    setSaving(true);
    try {
      const body = { name: form.name.trim(), email: form.email.trim(), department: form.department.trim() };
      const saved = editing ? await updateEmployee(employee.id, body) : await addEmployee(body);
      onSaved(saved, editing);
    } catch (err) {
      setServerError(err.message);
      setSaving(false);
    }
  }

  return (
    <Modal title={editing ? "Edit employee" : "Add employee"} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <div className="modal-body form-grid">
          {serverError && <div className="notice notice-error">{serverError}</div>}
          <Field label="Full name" error={errors.name}>
            <input value={form.name} onChange={set("name")} placeholder="Asha Rao" maxLength={100} />
          </Field>
          <Field label="Work email" error={errors.email}>
            <input type="email" value={form.email} onChange={set("email")} placeholder="asha@company.com" maxLength={150} />
          </Field>
          <Field label="Department" error={errors.department}>
            <input value={form.department} onChange={set("department")} placeholder="Engineering" list="department-list" maxLength={100} />
            <datalist id="department-list">
              {departments.map((d) => (
                <option key={d} value={d} />
              ))}
            </datalist>
          </Field>
        </div>
        <div className="modal-foot">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? "Saving..." : editing ? "Save changes" : "Add employee"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
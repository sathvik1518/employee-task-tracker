import { useState } from "react";
import { addTask, updateTask } from "../api.js";
import { PRIORITIES, STATUSES, addDays, todayISO } from "../utils.js";
import { Field, Modal } from "./ui.jsx";

// Create a task, or edit one when `task` is given.
export default function TaskForm({ task, employees, defaultEmployeeId, onSaved, onClose }) {
  const editing = Boolean(task);
  const [form, setForm] = useState({
    title: task?.title ?? "",
    description: task?.description ?? "",
    priority: task?.priority ?? "Medium",
    status: task?.status ?? "Pending",
    due_date: task ? String(task.due_date).slice(0, 10) : addDays(todayISO(), 3),
    employee_id: task?.employee_id ?? defaultEmployeeId ?? "",
  });
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState("");
  const [saving, setSaving] = useState(false);

  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  function validate() {
    const found = {};
    if (form.title.trim().length < 3) found.title = "Give the task a title (at least 3 characters).";
    if (!form.due_date) found.due_date = "Pick a due date.";
    if (!form.employee_id) found.employee_id = "Choose who this task is assigned to.";
    setErrors(found);
    return Object.keys(found).length === 0;
  }

  async function submit(e) {
    e.preventDefault();
    setServerError("");
    if (!validate()) return;
    setSaving(true);
    try {
      const body = { ...form, title: form.title.trim(), description: form.description.trim(), employee_id: Number(form.employee_id) };
      const saved = editing ? await updateTask(task.id, body) : await addTask(body);
      onSaved(saved, editing);
    } catch (err) {
      setServerError(err.message);
      setSaving(false);
    }
  }

  return (
    <Modal title={editing ? "Edit task" : "New task"} onClose={onClose} width={560}>
      <form onSubmit={submit} noValidate>
        <div className="modal-body form-grid">
          {serverError && <div className="notice notice-error">{serverError}</div>}

          <Field label="Title" error={errors.title}>
            <input value={form.title} onChange={set("title")} placeholder="Prepare the Q4 sales report" maxLength={150} />
          </Field>

          <Field label="Description" hint="Optional. What does done look like?">
            <textarea value={form.description} onChange={set("description")} rows={3} maxLength={1000} />
          </Field>

          <div className="form-row">
            <Field label="Assigned to" error={errors.employee_id}>
              <select value={form.employee_id} onChange={set("employee_id")}>
                <option value="">Choose an employee</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name} ({e.department})
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Due date" error={errors.due_date}>
              <input type="date" value={form.due_date} onChange={set("due_date")} />
            </Field>
          </div>

          <div className="form-row">
            <div className="field">
              <span className="field-label">Priority</span>
              <div className="segmented" role="radiogroup" aria-label="Priority">
                {PRIORITIES.map((p) => (
                  <button
                    key={p}
                    type="button"
                    role="radio"
                    aria-checked={form.priority === p}
                    className={form.priority === p ? `seg active seg-${p.toLowerCase()}` : "seg"}
                    onClick={() => setForm({ ...form, priority: p })}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
            <Field label="Status">
              <select value={form.status} onChange={set("status")}>
                {STATUSES.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </Field>
          </div>
        </div>

        <div className="modal-foot">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? "Saving..." : editing ? "Save changes" : "Create task"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
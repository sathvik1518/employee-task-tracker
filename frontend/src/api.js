// Every call to the backend lives here, so screens never touch fetch directly.
const BASE = import.meta.env.VITE_API_URL || (import.meta.env.PROD ? "/api" : "http://localhost:8000");

async function request(path, options = {}) {
  let response;
  try {
    response = await fetch(BASE + path, {
      headers: { "Content-Type": "application/json" },
      ...options,
    });
  } catch {
    throw new Error("Cannot reach the backend. Is it running on port 8000?");
  }

  if (!response.ok) {
    let message = "Something went wrong. Please try again.";
    try {
      const data = await response.json();
      if (typeof data.detail === "string") message = data.detail;
      else if (Array.isArray(data.detail)) message = data.detail.map((d) => `${d.loc.at(-1)}: ${d.msg}`).join(", ");
    } catch {
      /* the server sent no JSON: keep the default message */
    }
    throw new Error(message);
  }
  return response.json();
}

// Turns { search: "ab", status: "" } into "?search=ab" (empty values are skipped).
function query(params = {}) {
  const q = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== "" && value !== null && value !== undefined && value !== false) q.set(key, value);
  });
  const text = q.toString();
  return text ? `?${text}` : "";
}

const json = (method, body) => ({ method, body: JSON.stringify(body) });

export const getDashboard = () => request("/dashboard");

export const getEmployees = (filters) => request(`/employees${query(filters)}`);
export const addEmployee = (employee) => request("/employees", json("POST", employee));
export const updateEmployee = (id, employee) => request(`/employees/${id}`, json("PUT", employee));
export const deleteEmployee = (id) => request(`/employees/${id}`, { method: "DELETE" });

export const getTasks = (filters) => request(`/tasks${query(filters)}`);
export const addTask = (task) => request("/tasks", json("POST", task));
export const updateTask = (id, task) => request(`/tasks/${id}`, json("PUT", task));
export const updateTaskStatus = (id, status) => request(`/tasks/${id}/status`, json("PATCH", { status }));
export const deleteTask = (id) => request(`/tasks/${id}`, { method: "DELETE" });
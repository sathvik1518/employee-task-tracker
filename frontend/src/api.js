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
    
    let message = "Something went wrong.";
    try {
      const data = await response.json();
      if (typeof data.detail === "string") message = data.detail;
      else if (Array.isArray(data.detail)) message = data.detail.map((d) => `${d.loc.at(-1)}: ${d.msg}`).join(", ");
    } catch {
    }
    throw new Error(message);
  }
  return response.json();
}

export const getDashboard = () => request("/dashboard");

export const getEmployees = () => request("/employees");
export const addEmployee = (employee) => request("/employees", { method: "POST", body: JSON.stringify(employee) });
export const deleteEmployee = (id) => request(`/employees/${id}`, { method: "DELETE" });

export const getTasks = () => request("/tasks");
export const addTask = (task) => request("/tasks", { method: "POST", body: JSON.stringify(task) });
export const updateTaskStatus = (id, status) =>
  request(`/tasks/${id}/status`, { method: "PATCH", body: JSON.stringify({ status }) });
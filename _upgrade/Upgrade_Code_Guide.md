# Employee Task Tracker: Upgrade Code Guide

Do the steps in order. For every file the rule is the same:

- **REPLACE** = the file already exists. Open it, press `Ctrl+A` (select all), press `Delete`, paste the new code, press `Ctrl+S`.
- **NEW** = the file does not exist yet. In the VS Code Explorer right-click the folder, choose **New File**, type the exact file name, paste the code, press `Ctrl+S`.

Paste the code **only** (the part inside the grey box), not the backticks.

The frontend will show red errors until ALL files are in place. That is normal. Finish every step, then run it.

---

## Step 0: Make a safe branch (so your submitted version stays safe)

Open a terminal in the project root (the prompt ends with `\employee-task-tracker>`) and run:

```
git checkout -b upgrade-ui
```

Also stop the Kitchen Docker container so it stops using port 8000:

```
docker stop kitchen-docker-stack-api-1
```

---

## Step 1: `backend/db.py` (REPLACE)

Adds one small helper (run_many) so the dashboard uses one database connection.

````
"""Database connection helpers (PostgreSQL through psycopg2).

Two modes:
  - DATABASE_URL set  -> use that database (Neon, in the cloud)
  - DATABASE_URL empty -> use local PostgreSQL with the DB_* settings below
"""
import os
from pathlib import Path

import psycopg2
from psycopg2 import sql
from psycopg2.extras import RealDictCursor

DATABASE_URL = os.getenv("DATABASE_URL", "")

DB_HOST = os.getenv("DB_HOST", "localhost")
DB_PORT = os.getenv("DB_PORT", "5432")
DB_USER = os.getenv("DB_USER", "postgres")
DB_PASSWORD = os.getenv("DB_PASSWORD", "postgres")
DB_NAME = os.getenv("DB_NAME", "task_tracker")


def connect(dbname=DB_NAME):
    """Open a new connection. Rows come back as dictionaries."""
    if DATABASE_URL:
        return psycopg2.connect(DATABASE_URL, cursor_factory=RealDictCursor)
    return psycopg2.connect(
        host=DB_HOST, port=DB_PORT, user=DB_USER, password=DB_PASSWORD,
        dbname=dbname, cursor_factory=RealDictCursor,
    )


def run(query, params=(), fetch="all"):
    """Run ONE SQL statement and return its rows (%s placeholders block SQL injection)."""
    conn = connect()
    try:
        with conn:  # commit if it worked, roll back if it failed
            with conn.cursor() as cur:
                cur.execute(query, params)
                if fetch == "all":
                    return cur.fetchall()
                if fetch == "one":
                    return cur.fetchone()
                return None
    finally:
        conn.close()


def run_many(statements):
    """Run several read queries on ONE connection (faster: connecting to a cloud database is slow).

    statements: list of (query, params, fetch). Returns a list of results in the same order.
    """
    conn = connect()
    try:
        with conn:
            with conn.cursor() as cur:
                results = []
                for query, params, fetch in statements:
                    cur.execute(query, params)
                    if fetch == "all":
                        results.append(cur.fetchall())
                    elif fetch == "one":
                        results.append(cur.fetchone())
                    else:
                        results.append(None)
                return results
    finally:
        conn.close()


def create_database_if_missing():
    """Local only. Neon already gives you a database, so skip it there."""
    if DATABASE_URL:
        return
    conn = connect("postgres")
    conn.autocommit = True
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT 1 FROM pg_database WHERE datname = %s", (DB_NAME,))
            if cur.fetchone() is None:
                cur.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(DB_NAME)))
                print(f"Created database '{DB_NAME}'")
    finally:
        conn.close()


def create_tables():
    """Run schema.sql (the CREATE TABLE statements)."""
    script = (Path(__file__).parent / "schema.sql").read_text()
    conn = connect()
    try:
        with conn:
            with conn.cursor() as cur:
                cur.execute(script)
    finally:
        conn.close()


def init_db():
    create_database_if_missing()
    create_tables()
````

---

## Step 2: `backend/main.py` (REPLACE)

All API endpoints. New: edit employee, edit task, delete task, search and filters in SQL, overdue, bigger dashboard.

````
"""Employee Task Tracker: FastAPI backend.

Run:  python -m uvicorn main:app --reload --port 8000
Docs: http://localhost:8000/docs   (Swagger UI: try every API from the browser)
"""
import os
import re
from contextlib import asynccontextmanager
from datetime import date
from typing import Literal, Optional

import psycopg2
from psycopg2 import errors
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict, Field

import db


# ---------------------------------------------------------------------------
# Startup: connect to PostgreSQL and make sure the tables exist.
# ---------------------------------------------------------------------------
@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        db.init_db()
    except psycopg2.OperationalError as error:
        print("\nCould not connect to PostgreSQL. Check that DATABASE_URL is set correctly")
        print("(or, for a local database, that PostgreSQL is running and DB_PASSWORD is right).")
        print(f"\nDetails: {error}")
        raise
    print("Database ready.")
    yield


app = FastAPI(title="Employee Task Tracker API", version="2.0", lifespan=lifespan)

# CORS: lets the React app (port 5173) call this API (port 8000). Browsers block it otherwise.
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("ALLOWED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)

# "Today" and "overdue" must follow YOUR calendar, not the cloud server's (which runs in UTC).
_tz = os.getenv("APP_TIMEZONE", "Asia/Kolkata")
TIMEZONE = _tz if re.fullmatch(r"[A-Za-z0-9_/+\-]+", _tz) else "Asia/Kolkata"
TODAY = f"(now() AT TIME ZONE '{TIMEZONE}')::date"


# ---------------------------------------------------------------------------
# Request shapes (Pydantic). FastAPI checks incoming JSON against these and
# answers with a 422 error automatically if something is missing or wrong.
# ---------------------------------------------------------------------------
Status = Literal["Pending", "In Progress", "Completed"]
Priority = Literal["Low", "Medium", "High"]


class EmployeeIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    name: str = Field(min_length=2, max_length=100)
    email: str = Field(max_length=150, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    department: str = Field(min_length=2, max_length=100)


class TaskIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    title: str = Field(min_length=3, max_length=150)
    description: str = Field(default="", max_length=1000)
    priority: Priority = "Medium"
    status: Status = "Pending"
    due_date: date
    employee_id: int


class StatusIn(BaseModel):
    status: Status


def like(text: str) -> str:
    """Turn what the user typed into a safe ILIKE pattern ('%text%')."""
    escaped = text.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


# Employee rows always come with their task numbers, so the UI needs no extra calls.
EMPLOYEE_SELECT = f"""
    SELECT e.id, e.name, e.email, e.department, e.created_at,
           COUNT(t.id)::int AS task_count,
           COUNT(t.id) FILTER (WHERE t.status <> 'Completed')::int AS open_tasks,
           COUNT(t.id) FILTER (WHERE t.status = 'Completed')::int AS completed_tasks,
           COUNT(t.id) FILTER (WHERE t.status <> 'Completed' AND t.due_date < {TODAY})::int AS overdue_tasks
    FROM employees e
    LEFT JOIN tasks t ON t.employee_id = e.id
"""

# Task rows come with the employee's name and an overdue flag.
TASK_SELECT = f"""
    SELECT t.id, t.title, t.description, t.priority, t.status, t.due_date,
           t.employee_id, e.name AS employee_name, e.department AS employee_department,
           t.created_at,
           (t.status <> 'Completed' AND t.due_date < {TODAY}) AS is_overdue
    FROM tasks t
    JOIN employees e ON e.id = t.employee_id
"""


def get_employee(employee_id: int):
    return db.run(EMPLOYEE_SELECT + " WHERE e.id = %s GROUP BY e.id", (employee_id,), fetch="one")


def get_task(task_id: int):
    return db.run(TASK_SELECT + " WHERE t.id = %s", (task_id,), fetch="one")


@app.get("/")
def home():
    return {"message": "Employee Task Tracker API is running. Open /docs to try it."}


# ---------------------------------------------------------------------------
# Employees
# ---------------------------------------------------------------------------
@app.get("/employees")
def list_employees(
    search: str = Query("", description="Match name or email"),
    department: str = Query("", description="Exact department"),
):
    where, params = [], []
    if search.strip():
        where.append("(e.name ILIKE %s OR e.email ILIKE %s)")
        params += [like(search)] * 2
    if department.strip():
        where.append("e.department = %s")
        params.append(department.strip())
    clause = (" WHERE " + " AND ".join(where)) if where else ""
    return db.run(EMPLOYEE_SELECT + clause + " GROUP BY e.id ORDER BY e.name", tuple(params))


@app.post("/employees", status_code=201)
def add_employee(employee: EmployeeIn):
    try:
        created = db.run(
            "INSERT INTO employees (name, email, department) VALUES (%s, %s, %s) RETURNING id",
            (employee.name, employee.email, employee.department),
            fetch="one",
        )
    except errors.UniqueViolation:
        raise HTTPException(409, "An employee with this email already exists.")
    return get_employee(created["id"])


@app.put("/employees/{employee_id}")
def update_employee(employee_id: int, employee: EmployeeIn):
    try:
        row = db.run(
            "UPDATE employees SET name = %s, email = %s, department = %s WHERE id = %s RETURNING id",
            (employee.name, employee.email, employee.department, employee_id),
            fetch="one",
        )
    except errors.UniqueViolation:
        raise HTTPException(409, "Another employee already uses this email.")
    if row is None:
        raise HTTPException(404, "Employee not found.")
    return get_employee(employee_id)


@app.delete("/employees/{employee_id}")
def delete_employee(employee_id: int):
    row = db.run("DELETE FROM employees WHERE id = %s RETURNING id", (employee_id,), fetch="one")
    if row is None:
        raise HTTPException(404, "Employee not found.")
    return {"deleted": employee_id}  # their tasks are removed too (ON DELETE CASCADE)


# ---------------------------------------------------------------------------
# Tasks
# ---------------------------------------------------------------------------
@app.get("/tasks")
def list_tasks(
    search: str = Query("", description="Match title, description or employee name"),
    status: Optional[Status] = None,
    priority: Optional[Priority] = None,
    employee_id: Optional[int] = None,
    overdue: bool = False,
):
    where, params = [], []
    if search.strip():
        where.append("(t.title ILIKE %s OR t.description ILIKE %s OR e.name ILIKE %s)")
        params += [like(search)] * 3
    if status:
        where.append("t.status = %s")
        params.append(status)
    if priority:
        where.append("t.priority = %s")
        params.append(priority)
    if employee_id is not None:
        where.append("t.employee_id = %s")
        params.append(employee_id)
    if overdue:
        where.append(f"t.status <> 'Completed' AND t.due_date < {TODAY}")
    clause = (" WHERE " + " AND ".join(where)) if where else ""
    return db.run(TASK_SELECT + clause + " ORDER BY t.due_date, t.id", tuple(params))


@app.post("/tasks", status_code=201)
def add_task(task: TaskIn):
    try:
        created = db.run(
            """
            INSERT INTO tasks (title, description, priority, status, due_date, employee_id)
            VALUES (%s, %s, %s, %s, %s, %s)
            RETURNING id
            """,
            (task.title, task.description, task.priority, task.status, task.due_date, task.employee_id),
            fetch="one",
        )
    except errors.ForeignKeyViolation:
        raise HTTPException(400, "That employee does not exist.")
    return get_task(created["id"])


@app.put("/tasks/{task_id}")
def update_task(task_id: int, task: TaskIn):
    try:
        row = db.run(
            """
            UPDATE tasks
            SET title = %s, description = %s, priority = %s, status = %s, due_date = %s, employee_id = %s
            WHERE id = %s RETURNING id
            """,
            (task.title, task.description, task.priority, task.status, task.due_date, task.employee_id, task_id),
            fetch="one",
        )
    except errors.ForeignKeyViolation:
        raise HTTPException(400, "That employee does not exist.")
    if row is None:
        raise HTTPException(404, "Task not found.")
    return get_task(task_id)


@app.patch("/tasks/{task_id}/status")
def update_task_status(task_id: int, body: StatusIn):
    row = db.run("UPDATE tasks SET status = %s WHERE id = %s RETURNING id", (body.status, task_id), fetch="one")
    if row is None:
        raise HTTPException(404, "Task not found.")
    return get_task(task_id)


@app.delete("/tasks/{task_id}")
def delete_task(task_id: int):
    row = db.run("DELETE FROM tasks WHERE id = %s RETURNING id", (task_id,), fetch="one")
    if row is None:
        raise HTTPException(404, "Task not found.")
    return {"deleted": task_id}


# ---------------------------------------------------------------------------
# Dashboard: the database does the counting. One connection, several queries.
# ---------------------------------------------------------------------------
@app.get("/dashboard")
def dashboard():
    counts, today, priorities, workload, due_by_date, attention = db.run_many([
        (
            f"""
            SELECT
                (SELECT COUNT(*) FROM employees)::int                                   AS total_employees,
                COUNT(*)::int                                                           AS total_tasks,
                COUNT(*) FILTER (WHERE status = 'Completed')::int                       AS completed_tasks,
                COUNT(*) FILTER (WHERE status = 'Pending')::int                         AS pending_tasks,
                COUNT(*) FILTER (WHERE status = 'In Progress')::int                     AS in_progress_tasks,
                COUNT(*) FILTER (WHERE status <> 'Completed' AND due_date < {TODAY})::int AS overdue_tasks,
                COUNT(*) FILTER (WHERE status <> 'Completed'
                                   AND due_date BETWEEN {TODAY} AND {TODAY} + 6)::int   AS due_this_week
            FROM tasks
            """,
            (), "one",
        ),
        (f"SELECT {TODAY} AS today", (), "one"),
        (
            "SELECT priority, COUNT(*)::int AS count FROM tasks WHERE status <> 'Completed' GROUP BY priority",
            (), "all",
        ),
        (
            """
            SELECT e.id, e.name,
                   COUNT(t.id) FILTER (WHERE t.status = 'Pending')::int     AS pending,
                   COUNT(t.id) FILTER (WHERE t.status = 'In Progress')::int AS in_progress,
                   COUNT(t.id) FILTER (WHERE t.status = 'Completed')::int   AS completed
            FROM employees e
            LEFT JOIN tasks t ON t.employee_id = e.id
            GROUP BY e.id
            ORDER BY COUNT(t.id) FILTER (WHERE t.status <> 'Completed') DESC, e.name
            LIMIT 8
            """,
            (), "all",
        ),
        (
            "SELECT due_date AS date, COUNT(*)::int AS count FROM tasks WHERE status <> 'Completed' GROUP BY due_date ORDER BY due_date",
            (), "all",
        ),
        (
            TASK_SELECT + f" WHERE t.status <> 'Completed' AND t.due_date <= {TODAY} + 3 ORDER BY t.due_date, t.id LIMIT 6",
            (), "all",
        ),
    ])

    total = counts["total_tasks"]
    return {
        **counts,
        "completion_rate": round(counts["completed_tasks"] * 100 / total) if total else 0,
        "today": today["today"],
        "by_priority": {p["priority"]: p["count"] for p in priorities},
        "workload": workload,
        "due_by_date": due_by_date,
        "attention": attention,
    }
````

---

## Step 3: `backend/test_api.py` (NEW)

Automated API tests (optional to run, nice to show).

````
"""Automated tests for the API.

Run (from the backend folder, with the venv on):
    pip install pytest httpx
    $env:DB_NAME="task_tracker_test"      # use a separate test database, not your real data
    python -m pytest -q

Do NOT run these against your Neon DATABASE_URL: the tests empty the tables first.
"""
import os
from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient

if os.getenv("DATABASE_URL"):
    raise SystemExit("Refusing to run tests against DATABASE_URL (they clear all rows). Unset it first.")

import db
from main import app


@pytest.fixture()
def client():
    with TestClient(app) as c:  # runs startup: creates the database and tables
        db.run("TRUNCATE tasks, employees RESTART IDENTITY CASCADE", fetch=None)
        yield c


def make_employee(client, name="Asha Rao", email="asha@example.com", department="Engineering"):
    r = client.post("/employees", json={"name": name, "email": email, "department": department})
    assert r.status_code == 201, r.text
    return r.json()


def make_task(client, employee_id, **overrides):
    body = {
        "title": "Write report",
        "description": "Quarterly numbers",
        "priority": "High",
        "due_date": str(date.today() + timedelta(days=2)),
        "employee_id": employee_id,
    }
    body.update(overrides)
    r = client.post("/tasks", json=body)
    assert r.status_code == 201, r.text
    return r.json()


# ---------------- employees ----------------
def test_add_list_employee(client):
    e = make_employee(client)
    assert e["task_count"] == 0
    rows = client.get("/employees").json()
    assert [r["email"] for r in rows] == ["asha@example.com"]


def test_duplicate_email_is_409(client):
    make_employee(client)
    r = client.post("/employees", json={"name": "Other", "email": "asha@example.com", "department": "HR"})
    assert r.status_code == 409


def test_invalid_email_is_422(client):
    r = client.post("/employees", json={"name": "Bad", "email": "nope", "department": "HR"})
    assert r.status_code == 422


def test_edit_employee(client):
    e = make_employee(client)
    r = client.put(f"/employees/{e['id']}", json={"name": "Asha R", "email": "asha@example.com", "department": "Design"})
    assert r.status_code == 200
    assert r.json()["department"] == "Design"


def test_edit_employee_to_taken_email_is_409(client):
    make_employee(client)
    b = make_employee(client, name="Bala", email="bala@example.com")
    r = client.put(f"/employees/{b['id']}", json={"name": "Bala", "email": "asha@example.com", "department": "HR"})
    assert r.status_code == 409


def test_edit_missing_employee_is_404(client):
    r = client.put("/employees/999", json={"name": "Ghost", "email": "g@example.com", "department": "HR"})
    assert r.status_code == 404


def test_search_and_department_filter(client):
    make_employee(client)
    make_employee(client, name="Bala Menon", email="bala@example.com", department="Sales")
    assert len(client.get("/employees", params={"search": "bala"}).json()) == 1
    assert len(client.get("/employees", params={"department": "Sales"}).json()) == 1
    assert len(client.get("/employees", params={"search": "%"}).json()) == 0  # % is not a wildcard


def test_delete_employee_removes_tasks(client):
    e = make_employee(client)
    make_task(client, e["id"])
    assert client.delete(f"/employees/{e['id']}").status_code == 200
    assert client.get("/tasks").json() == []
    assert client.delete(f"/employees/{e['id']}").status_code == 404


# ---------------- tasks ----------------
def test_create_task_with_employee_name(client):
    e = make_employee(client)
    t = make_task(client, e["id"])
    assert t["employee_name"] == "Asha Rao"
    assert t["status"] == "Pending"
    assert t["is_overdue"] is False


def test_task_for_missing_employee_is_400(client):
    r = client.post("/tasks", json={"title": "Orphan", "priority": "Low", "due_date": "2030-01-01", "employee_id": 42})
    assert r.status_code == 400


def test_status_update_and_validation(client):
    e = make_employee(client)
    t = make_task(client, e["id"])
    ok = client.patch(f"/tasks/{t['id']}/status", json={"status": "Completed"})
    assert ok.status_code == 200 and ok.json()["status"] == "Completed"
    assert client.patch(f"/tasks/{t['id']}/status", json={"status": "Done"}).status_code == 422
    assert client.patch("/tasks/999/status", json={"status": "Pending"}).status_code == 404


def test_edit_task(client):
    a = make_employee(client)
    b = make_employee(client, name="Bala", email="bala@example.com")
    t = make_task(client, a["id"])
    body = {"title": "New title", "description": "", "priority": "Low", "status": "In Progress",
            "due_date": "2031-05-05", "employee_id": b["id"]}
    r = client.put(f"/tasks/{t['id']}", json=body)
    assert r.status_code == 200
    data = r.json()
    assert (data["title"], data["employee_name"], data["status"]) == ("New title", "Bala", "In Progress")


def test_delete_task(client):
    e = make_employee(client)
    t = make_task(client, e["id"])
    assert client.delete(f"/tasks/{t['id']}").status_code == 200
    assert client.delete(f"/tasks/{t['id']}").status_code == 404


def test_overdue_flag_and_filters(client):
    e = make_employee(client)
    past = str(date.today() - timedelta(days=30))
    make_task(client, e["id"], title="Old task", due_date=past)
    done = make_task(client, e["id"], title="Old but done", due_date=past, status="Completed")
    make_task(client, e["id"], title="Future task", priority="Low")

    assert done["is_overdue"] is False  # completed tasks are never overdue
    assert [t["title"] for t in client.get("/tasks", params={"overdue": True}).json()] == ["Old task"]
    assert len(client.get("/tasks", params={"status": "Completed"}).json()) == 1
    assert len(client.get("/tasks", params={"priority": "Low"}).json()) == 1
    assert len(client.get("/tasks", params={"employee_id": e["id"]}).json()) == 3
    assert len(client.get("/tasks", params={"search": "asha"}).json()) == 3  # matches employee name
    assert len(client.get("/tasks", params={"search": "future"}).json()) == 1


# ---------------- dashboard ----------------
def test_dashboard_counts(client):
    e = make_employee(client)
    past = str(date.today() - timedelta(days=5))
    make_task(client, e["id"], due_date=past)
    make_task(client, e["id"], status="In Progress")
    make_task(client, e["id"], status="Completed")
    d = client.get("/dashboard").json()
    assert d["total_employees"] == 1
    assert d["total_tasks"] == 3
    assert d["completed_tasks"] == 1
    assert d["pending_tasks"] == 1
    assert d["in_progress_tasks"] == 1
    assert d["overdue_tasks"] == 1
    assert d["completion_rate"] == 33
    assert d["workload"][0]["name"] == "Asha Rao"
    assert sum(x["count"] for x in d["due_by_date"]) == 2  # open tasks only
    assert d["attention"][0]["is_overdue"] is True


def test_dashboard_empty_database(client):
    d = client.get("/dashboard").json()
    assert d["total_tasks"] == 0 and d["completion_rate"] == 0
    assert d["attention"] == [] and d["workload"] == []
````

---

## Step 4: `frontend/index.html` (REPLACE)

Adds the Manrope font and the dark-mode switch before the page paints.

````
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="color-scheme" content="light dark" />
    <title>Employee Task Tracker</title>
    <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='9' fill='%232F54EB'/%3E%3Cpath d='M9 16.5l4.5 4.5L23 11' fill='none' stroke='white' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
    <script>
      // Set the theme before the page paints, so there is no light flash in dark mode.
      try {
        var t = localStorage.getItem("tt-theme");
        if (!t) t = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
        document.documentElement.setAttribute("data-theme", t);
      } catch (e) {}
    </script>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
````

---

## Step 5: `frontend/src/utils.js` (NEW)

Small helpers: dates, colours, initials, CSV download.

````
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
````

---

## Step 6: `frontend/src/api.js` (REPLACE)

Every backend call lives here. New: edit and delete calls, filters.

````
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
````

---

## Step 7: `frontend/src/main.jsx` (REPLACE)

Starts the app and wraps it with the toast messages.

````
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import { ToastProvider } from "./components/Toast.jsx";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <ToastProvider>
    <App />
  </ToastProvider>
);
````

---

## Step 8: `frontend/src/components/ui.jsx` (NEW)

Shared building blocks: icons, avatar, badges, popup dialog, empty state.

````
// Small building blocks used all over the app.
import { useEffect, useRef } from "react";
import { avatarHue, initials, statusKey } from "../utils.js";

const PATHS = {
  dashboard: "M4 4h7v7H4zM13 4h7v4h-7zM13 10h7v10h-7zM4 13h7v7H4z",
  users: "M16 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 18.5V20M10 12a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM20 20v-1.5a3.5 3.5 0 0 0-2.5-3.35M15.5 5.2a3.5 3.5 0 0 1 0 6.6",
  tasks: "M9 11l2.5 2.5L16 9M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z",
  plus: "M12 5v14M5 12h14",
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-3.5-3.5",
  edit: "M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17zM14 7l3 3",
  trash: "M5 7h14M10 11v6M14 11v6M6 7l1 12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-12M9 7V4h6v3",
  sun: "M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4",
  moon: "M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z",
  close: "M6 6l12 12M18 6L6 18",
  calendar: "M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM4 10h16M8 3v4M16 3v4",
  alert: "M12 8v5M12 16.5v.5M10.3 4.2L2.9 17a2 2 0 0 0 1.7 3h14.8a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0z",
  download: "M12 4v11M7.5 11L12 15.5 16.5 11M5 20h14",
  list: "M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01",
  board: "M4 5h4.5v14H4zM9.75 5h4.5v9h-4.5zM15.5 5H20v11.5h-4.5z",
  check: "M5 12.5l4.5 4.5L19 7.5",
  mail: "M4 6h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1zM3.5 7.5L12 13l8.5-5.5",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2",
  flag: "M5 21V4M5 4h11l-2 4 2 4H5",
  menu: "M4 7h16M4 12h16M4 17h16",
};

export function Icon({ name, size = 20 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="icon"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

export function Avatar({ id, name, size = 36 }) {
  return (
    <span className="avatar" style={{ "--h": avatarHue(id), width: size, height: size, fontSize: size * 0.38 }} aria-hidden="true">
      {initials(name)}
    </span>
  );
}

export function StatusBadge({ status }) {
  return <span className={`badge badge-${statusKey(status)}`}>{status}</span>;
}

export function PriorityBadge({ priority }) {
  return (
    <span className={`prio prio-${priority.toLowerCase()}`}>
      <span className="prio-dot" />
      {priority}
    </span>
  );
}

export function EmptyState({ title, text, action }) {
  return (
    <div className="empty">
      <div className="empty-art" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <h3>{title}</h3>
      {text && <p>{text}</p>}
      {action}
    </div>
  );
}

export function Skeleton({ height = 80, count = 1 }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="skeleton" style={{ height }} />
      ))}
    </>
  );
}

export function ErrorNotice({ message, onRetry }) {
  return (
    <div className="notice notice-error" role="alert">
      <Icon name="alert" size={18} />
      <span>{message}</span>
      {onRetry && (
        <button className="btn btn-small" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

// A centred dialog. Esc and a click outside close it; focus moves inside and returns afterwards.
export function Modal({ title, onClose, children, width = 520 }) {
  const box = useRef(null);

  useEffect(() => {
    const previous = document.activeElement;
    const first = box.current?.querySelector("input, select, textarea, button.btn-primary");
    first?.focus();
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    document.body.classList.add("no-scroll");
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.classList.remove("no-scroll");
      previous?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" ref={box} role="dialog" aria-modal="true" aria-label={title} style={{ maxWidth: width }}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <Icon name="close" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function ConfirmDialog({ title, children, confirmLabel = "Delete", busy, onConfirm, onClose }) {
  return (
    <Modal title={title} onClose={onClose} width={440}>
      <div className="modal-body">{children}</div>
      <div className="modal-foot">
        <button className="btn" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button className="btn btn-danger" onClick={onConfirm} disabled={busy}>
          {busy ? "Working..." : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

export function Field({ label, error, hint, children }) {
  return (
    <label className={error ? "field has-error" : "field"}>
      <span className="field-label">{label}</span>
      {children}
      {error ? <span className="field-error">{error}</span> : hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}
````

---

## Step 9: `frontend/src/components/Toast.jsx` (NEW)

The small pop-up messages (Saved, Deleted, Undo).

````
import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { Icon } from "./ui.jsx";

const ToastContext = createContext(() => {});

// Call const toast = useToast(); toast("Saved") or toast("Failed", { tone: "error" })
// An action adds a button: toast("Task deleted", { action: { label: "Undo", onClick } })
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id) => setToasts((list) => list.filter((t) => t.id !== id)), []);

  const push = useCallback(
    (message, { tone = "success", action = null, duration } = {}) => {
      const id = nextId.current++;
      setToasts((list) => [...list.slice(-3), { id, message, tone, action }]);
      setTimeout(() => dismiss(id), duration ?? (action ? 6500 : tone === "error" ? 5500 : 3500));
    },
    [dismiss]
  );

  const value = useMemo(() => push, [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.tone}`}>
            <Icon name={t.tone === "error" ? "alert" : "check"} size={18} />
            <span className="toast-text">{t.message}</span>
            {t.action && (
              <button
                className="toast-action"
                onClick={() => {
                  t.action.onClick();
                  dismiss(t.id);
                }}
              >
                {t.action.label}
              </button>
            )}
            <button className="toast-close" aria-label="Dismiss" onClick={() => dismiss(t.id)}>
              <Icon name="close" size={16} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
````

---

## Step 10: `frontend/src/components/EmployeeForm.jsx` (NEW)

Add and edit employee popup with validation.

````
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
````

---

## Step 11: `frontend/src/components/TaskForm.jsx` (NEW)

Create and edit task popup with validation.

````
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
````

---

## Step 12: `frontend/src/components/Employees.jsx` (REPLACE)

Employees page: cards, search, department filter, edit, delete.

````
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
````

---

## Step 13: `frontend/src/components/Tasks.jsx` (REPLACE)

Tasks page: Kanban board with drag and drop, list view, filters, export.

````
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
````

---

## Step 14: `frontend/src/components/Dashboard.jsx` (REPLACE)

Dashboard: summary panel, counts, line graph, attention list, workload.

````
import { useCallback, useEffect, useState } from "react";
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

  const W = 720;
  const H = 400;
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
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Line chart of open tasks due each day">
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
````

---

## Step 15: `frontend/src/App.jsx` (REPLACE)

The page shell: side rail, top bar, dark mode toggle, page switching.

````
import { useCallback, useEffect, useState } from "react";
import Dashboard from "./components/Dashboard.jsx";
import Employees from "./components/Employees.jsx";
import Tasks from "./components/Tasks.jsx";
import { Icon } from "./components/ui.jsx";
import { remember } from "./utils.js";

const PAGES = [
  { id: "dashboard", label: "Dashboard", icon: "dashboard", subtitle: "How the team is doing right now" },
  { id: "employees", label: "Employees", icon: "users", subtitle: "Your team and what each person is working on" },
  { id: "tasks", label: "Tasks", icon: "tasks", subtitle: "Create, assign and move work forward" },
];

const pageFromHash = () => {
  const id = window.location.hash.replace("#/", "");
  return PAGES.some((p) => p.id === id) ? id : "dashboard";
};

export default function App() {
  const [page, setPage] = useState(pageFromHash);
  // A dashboard tile can open Tasks with a filter already applied: { status, overdue, employeeId, create }
  const [preset, setPreset] = useState({});
  const [theme, setTheme] = useState(() => document.documentElement.getAttribute("data-theme") || "light");

  useEffect(() => {
    const onHash = () => {
      setPage(pageFromHash());
      setPreset({});
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const go = useCallback((id, nextPreset = {}) => {
    setPreset(nextPreset);
    setPage(id);
    if (window.location.hash !== `#/${id}`) window.history.pushState(null, "", `#/${id}`);
    window.scrollTo({ top: 0 });
  }, []);

  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    remember("tt-theme", next);
  }

  const current = PAGES.find((p) => p.id === page);

  return (
    <div className="app">
      <aside className="rail">
        <a className="brand" href="#/dashboard" aria-label="Employee Task Tracker home">
          <span className="brand-mark">
            <Icon name="check" size={20} />
          </span>
          <span className="brand-text">
            <strong>Task Tracker</strong>
            <small>Team workspace</small>
          </span>
        </a>

        <nav className="nav" aria-label="Main">
          {PAGES.map((p) => (
            <a
              key={p.id}
              href={`#/${p.id}`}
              className={page === p.id ? "nav-item active" : "nav-item"}
              aria-current={page === p.id ? "page" : undefined}
              onClick={(e) => {
                e.preventDefault();
                go(p.id);
              }}
            >
              <Icon name={p.icon} size={20} />
              <span>{p.label}</span>
            </a>
          ))}
        </nav>

        <p className="rail-foot">React, FastAPI and PostgreSQL</p>
      </aside>

      <div className="main">
        <header className="topbar">
          <div>
            <h1>{current.label}</h1>
            <p>{current.subtitle}</p>
          </div>
          <button className="icon-btn icon-btn-big" onClick={toggleTheme} aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"} title="Switch theme">
            <Icon name={theme === "dark" ? "sun" : "moon"} />
          </button>
        </header>

        <main className="content">
          {/* key={...} resets a screen when a dashboard shortcut sends it new filters */}
          {page === "dashboard" && <Dashboard go={go} />}
          {page === "employees" && <Employees go={go} />}
          {page === "tasks" && <Tasks key={JSON.stringify(preset)} go={go} preset={preset} />}
        </main>
      </div>
    </div>
  );
}
````

---

## Step 16: `frontend/src/styles.css` (REPLACE)

All the design (colours, layout, dark mode, phone layout). Longest file, paste it last.

````
/* ==========================================================================
   Employee Task Tracker: design tokens, then layout, then components.
   Light and dark themes only change the variables in the first two blocks.
   ========================================================================== */

:root {
  --font: "Manrope", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;

  --bg: #eef1f7;
  --surface: #ffffff;
  --surface-2: #f5f7fb;
  --ink: #0f1b3d;
  --muted: #5a6684;
  --line: #dce2ee;
  --track: #e4e9f3;

  --brand: #2f54eb;
  --brand-ink: #ffffff;
  --brand-soft: #e8edff;

  --pending: #d98a0b;
  --pending-soft: #fff1d4;
  --pending-ink: #8a5300;
  --progress: #2f54eb;
  --progress-soft: #e8edff;
  --progress-ink: #2342b8;
  --done: #12a383;
  --done-soft: #daf5ec;
  --done-ink: #0a6b55;
  --danger: #d23a55;
  --danger-soft: #fde8ec;
  --danger-ink: #a5223a;
  --low: #7a86a5;

  --rail: #0d1736;
  --rail-ink: #b9c4e6;
  --rail-active: #1c2b60;

  --tip-bg: #0f1b3d;
  --tip-ink: #ffffff;
  --shadow: 0 18px 48px -18px rgba(15, 27, 61, 0.35);
  --focus: #2f54eb;
}

:root[data-theme="dark"] {
  --bg: #0a1022;
  --surface: #111a36;
  --surface-2: #16224a;
  --ink: #e7ecfa;
  --muted: #93a0c6;
  --line: #243157;
  --track: #1d2950;

  --brand: #6f8cff;
  --brand-ink: #0a1022;
  --brand-soft: #1b2756;

  --pending: #f0a93a;
  --pending-soft: #3a2c10;
  --pending-ink: #f5c772;
  --progress: #7c97ff;
  --progress-soft: #1b2756;
  --progress-ink: #a9bcff;
  --done: #3ccfa8;
  --done-soft: #0f3a31;
  --done-ink: #7be3c5;
  --danger: #ff6b84;
  --danger-soft: #431a26;
  --danger-ink: #ff9aac;
  --low: #8c98bb;

  --rail: #070c1f;
  --rail-ink: #9eabd2;
  --rail-active: #16224a;

  --tip-bg: #e7ecfa;
  --tip-ink: #0a1022;
  --shadow: 0 18px 48px -18px rgba(0, 0, 0, 0.7);
  --focus: #8fa5ff;
}

/* ---------- base ---------- */
*,
*::before,
*::after {
  box-sizing: border-box;
}

html {
  color-scheme: light;
}
html[data-theme="dark"] {
  color-scheme: dark;
}

body {
  margin: 0;
  font-family: var(--font);
  font-size: 15px;
  line-height: 1.5;
  color: var(--ink);
  background: var(--bg);
  -webkit-font-smoothing: antialiased;
  font-variant-numeric: tabular-nums;
}
body.no-scroll {
  overflow: hidden;
}

h1,
h2,
h3,
h4,
p {
  margin: 0;
}
button,
input,
select,
textarea {
  font: inherit;
  color: inherit;
}
button {
  cursor: pointer;
}
a {
  color: inherit;
}
svg text {
  font-family: inherit;
}

:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
  border-radius: 8px;
}

/* ---------- app shell ---------- */
.app {
  display: grid;
  grid-template-columns: 236px minmax(0, 1fr);
  min-height: 100vh;
}

.rail {
  position: sticky;
  top: 0;
  height: 100vh;
  display: flex;
  flex-direction: column;
  gap: 28px;
  padding: 22px 14px;
  background: var(--rail);
  color: var(--rail-ink);
}

.brand {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 8px;
  text-decoration: none;
  color: #fff;
}
.brand-mark {
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  border-radius: 11px;
  background: #2f54eb;
  color: #fff;
}
.brand-text {
  display: flex;
  flex-direction: column;
  line-height: 1.2;
}
.brand-text strong {
  font-size: 16px;
  font-weight: 800;
  letter-spacing: -0.01em;
}
.brand-text small {
  color: var(--rail-ink);
  font-size: 12px;
}

.nav {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.nav-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 11px 12px;
  border-radius: 11px;
  color: var(--rail-ink);
  font-weight: 600;
  text-decoration: none;
  transition: background 0.15s, color 0.15s;
}
.nav-item:hover {
  background: rgba(255, 255, 255, 0.06);
  color: #fff;
}
.nav-item.active {
  background: var(--rail-active);
  color: #fff;
  box-shadow: inset 3px 0 0 #6f8cff;
}
.rail :focus-visible {
  outline-color: #9fb2ff;
}
.rail-foot {
  margin-top: auto;
  padding: 0 10px;
  font-size: 12px;
  color: var(--rail-ink);
  opacity: 0.7;
}

.main {
  min-width: 0;
}
.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 26px 32px 6px;
  max-width: 1240px;
}
.topbar h1 {
  font-size: 28px;
  font-weight: 800;
  letter-spacing: -0.02em;
}
.topbar p {
  color: var(--muted);
}
.content {
  padding: 18px 32px 56px;
  max-width: 1240px;
}

/* ---------- buttons ---------- */
.icon {
  flex: none;
}
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 40px;
  padding: 0 16px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--surface);
  font-weight: 700;
  white-space: nowrap;
  transition: background 0.15s, border-color 0.15s, transform 0.05s;
}
.btn:hover:not(:disabled) {
  background: var(--surface-2);
  border-color: var(--muted);
}
.btn:active:not(:disabled) {
  transform: translateY(1px);
}
.btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.btn-primary {
  background: var(--brand);
  border-color: var(--brand);
  color: var(--brand-ink);
}
.btn-primary:hover:not(:disabled) {
  background: var(--brand);
  border-color: var(--brand);
  filter: brightness(1.1);
}
.btn-danger {
  background: var(--danger);
  border-color: var(--danger);
  color: #fff;
}
.btn-danger:hover:not(:disabled) {
  background: var(--danger);
  border-color: var(--danger);
  filter: brightness(1.08);
}
.btn-ghost {
  border-color: transparent;
  background: transparent;
  color: var(--brand);
}
.btn-ghost:hover:not(:disabled) {
  background: var(--brand-soft);
  border-color: transparent;
}
.btn-icon {
  width: 40px;
  padding: 0;
}
.btn-small {
  min-height: 32px;
  padding: 0 12px;
  font-size: 13px;
}
.btn-block {
  width: 100%;
  margin-top: 8px;
}

.icon-btn {
  display: inline-grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border: 0;
  border-radius: 9px;
  background: transparent;
  color: var(--muted);
  transition: background 0.15s, color 0.15s;
}
.icon-btn:hover {
  background: var(--surface-2);
  color: var(--ink);
}
.icon-btn-danger:hover {
  background: var(--danger-soft);
  color: var(--danger);
}
.icon-btn-big {
  width: 42px;
  height: 42px;
  border: 1px solid var(--line);
  background: var(--surface);
}

/* ---------- toolbar and filters ---------- */
.toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin-bottom: 16px;
}
.toolbar-sub {
  margin-top: -4px;
}
.toolbar-spacer {
  flex: 1;
}
.search {
  position: relative;
  flex: 1 1 180px;
  max-width: 320px;
}
.search .icon {
  position: absolute;
  left: 12px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--muted);
}
.search input {
  width: 100%;
  padding-left: 38px;
}

input,
select,
textarea {
  min-height: 40px;
  padding: 0 12px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--surface);
  transition: border-color 0.15s, box-shadow 0.15s;
}
textarea {
  padding: 10px 12px;
  resize: vertical;
  min-height: 84px;
}
input::placeholder,
textarea::placeholder {
  color: var(--muted);
  opacity: 0.8;
}
input:hover,
select:hover,
textarea:hover {
  border-color: var(--muted);
}
input:focus,
select:focus,
textarea:focus {
  outline: none;
  border-color: var(--brand);
  box-shadow: 0 0 0 3px var(--brand-soft);
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.chip-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 34px;
  padding: 0 14px;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: var(--surface);
  font-size: 14px;
  font-weight: 600;
  color: var(--muted);
}
.chip-btn:hover {
  color: var(--ink);
  border-color: var(--muted);
}
.chip-btn.active {
  background: var(--brand);
  border-color: var(--brand);
  color: var(--brand-ink);
}
.chip-btn.active.late {
  background: var(--danger);
  border-color: var(--danger);
  color: #fff;
}
.sort {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--muted);
  font-size: 14px;
}
.sort select {
  min-height: 34px;
}
.result-count {
  margin-bottom: 12px;
  color: var(--muted);
  font-size: 14px;
  font-weight: 600;
}

.segmented {
  display: inline-flex;
  padding: 3px;
  gap: 2px;
  border: 1px solid var(--line);
  border-radius: 11px;
  background: var(--surface-2);
}
.segmented .seg {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 32px;
  padding: 0 14px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  font-weight: 700;
  color: var(--muted);
}
.segmented .seg:hover {
  color: var(--ink);
}
.segmented .seg.active {
  background: var(--surface);
  color: var(--ink);
  box-shadow: 0 1px 3px rgba(15, 27, 61, 0.15);
}
.segmented .seg.active.seg-low {
  background: var(--low);
  color: #fff;
}
.segmented .seg.active.seg-medium {
  background: var(--pending);
  color: #fff;
}
.segmented .seg.active.seg-high {
  background: var(--danger);
  color: #fff;
}
.field .segmented {
  display: flex;
}
.field .segmented .seg {
  flex: 1;
  justify-content: center;
}

/* ---------- badges ---------- */
.badge,
.chip {
  display: inline-flex;
  align-items: center;
  padding: 2px 10px;
  border-radius: 999px;
  font-size: 12.5px;
  font-weight: 700;
  white-space: nowrap;
}
.chip {
  background: var(--surface-2);
  border: 1px solid var(--line);
  color: var(--muted);
}
.badge-pending {
  background: var(--pending-soft);
  color: var(--pending-ink);
}
.badge-progress {
  background: var(--progress-soft);
  color: var(--progress-ink);
}
.badge-done {
  background: var(--done-soft);
  color: var(--done-ink);
}

.prio {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 700;
  color: var(--muted);
}
.prio-dot {
  width: 9px;
  height: 9px;
  border-radius: 3px;
  background: var(--low);
}
.prio-high {
  color: var(--danger-ink);
}
.prio-high .prio-dot {
  background: var(--danger);
}
.prio-medium .prio-dot {
  background: var(--pending);
}

.due {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
}
.due-calm {
  color: var(--muted);
}
.due-soon {
  color: var(--pending-ink);
}
.due-late {
  color: var(--danger);
}

.status-select {
  min-height: 32px;
  padding: 0 30px 0 12px;
  border: 0;
  border-radius: 999px;
  font-size: 13px;
  font-weight: 700;
  appearance: none;
  cursor: pointer;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1 1.5l5 5 5-5' fill='none' stroke='%23788' stroke-width='1.8' stroke-linecap='round'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 11px center;
}
.st-pending {
  background-color: var(--pending-soft);
  color: var(--pending-ink);
}
.st-progress {
  background-color: var(--progress-soft);
  color: var(--progress-ink);
}
.st-done {
  background-color: var(--done-soft);
  color: var(--done-ink);
}
.status-select option {
  background: var(--surface);
  color: var(--ink);
}

.avatar {
  display: inline-grid;
  flex: none;
  place-items: center;
  border-radius: 50%;
  font-weight: 800;
  background: hsl(var(--h) 78% 90%);
  color: hsl(var(--h) 55% 26%);
}
:root[data-theme="dark"] .avatar {
  background: hsl(var(--h) 38% 26%);
  color: hsl(var(--h) 85% 88%);
}
.assignee {
  white-space: nowrap;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
}
.row-actions {
  display: inline-flex;
  gap: 2px;
}

/* ---------- dashboard ---------- */
.dash {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.briefing {
  --progress: #7c97ff;
  --pending: #f0a93a;
  --done: #3ccfa8;
  --track: rgba(255, 255, 255, 0.14);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  padding: 28px 32px;
  border-radius: 20px;
  background: var(--rail);
  color: #fff;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.06);
}
.briefing-late {
  box-shadow: inset 5px 0 0 var(--danger), inset 0 0 0 1px rgba(255, 255, 255, 0.06);
}
.briefing-date {
  margin-bottom: 6px;
  color: #aab6dc;
  font-weight: 600;
}
.briefing h2 {
  font-size: 32px;
  font-weight: 800;
  letter-spacing: -0.025em;
  line-height: 1.15;
}
.briefing-text > p:not(.briefing-date) {
  margin-top: 8px;
  color: #c5cef0;
  max-width: 46ch;
}
.briefing-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 20px;
}
.briefing .btn:not(.btn-primary) {
  background: rgba(255, 255, 255, 0.1);
  border-color: rgba(255, 255, 255, 0.28);
  color: #fff;
}
.briefing .btn:not(.btn-primary):hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.18);
  border-color: rgba(255, 255, 255, 0.5);
}
.briefing .btn-primary {
  background: #4d6bff;
  border-color: #4d6bff;
  color: #fff;
}
.briefing :focus-visible {
  outline-color: #9fb2ff;
}
.ring {
  flex: none;
  margin: 0;
  width: 168px;
}
.ring svg {
  display: block;
  width: 100%;
  height: auto;
}
.ring-value {
  font-size: 30px;
  font-weight: 800;
  fill: #fff;
}
.ring-label {
  font-size: 11px;
  font-weight: 600;
  fill: #aab6dc;
}

.tiles {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 14px;
}
.tile {
  --tone: var(--brand);
  --tone-soft: var(--brand-soft);
  display: grid;
  grid-template-columns: auto 1fr;
  grid-template-areas: "icon value" "label label";
  align-items: center;
  column-gap: 12px;
  row-gap: 6px;
  padding: 16px 18px;
  border: 1px solid var(--line);
  border-radius: 14px;
  background: var(--surface);
  text-align: left;
  transition: border-color 0.15s, transform 0.15s;
}
.tile:hover {
  border-color: var(--tone);
  transform: translateY(-2px);
}
.tile-done {
  --tone: var(--done);
  --tone-soft: var(--done-soft);
}
.tile-progress {
  --tone: var(--progress);
  --tone-soft: var(--progress-soft);
}
.tile-pending {
  --tone: var(--pending);
  --tone-soft: var(--pending-soft);
}
.tile-icon {
  grid-area: icon;
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  border-radius: 11px;
  background: var(--tone-soft);
  color: var(--tone);
}
.tile-value {
  grid-area: value;
  font-size: 32px;
  font-weight: 800;
  letter-spacing: -0.02em;
  line-height: 1;
}
.tile-label {
  grid-area: label;
  color: var(--muted);
  font-weight: 600;
  font-size: 14px;
}

.dash-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.75fr) minmax(0, 1fr);
  gap: 18px;
}
.panel {
  min-width: 0;
  padding: 20px 22px;
  border: 1px solid var(--line);
  border-radius: 16px;
  background: var(--surface);
}
.panel-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 14px;
}
.panel-head h2 {
  font-size: 17px;
  font-weight: 800;
  letter-spacing: -0.01em;
}
.panel-note {
  color: var(--muted);
  font-size: 13px;
}
.panel-empty {
  padding: 24px 0;
  color: var(--muted);
}

.chart svg {
  display: block;
  width: 100%;
  height: auto;
  overflow: visible;
}
.grid-line {
  stroke: var(--line);
  stroke-dasharray: 2 5;
}
.axis {
  fill: var(--muted);
  font-size: 11.5px;
  font-weight: 600;
}
.axis-today {
  fill: var(--brand);
  font-weight: 800;
}
.today-line {
  stroke: var(--brand);
  stroke-width: 1.5;
  stroke-dasharray: 3 4;
  opacity: 0.55;
}
.dot {
  fill: var(--surface);
  stroke: var(--brand);
  stroke-width: 2.5;
  transition: r 0.12s;
}
.tip {
  fill: var(--tip-bg);
}
.tip-title {
  fill: var(--tip-ink);
  font-size: 12px;
  font-weight: 800;
}
.tip-text {
  fill: var(--tip-ink);
  font-size: 11.5px;
  opacity: 0.85;
}
.chart-note {
  margin-top: 8px;
  color: var(--muted);
  font-size: 13px;
}

.attention {
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 0;
  list-style: none;
}
.attention li {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 11px 0;
  border-top: 1px solid var(--line);
}
.attention li:first-child {
  border-top: 0;
}
.attention-main {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  line-height: 1.3;
}
.attention-main strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.attention-main span {
  color: var(--muted);
  font-size: 13px;
}
.attention-side {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
}

.legend {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 14px;
  font-size: 13px;
  color: var(--muted);
  font-weight: 600;
}
.legend-item::before {
  content: "";
  display: inline-block;
  width: 10px;
  height: 10px;
  margin-right: 6px;
  border-radius: 3px;
  background: var(--tone);
}
.legend-item.done {
  --tone: var(--done);
}
.legend-item.progress {
  --tone: var(--progress);
}
.legend-item.pending {
  --tone: var(--pending);
}

.workload,
.priority-bars {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.workload li {
  display: grid;
  grid-template-columns: minmax(120px, 190px) 1fr 28px;
  align-items: center;
  gap: 14px;
}
.priority-bars li {
  display: grid;
  grid-template-columns: 84px 1fr 28px;
  align-items: center;
  gap: 12px;
}
.workload-name {
  display: flex;
  align-items: center;
  gap: 9px;
  font-weight: 600;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.workload-total {
  text-align: right;
  font-weight: 800;
}
.bar {
  display: flex;
  height: 12px;
  border-radius: 999px;
  background: var(--track);
  overflow: hidden;
}
.bar > span {
  display: block;
  height: 100%;
  transition: width 0.5s ease;
}
.seg-done {
  background: var(--done);
}
.seg-progress {
  background: var(--progress);
}
.seg-pending {
  background: var(--pending);
}
.fill-high {
  background: var(--danger);
}
.fill-medium {
  background: var(--pending);
}
.fill-low {
  background: var(--low);
}

/* ---------- employees ---------- */
.people-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(290px, 1fr));
  gap: 16px;
}
.person {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 18px;
  border: 1px solid var(--line);
  border-radius: 16px;
  background: var(--surface);
  transition: border-color 0.15s;
}
.person:hover {
  border-color: var(--muted);
}
.person header {
  display: flex;
  align-items: center;
  gap: 12px;
}
.person-id {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
}
.person-id h3 {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 16px;
  font-weight: 800;
}
.person-mail {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--muted);
  font-size: 14px;
  text-decoration: none;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.person-mail:hover {
  color: var(--brand);
}
.person-stats {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  margin: 0;
}
.person-stats div {
  padding: 10px 12px;
  border-radius: 11px;
  background: var(--surface-2);
}
.person-stats dt {
  color: var(--muted);
  font-size: 12.5px;
  font-weight: 600;
}
.person-stats dd {
  margin: 0;
  font-size: 22px;
  font-weight: 800;
  line-height: 1.2;
}
.person-stats .late {
  background: var(--danger-soft);
}
.person-stats .late dt,
.person-stats .late dd {
  color: var(--danger-ink);
}
.person .btn-ghost {
  justify-content: flex-start;
  padding: 0 8px;
  margin-top: auto;
}

/* ---------- board ---------- */
.board {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
  align-items: start;
}
.column {
  --tone: var(--pending);
  padding: 12px;
  border: 2px solid transparent;
  border-radius: 16px;
  background: var(--surface-2);
  transition: border-color 0.15s, background 0.15s;
}
.col-progress {
  --tone: var(--progress);
}
.col-done {
  --tone: var(--done);
}
.column.drop {
  border-color: var(--tone);
  background: var(--surface);
}
.column-head {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 4px 6px 12px;
}
.column-head h3 {
  font-size: 15px;
  font-weight: 800;
}
.column-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--tone);
}
.count {
  margin-left: auto;
  min-width: 26px;
  padding: 1px 8px;
  border-radius: 999px;
  background: var(--surface);
  border: 1px solid var(--line);
  text-align: center;
  font-size: 13px;
  font-weight: 800;
  color: var(--muted);
}
.column-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 96px;
}
.column-empty {
  padding: 26px 12px;
  border: 1.5px dashed var(--line);
  border-radius: 12px;
  text-align: center;
  color: var(--muted);
  font-size: 14px;
}

.card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 14px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--surface);
  cursor: grab;
  transition: border-color 0.15s, transform 0.15s, opacity 0.15s;
}
.card:hover {
  border-color: var(--muted);
  transform: translateY(-1px);
}
.card:active {
  cursor: grabbing;
}
.card.dragging {
  opacity: 0.45;
}
.card-late {
  box-shadow: inset 3px 0 0 var(--danger);
}
.card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.card h4 {
  font-size: 15px;
  font-weight: 800;
  line-height: 1.3;
}
.card-text {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  color: var(--muted);
  font-size: 13.5px;
}
.card footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.move {
  display: none; /* shown below on touch screens, where dragging is awkward */
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--line);
  color: var(--muted);
  font-size: 13px;
}

@media (hover: none), (max-width: 860px) {
  .move {
    display: flex;
  }
}

/* ---------- list view ---------- */
.table-wrap {
  overflow-x: auto;
  border: 1px solid var(--line);
  border-radius: 16px;
  background: var(--surface);
}
.table {
  width: 100%;
  border-collapse: collapse;
}
.table th {
  padding: 12px 16px;
  border-bottom: 1px solid var(--line);
  background: var(--surface-2);
  text-align: left;
  font-size: 13px;
  font-weight: 700;
  color: var(--muted);
}
.table td {
  padding: 12px 16px;
  border-bottom: 1px solid var(--line);
  vertical-align: middle;
}
.table tr:last-child td {
  border-bottom: 0;
}
.table tbody tr:hover {
  background: var(--surface-2);
}
.row-late td:first-child {
  box-shadow: inset 3px 0 0 var(--danger);
}
.task-title {
  display: block;
  font-weight: 800;
}
.task-desc {
  display: block;
  max-width: 44ch;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--muted);
  font-size: 13.5px;
}
.actions-cell {
  text-align: right;
  white-space: nowrap;
}

/* ---------- states ---------- */
.stack {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.skeleton {
  border-radius: 14px;
  background: linear-gradient(100deg, var(--track) 30%, var(--surface-2) 50%, var(--track) 70%);
  background-size: 300% 100%;
  animation: shimmer 1.4s linear infinite;
}
.tiles .skeleton,
.board .skeleton,
.people-grid .skeleton {
  width: 100%;
}
@keyframes shimmer {
  from {
    background-position: 100% 0;
  }
  to {
    background-position: 0 0;
  }
}

.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 56px 20px;
  border: 1.5px dashed var(--line);
  border-radius: 16px;
  text-align: center;
}
.empty h3 {
  font-size: 18px;
  font-weight: 800;
}
.empty p {
  max-width: 44ch;
  color: var(--muted);
}
.empty .btn {
  margin-top: 8px;
}
.empty-art {
  position: relative;
  width: 92px;
  height: 64px;
  margin-bottom: 6px;
}
.empty-art span {
  position: absolute;
  left: 0;
  right: 0;
  height: 18px;
  border-radius: 7px;
  background: var(--surface-2);
  border: 1px solid var(--line);
}
.empty-art span:nth-child(1) {
  top: 0;
  left: 12px;
  right: 18px;
}
.empty-art span:nth-child(2) {
  top: 22px;
  background: var(--brand-soft);
  border-color: transparent;
}
.empty-art span:nth-child(3) {
  top: 44px;
  left: 20px;
  right: 8px;
}

.notice {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  margin-bottom: 14px;
  border-radius: 12px;
  font-weight: 600;
}
.notice-error {
  background: var(--danger-soft);
  color: var(--danger-ink);
}
.notice .btn {
  margin-left: auto;
}

/* ---------- dialogs and forms ---------- */
.backdrop {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: grid;
  place-items: center;
  padding: 16px;
  background: rgba(7, 12, 31, 0.55);
  animation: fade 0.15s ease;
}
.modal {
  width: 100%;
  max-height: calc(100vh - 32px);
  overflow-y: auto;
  border: 1px solid var(--line);
  border-radius: 18px;
  background: var(--surface);
  box-shadow: var(--shadow);
  animation: pop 0.18s ease;
}
.modal-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18px 22px 6px;
}
.modal-head h2 {
  font-size: 20px;
  font-weight: 800;
  letter-spacing: -0.01em;
}
.modal-body {
  padding: 12px 22px 8px;
}
.modal-foot {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 14px 22px 20px;
}
.form-grid {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.form-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}
.field-label {
  font-size: 14px;
  font-weight: 700;
}
.field-hint {
  color: var(--muted);
  font-size: 13px;
}
.field-error {
  color: var(--danger);
  font-size: 13px;
  font-weight: 600;
}
.has-error input,
.has-error select,
.has-error textarea {
  border-color: var(--danger);
}
.modal .notice {
  margin-bottom: 0;
}

.toasts {
  position: fixed;
  right: 20px;
  bottom: 20px;
  z-index: 60;
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-width: min(420px, calc(100vw - 32px));
}
.toast {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 12px 12px 14px;
  border-radius: 12px;
  background: var(--tip-bg);
  color: var(--tip-ink);
  box-shadow: var(--shadow);
  animation: pop 0.2s ease;
}
.toast .icon {
  color: var(--done);
}
.toast-error .icon {
  color: var(--danger);
}
.toast-text {
  flex: 1;
  font-weight: 600;
  font-size: 14px;
}
.toast-action {
  padding: 4px 10px;
  border: 0;
  border-radius: 8px;
  background: rgba(127, 140, 190, 0.28);
  color: inherit;
  font-weight: 800;
}
.toast-close {
  display: grid;
  place-items: center;
  padding: 4px;
  border: 0;
  background: transparent;
  color: inherit;
  opacity: 0.65;
}
.toast-close:hover {
  opacity: 1;
}

@keyframes fade {
  from {
    opacity: 0;
  }
}
@keyframes pop {
  from {
    opacity: 0;
    transform: translateY(8px) scale(0.98);
  }
}

/* ---------- smaller screens ---------- */
@media (max-width: 1060px) {
  .dash-grid {
    grid-template-columns: minmax(0, 1fr);
  }
  .board {
    grid-template-columns: minmax(0, 1fr);
  }
}

@media (max-width: 860px) {
  .app {
    grid-template-columns: minmax(0, 1fr);
  }
  .rail {
    position: fixed;
    inset: auto 0 0 0;
    z-index: 40;
    height: auto;
    flex-direction: row;
    gap: 0;
    padding: 8px 10px calc(8px + env(safe-area-inset-bottom));
  }
  .brand,
  .rail-foot {
    display: none;
  }
  .nav {
    flex: 1;
    flex-direction: row;
    justify-content: space-around;
  }
  .nav-item {
    flex-direction: column;
    gap: 2px;
    padding: 6px 18px;
    font-size: 12px;
  }
  .nav-item.active {
    box-shadow: none;
  }
  .topbar {
    padding: 18px 16px 4px;
  }
  .topbar h1 {
    font-size: 23px;
  }
  .content {
    padding: 14px 16px 96px;
  }
  .toasts {
    right: 16px;
    bottom: 84px;
  }
  .briefing {
    flex-direction: column-reverse;
    align-items: flex-start;
    padding: 22px;
  }
  .briefing h2 {
    font-size: 26px;
  }
  .ring {
    width: 130px;
  }
  .workload li {
    grid-template-columns: minmax(90px, 130px) 1fr 24px;
    gap: 10px;
  }
  .form-row {
    grid-template-columns: 1fr;
  }
  .search {
    max-width: none;
    flex-basis: 100%;
  }

  /* the table turns into stacked cards */
  .table thead {
    display: none;
  }
  .table,
  .table tbody,
  .table tr,
  .table td {
    display: block;
    width: 100%;
  }
  .table tr {
    padding: 10px 6px;
    border-bottom: 1px solid var(--line);
  }
  .table tr:last-child {
    border-bottom: 0;
  }
  .table td {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 6px 12px;
    border: 0;
  }
  .table td[data-label]::before {
    content: attr(data-label);
    color: var(--muted);
    font-size: 13px;
    font-weight: 600;
  }
  .table td:first-child {
    display: block;
  }
  .table td:first-child::before {
    display: none;
  }
  .task-desc {
    max-width: none;
    white-space: normal;
  }
  .row-late td:first-child {
    box-shadow: none;
  }
  .row-late {
    box-shadow: inset 3px 0 0 var(--danger);
  }
  .actions-cell {
    justify-content: flex-end;
  }
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
````

---

## Step 17: Run it

**Terminal 1: backend** (from the project root)

```
cd backend
..\venv\Scripts\activate
$env:DATABASE_URL="YOUR-NEON-STRING"
python -m uvicorn main:app --reload --port 8000
```

Wait for `Database ready.` If your prompt already shows `(venv)`, skip the activate line.

**Terminal 2: frontend**

```
cd frontend
npm run dev
```

No `npm install` is needed. Open http://localhost:5173

## Step 18: Test before you push

1. Dashboard shows numbers and the graph.
2. Add an employee, then create a task for them.
3. Drag the task card to **In Progress**.
4. Edit the task. Delete it, then click **Undo**.
5. Click the moon button (dark mode). Refresh. Everything is still there.

## Step 19: Push the branch and check the Vercel preview

```
git add .
git commit -m "Upgrade UI and features"
git push -u origin upgrade-ui
```

Vercel builds a preview link for this branch (Vercel, Deployments, branch `upgrade-ui`). Test it the same way. Your submitted link on `main` does not change yet.

## Step 20: Go live (only when the preview works)

```
git checkout main
git merge upgrade-ui
git push
```

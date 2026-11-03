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
"""Employee Task Tracker: FastAPI backend.

Run:  python -m uvicorn main:app --reload --port 8000
Docs: http://localhost:8000/docs   (Swagger UI: try every API from the browser)
"""
import os
from contextlib import asynccontextmanager
from datetime import date
from typing import Literal

import psycopg2
from psycopg2 import errors
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict, Field

import db

@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        db.init_db()
    except psycopg2.OperationalError as error:
        print("\nCould not connect to PostgreSQL. Check that DATABASE_URL is set correctly.")
        print(f"\nDetails: {error}")
        raise
    print("Database ready.")
    yield


app = FastAPI(title="Employee Task Tracker API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("ALLOWED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)


class EmployeeIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    name: str = Field(min_length=2, max_length=100)
    email: str = Field(max_length=150, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    department: str = Field(min_length=2, max_length=100)


class TaskIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    title: str = Field(min_length=3, max_length=150)
    description: str = Field(default="", max_length=1000)
    priority: Literal["Low", "Medium", "High"] = "Medium"
    due_date: date
    employee_id: int


class StatusIn(BaseModel):
    status: Literal["Pending", "In Progress", "Completed"]


TASK_WITH_EMPLOYEE = """
    SELECT t.id, t.title, t.description, t.priority, t.status, t.due_date,
           t.employee_id, e.name AS employee_name
    FROM tasks t
    JOIN employees e ON e.id = t.employee_id
"""


@app.get("/")
def home():
    return {"message": "Employee Task Tracker API is running. Open /docs to try it."}


@app.get("/employees")
def list_employees():
    return db.run(
        """
        SELECT e.id, e.name, e.email, e.department,
               (SELECT COUNT(*) FROM tasks t WHERE t.employee_id = e.id)::int AS task_count
        FROM employees e
        ORDER BY e.id
        """
    )


@app.post("/employees", status_code=201)
def add_employee(employee: EmployeeIn):
    try:
        return db.run(
            """
            INSERT INTO employees (name, email, department)
            VALUES (%s, %s, %s)
            RETURNING id, name, email, department, 0 AS task_count
            """,
            (employee.name, employee.email, employee.department),
            fetch="one",
        )
    except errors.UniqueViolation:
        raise HTTPException(409, "An employee with this email already exists.")


@app.delete("/employees/{employee_id}")
def delete_employee(employee_id: int):
    row = db.run("DELETE FROM employees WHERE id = %s RETURNING id", (employee_id,), fetch="one")
    if row is None:
        raise HTTPException(404, "Employee not found.")
    return {"deleted": employee_id}  # their tasks are removed too (ON DELETE CASCADE)


@app.get("/tasks")
def list_tasks():
    return db.run(TASK_WITH_EMPLOYEE + " ORDER BY t.id DESC")


@app.post("/tasks", status_code=201)
def add_task(task: TaskIn):
    try:
        created = db.run(
            """
            INSERT INTO tasks (title, description, priority, due_date, employee_id)
            VALUES (%s, %s, %s, %s, %s)
            RETURNING id
            """,
            (task.title, task.description, task.priority, task.due_date, task.employee_id),
            fetch="one",
        )
    except errors.ForeignKeyViolation:
        raise HTTPException(400, "That employee does not exist.")
    return db.run(TASK_WITH_EMPLOYEE + " WHERE t.id = %s", (created["id"],), fetch="one")


@app.patch("/tasks/{task_id}/status")
def update_task_status(task_id: int, body: StatusIn):
    row = db.run("UPDATE tasks SET status = %s WHERE id = %s RETURNING id", (body.status, task_id), fetch="one")
    if row is None:
        raise HTTPException(404, "Task not found.")
    return db.run(TASK_WITH_EMPLOYEE + " WHERE t.id = %s", (task_id,), fetch="one")


@app.get("/dashboard")
def dashboard():
    return db.run(
        """
        SELECT
            (SELECT COUNT(*) FROM employees)::int                          AS total_employees,
            COUNT(*)::int                                                  AS total_tasks,
            COUNT(*) FILTER (WHERE status = 'Completed')::int              AS completed_tasks,
            COUNT(*) FILTER (WHERE status = 'Pending')::int                AS pending_tasks,
            COUNT(*) FILTER (WHERE status = 'In Progress')::int            AS in_progress_tasks
        FROM tasks
        """,
        fetch="one",
    )
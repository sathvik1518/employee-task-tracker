# Employee Task Tracker

A web app to manage employees and assign tasks to them. All data is stored in a PostgreSQL database.

Live app: https://employee-task-tracker-omega-eight.vercel.app

# Features
- Employees: add (name, email, department), list, delete
- Tasks: create (title, description, priority, due date), assign to an employee, list with the employee name, update status (Pending, In Progress, Completed)
- Dashboard: total employees, total tasks, completed and pending counts
- Bonus: search by employee name, filter tasks by status

# Tech stack
- Frontend: React (Vite)
- Backend: Python FastAPI
- Database: PostgreSQL (Neon)
- Hosting: Vercel

# Database
- employees: id, name, email (unique), department
- tasks: id, title, description, priority, status, due_date, employee_id (foreign key to employees)

Deleting an employee also deletes their tasks. The tables are created automatically from backend/schema.sql.

# API
- GET /employees: list employees
- POST /employees: add an employee
- DELETE /employees/{id}: delete an employee
- GET /tasks: list tasks with the employee name
- POST /tasks: create and assign a task
- PATCH /tasks/{id}/status: update task status
- GET /dashboard: dashboard counts

On the live site each path starts with /api.

# Run locally
Backend:

    cd backend
    python -m venv venv
    venv\Scripts\activate
    python -m pip install -r requirements.txt
    $env:DATABASE_URL="your-postgresql-connection-string"
    python -m uvicorn main:app --reload --port 8000

Frontend (second terminal):

    cd frontend
    npm install
    npm run dev

Open http://localhost:5173. API docs: http://localhost:8000/docs
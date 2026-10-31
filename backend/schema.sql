CREATE TABLE IF NOT EXISTS employees (
    id          SERIAL PRIMARY KEY,
    name        VARCHAR(100) NOT NULL,
    email       VARCHAR(150) NOT NULL UNIQUE,
    department  VARCHAR(100) NOT NULL,
    created_at  TIMESTAMP DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tasks (
    id           SERIAL PRIMARY KEY,
    title        VARCHAR(150) NOT NULL,
    description  TEXT NOT NULL DEFAULT '',
    priority     VARCHAR(10) NOT NULL DEFAULT 'Medium'
                 CHECK (priority IN ('Low', 'Medium', 'High')),
    status       VARCHAR(20) NOT NULL DEFAULT 'Pending'
                 CHECK (status IN ('Pending', 'In Progress', 'Completed')),
    due_date     DATE NOT NULL,
    employee_id  INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    created_at   TIMESTAMP DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tasks_employee ON tasks(employee_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status   ON tasks(status);
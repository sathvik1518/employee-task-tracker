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
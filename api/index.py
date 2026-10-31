"""Vercel entry point: serves the backend under /api."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

from fastapi import FastAPI

import db
import main as backend

db.init_db()  

app = FastAPI()
app.mount("/api", backend.app)
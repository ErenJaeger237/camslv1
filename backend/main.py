"""
CamSL Translator — FastAPI backend.

Runs alongside the React frontend (served separately via Vite dev server
or static build). CORS is open during development; restrict to your
Vercel domain in production by setting the ALLOWED_ORIGIN env var.

Start:  uvicorn backend.main:app --reload --port 8000
"""

import os
from pathlib import Path
from fastapi import FastAPI

# Load .env from project root if present (keeps secrets out of shell history)
try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).resolve().parents[1] / ".env")
except ImportError:
    pass
from fastapi.middleware.cors import CORSMiddleware

from .routes import auth, chat, practice, autocomplete, contributions, retrain
from . import db_users

app = FastAPI(title="CamSL API", version="2.0.0")

ALLOWED_ORIGIN = os.environ.get("ALLOWED_ORIGIN", "*")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[ALLOWED_ORIGIN],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

db_users.init()

app.include_router(auth.router, prefix="/api")
app.include_router(chat.router, prefix="/api")
app.include_router(practice.router, prefix="/api")
app.include_router(autocomplete.router, prefix="/api")
app.include_router(contributions.router, prefix="/api")
app.include_router(retrain.router, prefix="/api")


@app.get("/health")
def health():
    return {"status": "ok", "version": "2.0.0"}

import os
import sqlite3
from pathlib import Path
from fastapi import FastAPI, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from app.config import OPENROUTER_API_KEY, PORT
from app.database import init_db, db_session
from app.auth import get_current_user
from app.rag import get_model_status
from app.routes import auth, chat, documents, settings, security, usage

app = FastAPI(title="Agnostic AI Platform (LightRAG Monolith)")

# Setup CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Startup Database Init
@app.on_event("startup")
def startup_event():
    init_db()

# Include API Routers
app.include_router(auth.router)
app.include_router(chat.router)
app.include_router(documents.router)
app.include_router(settings.router)
app.include_router(security.router)
app.include_router(usage.router)

@app.get("/api/status")
def get_system_status(user: dict = Depends(get_current_user)):
    database_ok = False
    try:
        with db_session() as conn:
            conn.execute("SELECT 1").fetchone()
        database_ok = True
    except Exception:
        database_ok = False

    openrouter_ok = bool(OPENROUTER_API_KEY)
    # Embedding is always ready because we wrap it via either openrouter or gemini automatically
    embedding_ok = database_ok and openrouter_ok

    return {
        "database": database_ok,
        "db": database_ok,
        "openRouter": openrouter_ok,
        "openrouter": openrouter_ok,
        "embedding": embedding_ok,
        "models": get_model_status()
    }

@app.get("/health")
def health_check():
    return {"status": "ok"}

# Catch-all handler for SPA and Static Files serving
@app.get("/{path_name:path}")
async def catch_all(path_name: str):
    static_dir = Path(__file__).resolve().parent.parent / "static"
    
    # Do not fallback to index.html for API paths
    if path_name.startswith("api/"):
        raise HTTPException(status_code=404, detail="Not Found")
        
    # Check if path corresponds to a static file
    file_path = static_dir / path_name
    if file_path.is_file():
        return FileResponse(file_path)
        
    # Fallback to index.html for routing (SPA)
    index_path = static_dir / "index.html"
    if index_path.is_file():
        return FileResponse(index_path)
        
    raise HTTPException(status_code=404, detail="Index file not found")

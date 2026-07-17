import os
from pathlib import Path
from dotenv import load_dotenv

# Load environment variables from .env
load_dotenv()

BASE_DIR = Path(__file__).resolve().parent.parent

OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY", "")
JWT_SECRET = os.getenv("JWT_SECRET", "supersecret")
PORT = int(os.getenv("PORT", "3101"))
ENABLE_TOPIC_HARDENING = os.getenv("ENABLE_TOPIC_HARDENING", "true").lower() == "true"

EMBEDDING_PROVIDER = os.getenv("EMBEDDING_PROVIDER", "openrouter")
EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "nvidia/llama-nemotron-embed-vl-1b-v2:free")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
EMBEDDING_API_KEY = os.getenv("EMBEDDING_API_KEY", "")
try:
    EMBEDDING_DIM = int(os.getenv("EMBEDDING_DIM", "0"))
except ValueError:
    EMBEDDING_DIM = 0


# Storage paths
DATABASE_PATH = BASE_DIR / "database.sqlite"
RAG_DIR = BASE_DIR / "data" / "rag"

# Create directories if they don't exist
RAG_DIR.mkdir(parents=True, exist_ok=True)

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
db_path_env = os.getenv("DATABASE_PATH")
if db_path_env:
    DATABASE_PATH = Path(db_path_env)
elif (BASE_DIR / "database.sqlite").is_file():
    DATABASE_PATH = BASE_DIR / "database.sqlite"
else:
    DATABASE_PATH = BASE_DIR / "data" / "database.sqlite"

RAG_DIR = BASE_DIR / "data" / "rag"

# Create directories if they don't exist
DATABASE_PATH.parent.mkdir(parents=True, exist_ok=True)
RAG_DIR.mkdir(parents=True, exist_ok=True)

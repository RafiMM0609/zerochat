import uvicorn
from app.config import PORT

def main():
    print(f"[Monolith] Starting FastAPI backend on port {PORT}...")
    uvicorn.run("app.main:app", host="0.0.0.0", port=PORT, reload=True)

if __name__ == "__main__":
    main()

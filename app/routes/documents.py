import hashlib
import io
import json
import pandas as pd
import asyncio
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Request
from fastapi.responses import StreamingResponse
from pypdf import PdfReader
from app.auth import get_current_user
from app.database import db_session
from app.rag import get_user_rag

router = APIRouter(prefix="/api/documents", tags=["documents"])

class DocumentEventManager:
    def __init__(self):
        self._listeners = {}  # user_id -> set of asyncio.Queue

    def subscribe(self, user_id: int) -> asyncio.Queue:
        if user_id not in self._listeners:
            self._listeners[user_id] = set()
        queue = asyncio.Queue()
        self._listeners[user_id].add(queue)
        return queue

    def unsubscribe(self, user_id: int, queue: asyncio.Queue):
        if user_id in self._listeners:
            self._listeners[user_id].discard(queue)
            if not self._listeners[user_id]:
                del self._listeners[user_id]

    async def broadcast(self, user_id: int, message: dict):
        if user_id in self._listeners:
            for q in list(self._listeners[user_id]):
                await q.put(message)

doc_event_manager = DocumentEventManager()

ALLOWED_EXTENSIONS = {"pdf", "txt", "csv", "md", "markdown", "json", "jsonl", "xlsx", "xls"}

def parse_file_to_text(file_bytes: bytes, filename: str, mime_type: str) -> str:
    ext = filename.split(".")[-1].lower() if "." in filename else ""
    
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type. Allowed types: PDF, TXT, MD, CSV, JSON, XLSX."
        )
        
    try:
        if ext == "pdf" or mime_type == "application/pdf":
            reader = PdfReader(io.BytesIO(file_bytes))
            text = ""
            for page in reader.pages:
                t = page.extract_text()
                if t:
                    text += t + "\n"
            return text.strip()
            
        elif ext in {"xlsx", "xls"} or mime_type in {
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "application/vnd.ms-excel"
        }:
            df = pd.read_excel(io.BytesIO(file_bytes))
            lines = []
            for _, row in df.iterrows():
                row_str = " ".join([str(val).strip() for val in row.values if pd.notna(val)])
                if row_str:
                    lines.append(row_str)
            return "\n".join(lines).strip()
            
        elif ext == "csv" or mime_type == "text/csv":
            df = pd.read_csv(io.BytesIO(file_bytes))
            lines = []
            for _, row in df.iterrows():
                row_str = " ".join([str(val).strip() for val in row.values if pd.notna(val)])
                if row_str:
                    lines.append(row_str)
            return "\n".join(lines).strip()
            
        elif ext in {"json", "jsonl"} or mime_type == "application/json":
            content_str = file_bytes.decode("utf-8")
            try:
                # Try single JSON object
                data = json.loads(content_str)
                return json.dumps(data, indent=2)
            except Exception:
                # Try JSONLines (JSONL)
                lines = []
                for line in content_str.splitlines():
                    if line.strip():
                        try:
                            val = json.loads(line)
                            lines.append(json.dumps(val))
                        except Exception:
                            lines.append(line)
                return "\n".join(lines).strip()
                
        else: # Markdown or plain text
            return file_bytes.decode("utf-8", errors="ignore").strip()
            
    except Exception as e:
        print(f"[Parser] Failed to parse document {filename}:", e)
        raise HTTPException(status_code=400, detail=f"Error parsing document: {str(e)}")

async def process_indexing_task(db_doc_id: int, user_id: int, parsed_text: str, doc_id: str, filename: str):
    try:
        rag = await get_user_rag(user_id)
        await rag.ainsert(parsed_text, ids=doc_id, file_paths=filename)
        with db_session() as conn:
            conn.execute(
                "UPDATE documents SET status = 'completed', error_message = NULL WHERE id = ?",
                (db_doc_id,)
            )
        print(f"[RAG Background] Successfully indexed document {db_doc_id} ({filename})")
        await doc_event_manager.broadcast(user_id, {
            "type": "doc_updated",
            "documentId": db_doc_id,
            "status": "completed",
            "filename": filename
        })
    except Exception as e:
        print(f"[RAG Background] Failed to index document {db_doc_id} ({filename}):", e)
        err_msg = str(e)
        with db_session() as conn:
            conn.execute(
                "UPDATE documents SET status = 'failed', error_message = ? WHERE id = ?",
                (err_msg, db_doc_id)
            )
        await doc_event_manager.broadcast(user_id, {
            "type": "doc_updated",
            "documentId": db_doc_id,
            "status": "failed",
            "filename": filename,
            "error": err_msg
        })

@router.get("/stream")
async def stream_document_events(request: Request, user: dict = Depends(get_current_user)):
    user_id = user['id']
    queue = doc_event_manager.subscribe(user_id)
    
    async def event_generator():
        try:
            while True:
                if await request.is_disconnected():
                    break
                try:
                    data = await asyncio.wait_for(queue.get(), timeout=15.0)
                    yield f"data: {json.dumps(data)}\n\n"
                except asyncio.TimeoutError:
                    yield ": keep-alive\n\n"
        finally:
            doc_event_manager.unsubscribe(user_id, queue)
            
    return StreamingResponse(event_generator(), media_type="text/event-stream")

@router.get("")
def list_documents(user: dict = Depends(get_current_user)):
    with db_session() as conn:
        cursor = conn.execute("SELECT * FROM documents WHERE user_id = ?", (user['id'],))
        docs = cursor.fetchall()
    
    documents_list = []
    for doc in docs:
        status = doc["status"] if "status" in doc.keys() and doc["status"] else "completed"
        error_msg = doc["error_message"] if "error_message" in doc.keys() else None
        documents_list.append({
            "id": doc["id"],
            "user_id": doc["user_id"],
            "filename": doc["filename"],
            "file_type": doc["file_type"],
            "status": status,
            "error_message": error_msg,
            "created_at": doc["created_at"]
        })
    return {"documents": documents_list}

@router.get("/graph")
def get_knowledge_graph(user: dict = Depends(get_current_user)):
    import networkx as nx
    from app.config import RAG_DIR
    
    user_id = user['id']
    user_dir = RAG_DIR / f"user_{user_id}"
    graphml_path = user_dir / "graph_chunk_entity_relation.graphml"
    gml_path = user_dir / "graph.gml"
    
    g = None
    if graphml_path.exists():
        try:
            g = nx.read_graphml(str(graphml_path))
        except Exception as e:
            print("[Graph API] Error reading GraphML, trying GML fallback:", e)
            
    if g is None and gml_path.exists():
        try:
            g = nx.read_gml(str(gml_path))
        except Exception as e:
            print("[Graph API] Error reading GML:", e)
            
    if g is None:
        return {"nodes": [], "edges": []}
        
    try:
        nodes = []
        for node_id, data in g.nodes(data=True):
            nodes.append({
                "id": node_id,
                "label": node_id,
                "type": data.get("entity_type", "UNKNOWN"),
                "description": data.get("description", "")
            })
            
        edges = []
        for u, v, data in g.edges(data=True):
            edges.append({
                "source": u,
                "target": v,
                "weight": data.get("weight", 1.0),
                "description": data.get("description", "")
            })
            
        return {"nodes": nodes, "edges": edges}
    except Exception as e:
        print("[Graph API] Error reading GML/GraphML structure:", e)
        raise HTTPException(status_code=500, detail=f"Error reading knowledge graph: {str(e)}")

@router.post("/upload")
async def upload_document(
    file: UploadFile = File(...),
    user: dict = Depends(get_current_user)
):
    user_id = user['id']
    
    # Check document limit
    with db_session() as conn:
        cursor = conn.execute("SELECT COUNT(*) as count FROM documents WHERE user_id = ?", (user_id,))
        count = cursor.fetchone()["count"]
        if count >= 20:
            raise HTTPException(
                status_code=403,
                detail="Maximum document limit (20) reached. Please delete some documents before uploading new ones."
            )
            
    file_bytes = await file.read()
    filename = file.filename
    mime_type = file.content_type
    
    parsed_text = parse_file_to_text(file_bytes, filename, mime_type)
    if not parsed_text:
        raise HTTPException(status_code=400, detail="Empty document content.")
        
    # Calculate doc_id hash matching LightRAG MD5 logic
    md5_hash = hashlib.md5(parsed_text.encode("utf-8")).hexdigest()
    doc_id = f"doc-{md5_hash}"
    
    # Insert record into database with status 'processing'
    try:
        with db_session() as conn:
            cursor = conn.execute(
                "INSERT INTO documents (user_id, filename, file_type, doc_id, status) VALUES (?, ?, ?, ?, ?)",
                (user_id, filename, mime_type, doc_id, 'processing')
            )
            db_doc_id = cursor.lastrowid
    except Exception as e:
        if "UNIQUE" in str(e):
            raise HTTPException(status_code=400, detail="Document with identical content already uploaded.")
        raise HTTPException(status_code=500, detail="Failed to save document metadata.")
        
    # Spawn background task for LightRAG indexing
    asyncio.create_task(process_indexing_task(db_doc_id, user_id, parsed_text, doc_id, filename))
        
    return {
        "message": "Upload complete. Document indexing running in background.",
        "documentId": db_doc_id,
        "status": "processing"
    }

@router.delete("/{doc_db_id}")
async def delete_document(
    doc_db_id: int,
    user: dict = Depends(get_current_user)
):
    user_id = user['id']
    
    with db_session() as conn:
        cursor = conn.execute(
            "SELECT doc_id FROM documents WHERE id = ? AND user_id = ?",
            (doc_db_id, user_id)
        )
        doc = cursor.fetchone()
        
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found or unauthorized")
        
    doc_id = doc["doc_id"]
    
    # Remove from LightRAG storage
    try:
        rag = await get_user_rag(user_id)
        await rag.adelete_by_doc_id(doc_id)
    except Exception as e:
        print(f"[RAG] Failed to delete document {doc_id} from LightRAG storage: {e}")
        # Note: We proceed with deleting from database anyway to keep user synced
        
    # Remove from SQLite database
    with db_session() as conn:
        conn.execute("DELETE FROM documents WHERE id = ? AND user_id = ?", (doc_db_id, user_id))
        
    return {"message": "Document and all associated embeddings deleted successfully"}

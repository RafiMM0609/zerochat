import secrets
from fastapi import APIRouter, Depends, HTTPException, Body
from pydantic import BaseModel
from app.auth import get_current_user
from app.database import db_session
from app.security import verify_and_harden_persona
from app.rag import reset_user_vdb

router = APIRouter(prefix="/api/settings", tags=["settings"])

class PersonaUpdateSchema(BaseModel):
    system_prompt: str

@router.get("/persona")
def get_persona(user: dict = Depends(get_current_user)):
    user_id = user['id']
    with db_session() as conn:
        cursor = conn.execute("SELECT system_prompt FROM personas WHERE user_id = ?", (user_id,))
        result = cursor.fetchone()
        
    return {"system_prompt": result["system_prompt"] if result else ""}

@router.put("/persona")
async def update_persona(
    payload: PersonaUpdateSchema,
    user: dict = Depends(get_current_user)
):
    user_id = user['id']
    system_prompt = payload.system_prompt
    
    # Verify and harden persona prompt
    # Using generic IP for settings updates
    req_info = {'user_id': user_id, 'ip_address': '127.0.0.1'}
    harden_result = await verify_and_harden_persona(req_info, system_prompt)
    if not harden_result['allowed']:
        raise HTTPException(status_code=400, detail=harden_result['reason'])
        
    redacted_prompt = harden_result['redactedText']
    
    with db_session() as conn:
        conn.execute(
            "UPDATE personas SET system_prompt = ? WHERE user_id = ?",
            (redacted_prompt, user_id)
        )
        
    return {"message": "Persona updated successfully", "system_prompt": redacted_prompt}

@router.get("/api-keys")
def get_api_keys(user: dict = Depends(get_current_user)):
    user_id = user['id']
    with db_session() as conn:
        cursor = conn.execute("SELECT id, key, created_at FROM api_keys WHERE user_id = ?", (user_id,))
        keys = cursor.fetchall()
        
    return {
        "keys": [
            {"id": k["id"], "key": k["key"], "created_at": k["created_at"]}
            for k in keys
        ]
    }

@router.post("/api-keys")
def create_api_key(user: dict = Depends(get_current_user)):
    user_id = user['id']
    
    # Generate random key with prefix matching original
    key = "sk-agnostic-" + secrets.token_hex(24)
    
    with db_session() as conn:
        cursor = conn.execute("INSERT INTO api_keys (user_id, key) VALUES (?, ?)", (user_id, key))
        key_id = cursor.lastrowid
        
    return {"id": key_id, "key": key}

@router.delete("/api-keys/{key_id}")
def delete_api_key(key_id: int, user: dict = Depends(get_current_user)):
    user_id = user['id']
    
    with db_session() as conn:
        conn.execute("DELETE FROM api_keys WHERE id = ? AND user_id = ?", (key_id, user_id))
        
    return {"message": "Key deleted successfully"}

@router.post("/reset-vdb")
async def reset_vdb(user: dict = Depends(get_current_user)):
    user_id = user['id']
    try:
        await reset_user_vdb(user_id)
        return {"message": "Vector database reset successfully. It will be re-initialized on next request."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to reset vector database: {str(e)}")

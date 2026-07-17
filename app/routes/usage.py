from fastapi import APIRouter, Depends, Query
from app.auth import get_current_user
from app.database import db_session

router = APIRouter(prefix="/api/usage", tags=["usage"])

@router.get("/logs")
def get_usage_logs(
    limit: int = Query(50, ge=1, le=200),
    user: dict = Depends(get_current_user)
):
    user_id = user['id']
    with db_session() as conn:
        cursor = conn.execute(
            "SELECT id, chat_id, source, input_tokens, output_tokens, "
            "(input_tokens + output_tokens) as total_tokens, cost, created_at "
            "FROM usage_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT ?",
            (user_id, limit)
        )
        logs = cursor.fetchall()
        
    return {
        "logs": [
            {
                "id": l["id"],
                "chat_id": l["chat_id"],
                "source": l["source"],
                "input_tokens": l["input_tokens"],
                "output_tokens": l["output_tokens"],
                "total_tokens": l["total_tokens"],
                "cost": l["cost"],
                "created_at": l["created_at"]
            }
            for l in logs
        ]
    }

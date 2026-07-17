from fastapi import APIRouter, Depends, HTTPException
from app.auth import get_current_user
from app.database import db_session
from app.security import run_hermes_auditor

router = APIRouter(prefix="/api/security", tags=["security"])

@router.get("/logs")
def get_security_logs(user: dict = Depends(get_current_user)):
    user_id = user['id']
    with db_session() as conn:
        cursor = conn.execute(
            "SELECT id, event_type, details, severity, ip_address, created_at FROM security_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT 100",
            (user_id,)
        )
        logs = cursor.fetchall()
        
    return {
        "logs": [
            {
                "id": l["id"],
                "event_type": l["event_type"],
                "details": l["details"],
                "severity": l["severity"],
                "ip_address": l["ip_address"],
                "created_at": l["created_at"]
            }
            for l in logs
        ]
    }

@router.get("/stats")
def get_security_stats(user: dict = Depends(get_current_user)):
    user_id = user['id']
    import time
    try:
        with db_session() as conn:
            # 1. Total events
            cursor = conn.execute("SELECT COUNT(*) as count FROM security_logs WHERE user_id = ?", (user_id,))
            total_count = cursor.fetchone()["count"]
            
            # 2. Blocked attacks
            cursor = conn.execute(
                "SELECT COUNT(*) as count FROM security_logs WHERE user_id = ? AND event_type IN ('PROMPT_INJECTION', 'ABUSE_RATE_LIMIT', 'ABUSE_LENGTH')",
                (user_id,)
            )
            blocked_count = cursor.fetchone()["count"]
            
            # 3. PII redactions
            cursor = conn.execute(
                "SELECT COUNT(*) as count FROM security_logs WHERE user_id = ? AND event_type = 'PII_REDACTION'",
                (user_id,)
            )
            pii_count = cursor.fetchone()["count"]
            
            # 4. Severity stats
            cursor = conn.execute(
                "SELECT severity, COUNT(*) as count FROM security_logs WHERE user_id = ? GROUP BY severity",
                (user_id,)
            )
            severity_rows = cursor.fetchall()
            severity_stats = {"LOW": 0, "MEDIUM": 0, "HIGH": 0, "CRITICAL": 0}
            for row in severity_rows:
                sev = row["severity"]
                if sev in severity_stats:
                    severity_stats[sev] = row["count"]
                    
            # 5. Event type stats
            cursor = conn.execute(
                "SELECT event_type, COUNT(*) as count FROM security_logs WHERE user_id = ? GROUP BY event_type",
                (user_id,)
            )
            type_rows = cursor.fetchall()
            type_stats = {}
            for row in type_rows:
                type_stats[row["event_type"]] = row["count"]

            # 6. Active sessions (distinct IPs in the last 15 minutes)
            fifteen_minutes_ago = int(time.time()) - 15 * 60
            cursor = conn.execute(
                "SELECT COUNT(DISTINCT ip_address) as count FROM rate_limit_hits WHERE timestamp >= ?",
                (fifteen_minutes_ago,)
            )
            active_sessions = max(1, cursor.fetchone()["count"])

            # 7. API Calls 24h (total usage logs in last 24h)
            cursor = conn.execute(
                "SELECT COUNT(*) as count FROM usage_logs WHERE user_id = ? AND created_at >= datetime('now', '-1 day')",
                (user_id,)
            )
            api_calls_24h = cursor.fetchone()["count"]

            # 8. Document count
            cursor = conn.execute("SELECT COUNT(*) as count FROM documents WHERE user_id = ?", (user_id,))
            document_count = cursor.fetchone()["count"]
                
        return {
            "totalCount": total_count,
            "blockedCount": blocked_count,
            "piiCount": pii_count,
            "severityStats": severity_stats,
            "typeStats": type_stats,
            "activeSessions": active_sessions,
            "apiCalls24h": api_calls_24h,
            "documentCount": document_count
        }
    except Exception as e:
        print("[Security Stats Route] Error:", e)
        raise HTTPException(status_code=500, detail="Failed to retrieve security statistics")

@router.get("/rules")
def get_dynamic_rules(user: dict = Depends(get_current_user)):
    user_id = user['id']
    with db_session() as conn:
        cursor = conn.execute(
            "SELECT id, name, regex_pattern, severity, status, created_at FROM dynamic_security_rules WHERE user_id = ? ORDER BY created_at DESC",
            (user_id,)
        )
        rules = cursor.fetchall()
        
    return {
        "rules": [
            {
                "id": r["id"],
                "name": r["name"],
                "regex_pattern": r["regex_pattern"],
                "severity": r["severity"],
                "status": r["status"],
                "created_at": r["created_at"]
            }
            for r in rules
        ]
    }

@router.post("/rules/audit")
async def trigger_hermes_audit(user: dict = Depends(get_current_user)):
    user_id = user['id']
    try:
        result = await run_hermes_auditor(user_id)
        return result
    except Exception as e:
        print("[Security Route] Error running Hermes Auditor:", e)
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/rules/{rule_id}/approve")
def approve_dynamic_rule(rule_id: int, user: dict = Depends(get_current_user)):
    user_id = user['id']
    with db_session() as conn:
        cursor = conn.execute(
            "UPDATE dynamic_security_rules SET status = 'active' WHERE id = ? AND user_id = ?",
            (rule_id, user_id)
        )
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Rule not found")
            
    return {"success": True, "message": "Rule approved and activated."}

@router.post("/rules/{rule_id}/reject")
def reject_dynamic_rule(rule_id: int, user: dict = Depends(get_current_user)):
    user_id = user['id']
    with db_session() as conn:
        cursor = conn.execute(
            "UPDATE dynamic_security_rules SET status = 'rejected' WHERE id = ? AND user_id = ?",
            (rule_id, user_id)
        )
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Rule not found")
            
    return {"success": True, "message": "Rule rejected."}

@router.delete("/rules/{rule_id}")
def delete_dynamic_rule(rule_id: int, user: dict = Depends(get_current_user)):
    user_id = user['id']
    with db_session() as conn:
        cursor = conn.execute(
            "DELETE FROM dynamic_security_rules WHERE id = ? AND user_id = ?",
            (rule_id, user_id)
        )
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Rule not found")
            
    return {"success": True, "message": "Rule deleted."}

@router.get("/blocked-attacks")
def get_blocked_attacks(user: dict = Depends(get_current_user)):
    user_id = user['id']
    with db_session() as conn:
        cursor = conn.execute(
            "SELECT id, original_prompt, detected_via, created_at FROM blocked_attacks_metadata WHERE user_id = ? ORDER BY created_at DESC LIMIT 100",
            (user_id,)
        )
        attacks = cursor.fetchall()
        
    return {
        "attacks": [
            {
                "id": a["id"],
                "original_prompt": a["original_prompt"],
                "detected_via": a["detected_via"],
                "created_at": a["created_at"]
            }
            for a in attacks
        ]
    }

from datetime import datetime, timedelta, timezone
from fastapi import Depends, HTTPException, Security
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import jwt, JWTError
import bcrypt
from app.config import JWT_SECRET
from app.database import db_session

security = HTTPBearer(auto_error=False)

def hash_password(password: str) -> str:
    password_bytes = password.encode('utf-8')
    salt = bcrypt.gensalt()
    hashed = bcrypt.hashpw(password_bytes, salt)
    return hashed.decode('utf-8')

def verify_password(plain_password: str, hashed_password: str) -> bool:
    try:
        password_bytes = plain_password.encode('utf-8')
        hashed_bytes = hashed_password.encode('utf-8')
        return bcrypt.checkpw(password_bytes, hashed_bytes)
    except Exception:
        return False


def create_access_token(data: dict, expires_delta: timedelta = None) -> str:
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.now(timezone.utc) + expires_delta
    else:
        expire = datetime.now(timezone.utc) + timedelta(days=30)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, JWT_SECRET, algorithm="HS256")
    return encoded_jwt

def get_current_user(credentials: HTTPAuthorizationCredentials = Security(security)) -> dict:
    if not credentials:
        raise HTTPException(status_code=401, detail="Access token required")
    
    token = credentials.credentials
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
        user_id = payload.get("id")
        email = payload.get("email")
        role = payload.get("role")
        if user_id is None:
            raise HTTPException(status_code=403, detail="Invalid or expired token")
        return {"id": user_id, "email": email, "role": role}
    except JWTError:
        raise HTTPException(status_code=403, detail="Invalid or expired token")

def get_api_key_user(credentials: HTTPAuthorizationCredentials = Security(security)) -> dict:
    if not credentials:
        raise HTTPException(status_code=401, detail="API key required")
        
    key = credentials.credentials
    with db_session() as conn:
        cursor = conn.execute("SELECT user_id FROM api_keys WHERE key = ?", (key,))
        result = cursor.fetchone()
        if not result:
            raise HTTPException(status_code=403, detail="Invalid API key")
            
        cursor = conn.execute("SELECT id, email, role FROM users WHERE id = ?", (result['user_id'],))
        user = cursor.fetchone()
        if not user:
            raise HTTPException(status_code=403, detail="User not found")
            
        return {"id": user['id'], "email": user['email'], "role": user['role']}

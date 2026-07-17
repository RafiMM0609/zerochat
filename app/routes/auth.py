from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, EmailStr
from app.auth import hash_password, verify_password, create_access_token
from app.database import db_session

router = APIRouter(prefix="/api/auth", tags=["auth"])

class UserRegisterSchema(BaseModel):
    email: EmailStr
    password: str

class UserLoginSchema(BaseModel):
    email: EmailStr
    password: str

@router.post("/register", status_code=status.HTTP_201_CREATED)
def register(payload: UserRegisterSchema):
    email = payload.email.lower()
    password = payload.password
    
    if not email or not password:
        raise HTTPException(status_code=400, detail="Email and password required")
        
    hashed = hash_password(password)
    
    try:
        with db_session() as conn:
            cursor = conn.execute(
                "INSERT INTO users (email, password_hash) VALUES (?, ?)",
                (email, hashed)
            )
            user_id = cursor.lastrowid
            
            conn.execute(
                "INSERT INTO personas (user_id, system_prompt) VALUES (?, ?)",
                (user_id, "You are a helpful AI assistant. Always be polite and concise.")
            )
        return {"message": "User created successfully", "userId": user_id}
    except Exception as e:
        # SQLite constraint check
        if "UNIQUE" in str(e):
            raise HTTPException(status_code=400, detail="Email already exists")
        raise HTTPException(status_code=500, detail="Internal server error")

@router.post("/login")
def login(payload: UserLoginSchema):
    email = payload.email.lower()
    password = payload.password
    
    with db_session() as conn:
        cursor = conn.execute("SELECT * FROM users WHERE email = ?", (email,))
        user = cursor.fetchone()
        
    if not user:
        raise HTTPException(status_code=400, detail="Invalid credentials")
        
    if not verify_password(password, user['password_hash']):
        raise HTTPException(status_code=400, detail="Invalid credentials")
        
    token_data = {"id": user['id'], "email": user['email'], "role": user['role']}
    token = create_access_token(data=token_data)
    
    return {
        "token": token,
        "user": {"id": user['id'], "email": user['email'], "role": user['role']}
    }

@router.post("/guest")
def guest_login():
    guest_email = "guest@agnostic.com"
    guest_password = "GuestPassword123!"
    
    with db_session() as conn:
        cursor = conn.execute("SELECT * FROM users WHERE email = ?", (guest_email,))
        user = cursor.fetchone()
        
    if not user:
        hashed = hash_password(guest_password)
        try:
            with db_session() as conn:
                cursor = conn.execute(
                    "INSERT INTO users (email, password_hash, role) VALUES (?, ?, ?)",
                    (guest_email, hashed, "guest")
                )
                user_id = cursor.lastrowid
                conn.execute(
                    "INSERT INTO personas (user_id, system_prompt) VALUES (?, ?)",
                    (user_id, "You are a helpful AI guest assistant. Always be polite and concise.")
                )
                user = {"id": user_id, "email": guest_email, "role": "guest"}
        except Exception as e:
            print("Guest creation error:", e)
            raise HTTPException(status_code=500, detail="Internal server error")
            
    token_data = {"id": user['id'], "email": user['email'], "role": user['role']}
    token = create_access_token(data=token_data)
    
    return {
        "token": token,
        "user": {"id": user['id'], "email": user['email'], "role": user['role']}
    }

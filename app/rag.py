import os
import time
import shutil
import httpx
import numpy as np
import asyncio
from pathlib import Path
from lightrag import LightRAG, QueryParam
from lightrag.utils import EmbeddingFunc
from app.config import OPENROUTER_API_KEY, GEMINI_API_KEY, EMBEDDING_PROVIDER, EMBEDDING_MODEL, RAG_DIR, EMBEDDING_DIM, EMBEDDING_API_KEY

import contextvars

current_user_persona = contextvars.ContextVar("current_user_persona", default="You are a helpful AI assistant.")

MODELS = [
    {"id": "inclusionai/ling-3.0-flash-fin:free", "priority": 1},
    {"id": "liquid/lfm-2.5-2.6b:free", "priority": 2},
    {"id": "nvidia/nemotron-3.5-lightning:free", "priority": 3},
    {"id": "poolside/laguna-s-2.1:free", "priority": 4},
    {"id": "z-ai/glm-5.2:free", "priority": 5},
    {"id": "minimax/minimax-m3:free", "priority": 6}
]

model_cooldowns = {}  # model_id -> timestamp (when cooldown ends)

async def fetch_fallback_free_models():
    """Fetch top 5 free models dynamically from OpenRouter API, clear their cooldowns, and override global MODELS list."""
    global MODELS
    try:
        async with httpx.AsyncClient() as client:
            res = await client.get("https://openrouter.ai/api/v1/models", timeout=10.0)
            if res.status_code == 200:
                data = res.json()
                models_data = data.get("data", [])
                free_models = []
                for m in models_data:
                    m_id = m.get("id", "")
                    if m_id.endswith(":free") or ":free" in m_id:
                        free_models.append(m_id)
                        if len(free_models) == 5:
                            break
                if free_models:
                    print(f"[ModelSelector] Overriding MODELS list with new free models from OpenRouter: {free_models}")
                    MODELS = [{"id": model_id, "priority": idx + 1} for idx, model_id in enumerate(free_models)]
                    for m_id in free_models:
                        model_cooldowns.pop(m_id, None)
                    return free_models
    except Exception as e:
        print(f"[ModelSelector] Failed to fetch free models from OpenRouter: {e}")
    return [m["id"] for m in MODELS]

def get_available_models():
    now = time.time()
    available = []
    for m in MODELS:
        cooldown = model_cooldowns.get(m["id"], 0)
        if now >= cooldown:
            available.append(m["id"])
    return available

def report_model_failure(model_id):
    model_cooldowns[model_id] = time.time() + 180  # 3 minutes cooldown
    print(f"[ModelSelector] {model_id} failed. Cooldown until {time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(model_cooldowns[model_id]))}")

def report_model_success(model_id):
    if model_id in model_cooldowns:
        del model_cooldowns[model_id]
        print(f"[ModelSelector] {model_id} recovered, cooldown cleared")

def get_model_status():
    now = time.time()
    status = []
    for m in MODELS:
        cooldown = model_cooldowns.get(m["id"], 0)
        status.append({
            "model": m["id"],
            "priority": m["priority"],
            "available": now >= cooldown,
            "coolingUntil": time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(cooldown)) if cooldown > now else None
        })
    return status

# Global semaphores to limit concurrent requests (prevent 429 rate limit spikes)
embedding_semaphore = asyncio.Semaphore(2)
llm_semaphore = asyncio.Semaphore(2)

async def embed_text(text: str) -> list[float]:
    max_retries = 5
    for attempt in range(1, max_retries + 1):
        try:
            if EMBEDDING_PROVIDER == "gemini":
                api_key = EMBEDDING_API_KEY or GEMINI_API_KEY
                if not api_key:
                    raise ValueError("EMBEDDING_API_KEY or GEMINI_API_KEY is not configured in .env")
                
                # Ensure model has models/ prefix
                model = EMBEDDING_MODEL if EMBEDDING_MODEL.startswith("models/") else f"models/{EMBEDDING_MODEL}"
                if not EMBEDDING_MODEL or EMBEDDING_MODEL == "nvidia/llama-nemotron-embed-vl-1b-v2:free":
                    model = "models/text-embedding-004"
                    
                async with embedding_semaphore:
                    async with httpx.AsyncClient() as client:
                        response = await client.post(
                            f"https://generativelanguage.googleapis.com/v1beta/{model}:embedContent?key={api_key}",
                            json={
                                "model": model,
                                "content": {
                                    "parts": [{"text": text}]
                                }
                            },
                            headers={"Content-Type": "application/json"},
                            timeout=30.0
                        )
                if response.status_code == 429:
                    raise Exception(f"Rate limited (429): {response.text}")
                elif response.status_code != 200:
                    raise Exception(f"Gemini embedding API error ({response.status_code}): {response.text}")
                data = response.json()
                return data["embedding"]["values"]

            else:  # Default openrouter
                api_key = EMBEDDING_API_KEY or OPENROUTER_API_KEY
                if not api_key:
                    raise ValueError("EMBEDDING_API_KEY or OPENROUTER_API_KEY is not configured in .env")
                    
                model = EMBEDDING_MODEL
                if not model or model.startswith("models/"):
                    model = "nvidia/llama-nemotron-embed-vl-1b-v2:free"
                    
                async with embedding_semaphore:
                    async with httpx.AsyncClient() as client:
                        response = await client.post(
                            "https://openrouter.ai/api/v1/embeddings",
                            headers={
                                "Authorization": f"Bearer {api_key}",
                                "Content-Type": "application/json"
                            },
                            json={
                                "model": model,
                                "input": text
                            },
                            timeout=30.0
                        )
                if response.status_code == 429:
                    raise Exception(f"Rate limited (429): {response.text}")
                elif response.status_code != 200:
                    raise Exception(f"OpenRouter embedding API error ({response.status_code}): {response.text}")
                data = response.json()
                if "data" not in data or not data["data"]:
                    raise Exception(f"OpenRouter embedding empty response: {response.text}")
                return data["data"][0]["embedding"]

        except Exception as e:
            if attempt == max_retries:
                print(f"[Embedding] All {max_retries} attempts failed for embedding: {e}")
                raise e
            backoff = (2 ** attempt) + (0.2 * attempt)
            print(f"[Embedding] Attempt {attempt}/{max_retries} failed ({e}). Retrying in {backoff:.1f}s...")
            await asyncio.sleep(backoff)

def get_embedding_dimension() -> int:
    if EMBEDDING_DIM and EMBEDDING_DIM > 0:
        return EMBEDDING_DIM
    if EMBEDDING_PROVIDER == "gemini":
        return 768
    return 2048

async def custom_embedding_func(texts: list[str]) -> np.ndarray:
    tasks = [embed_text(t) for t in texts]
    embeddings = await asyncio.gather(*tasks)
    return np.array(embeddings, dtype=np.float32)

# Set LightRAG embedding requirements
custom_embedding_func.func = custom_embedding_func
custom_embedding_func.embedding_dim = get_embedding_dimension()
custom_embedding_func.max_token_size = 8192

async def custom_llm_complete(prompt: str, system_prompt: str = None, history: list = None, **kwargs) -> str:
    if history is None:
        history = []
        
    persona = current_user_persona.get()
    
    if system_prompt:
        full_system_prompt = f"System Persona: {persona}\n\n{system_prompt}"
        if not kwargs.get("bypass_hardening", False):
            from app.security import enforce_topic_hardening
            full_system_prompt = enforce_topic_hardening(full_system_prompt, system_prompt)
    else:
        full_system_prompt = f"System Persona: {persona}"
        
    messages = []
    messages.append({"role": "system", "content": full_system_prompt})
    for msg in history:
        messages.append(msg)
    messages.append({"role": "user", "content": prompt})

    stream = kwargs.get("stream", False)

    if stream:
        async def stream_generator():
            import json
            import random
            available_models = get_available_models()
            if not available_models:
                print("[ModelSelector] No standard models available, fetching free models dynamically from OpenRouter...")
                available_models = await fetch_fallback_free_models()

            async with llm_semaphore:
                last_err = None
                for model_id in available_models:
                    max_retries = 3
                    for attempt in range(1, max_retries + 1):
                        try:
                            async with httpx.AsyncClient() as client:
                                async with client.stream(
                                    "POST",
                                    "https://openrouter.ai/api/v1/chat/completions",
                                    headers={
                                        "Authorization": f"Bearer {OPENROUTER_API_KEY}",
                                        "Content-Type": "application/json",
                                        "HTTP-Referer": "https://chatbot.kagita.my.id",
                                        "X-Title": "Agnostic-AI"
                                    },
                                    json={
                                        "model": model_id,
                                        "messages": messages,
                                        "temperature": kwargs.get("temperature", 0.7),
                                        "stream": True
                                    },
                                    timeout=60.0
                                ) as response:
                                    if response.status_code == 429 or "429" in str(response.status_code):
                                        raise Exception(f"Status 429: Rate limited upstream")
                                    elif response.status_code != 200:
                                        raise Exception(f"Status {response.status_code}")
                                    
                                    async for line in response.aiter_lines():
                                        if line.startswith("data: ") and line.strip() != "data: [DONE]":
                                            try:
                                                data = json.loads(line[6:])
                                                chunk = data["choices"][0]["delta"].get("content", "")
                                                if chunk:
                                                    yield chunk
                                            except Exception:
                                                pass
                            report_model_success(model_id)
                            return
                        except Exception as e:
                            last_err = e
                            err_str = str(e)
                            if "429" in err_str or "rate" in err_str.lower():
                                if attempt < max_retries:
                                    backoff = (2 ** attempt) + random.uniform(0.5, 1.5)
                                    print(f"[ModelSelector] Model {model_id} hit 429 (attempt {attempt}/{max_retries}). Retrying in {backoff:.1f}s...")
                                    await asyncio.sleep(backoff)
                                    continue
                            print(f"[ModelSelector] Stream failed for model {model_id}: {e}")
                            report_model_failure(model_id)
                            break

                # Emergency dynamic fallback if all available models failed
                print("[ModelSelector] All available models failed, fetching emergency fallback models from OpenRouter...")
                fallback_models = await fetch_fallback_free_models()
                for model_id in fallback_models:
                    try:
                        async with httpx.AsyncClient() as client:
                            async with client.stream(
                                "POST",
                                "https://openrouter.ai/api/v1/chat/completions",
                                headers={
                                    "Authorization": f"Bearer {OPENROUTER_API_KEY}",
                                    "Content-Type": "application/json",
                                    "HTTP-Referer": "https://chatbot.kagita.my.id",
                                    "X-Title": "Agnostic-AI"
                                },
                                json={
                                    "model": model_id,
                                    "messages": messages,
                                    "temperature": kwargs.get("temperature", 0.7),
                                    "stream": True
                                },
                                timeout=60.0
                            ) as response:
                                if response.status_code != 200:
                                    raise Exception(f"Status {response.status_code}")
                                async for line in response.aiter_lines():
                                    if line.startswith("data: ") and line.strip() != "data: [DONE]":
                                        try:
                                            data = json.loads(line[6:])
                                            chunk = data["choices"][0]["delta"].get("content", "")
                                            if chunk:
                                                yield chunk
                                        except Exception:
                                            pass
                        report_model_success(model_id)
                        return
                    except Exception as e:
                        print(f"[ModelSelector] Emergency stream model {model_id} failed: {e}")
                        report_model_failure(model_id)
                        last_err = e

                raise last_err or Exception("All streaming models failed")
        return stream_generator()

    import random
    available_models = get_available_models()
    if not available_models:
        print("[ModelSelector] No standard models available, fetching free models dynamically from OpenRouter...")
        available_models = await fetch_fallback_free_models()

    async with llm_semaphore:
        last_err = None
        for model_id in available_models:
            max_retries = 3
            for attempt in range(1, max_retries + 1):
                try:
                    async with httpx.AsyncClient() as client:
                        response = await client.post(
                            "https://openrouter.ai/api/v1/chat/completions",
                            headers={
                                "Authorization": f"Bearer {OPENROUTER_API_KEY}",
                                "Content-Type": "application/json",
                                "HTTP-Referer": "https://chatbot.kagita.my.id",
                                "X-Title": "Agnostic-AI"
                            },
                            json={
                                "model": model_id,
                                "messages": messages,
                                "temperature": kwargs.get("temperature", 0.7),
                                "stream": False
                            },
                            timeout=60.0
                        )
                    if response.status_code == 429 or "429" in str(response.status_code):
                        raise Exception(f"Status 429: {response.text}")
                    elif response.status_code != 200:
                        raise Exception(f"Status {response.status_code}: {response.text}")
                    
                    data = response.json()
                    result = data["choices"][0]["message"]["content"]
                    report_model_success(model_id)
                    return result
                except Exception as e:
                    last_err = e
                    err_str = str(e)
                    if "429" in err_str or "rate" in err_str.lower():
                        if attempt < max_retries:
                            backoff = (2 ** attempt) + random.uniform(0.5, 1.5)
                            print(f"[ModelSelector] Model {model_id} hit 429 (attempt {attempt}/{max_retries}). Retrying in {backoff:.1f}s...")
                            await asyncio.sleep(backoff)
                            continue
                    print(f"[ModelSelector] Model {model_id} failed: {e}")
                    report_model_failure(model_id)
                    break

        # Emergency dynamic fallback if all standard models failed
        print("[ModelSelector] All available models failed, fetching emergency fallback models from OpenRouter...")
        fallback_models = await fetch_fallback_free_models()
        for model_id in fallback_models:
            try:
                async with httpx.AsyncClient() as client:
                    response = await client.post(
                        "https://openrouter.ai/api/v1/chat/completions",
                        headers={
                            "Authorization": f"Bearer {OPENROUTER_API_KEY}",
                            "Content-Type": "application/json",
                            "HTTP-Referer": "https://chatbot.kagita.my.id",
                            "X-Title": "Agnostic-AI"
                        },
                        json={
                            "model": model_id,
                            "messages": messages,
                            "temperature": kwargs.get("temperature", 0.7),
                            "stream": False
                        },
                        timeout=60.0
                    )
                if response.status_code != 200:
                    raise Exception(f"Status {response.status_code}: {response.text}")
                
                data = response.json()
                result = data["choices"][0]["message"]["content"]
                report_model_success(model_id)
                return result
            except Exception as e:
                print(f"[ModelSelector] Emergency model {model_id} failed: {e}")
                report_model_failure(model_id)
                last_err = e

        raise last_err or Exception("All models failed")

custom_llm_complete.func = custom_llm_complete
custom_llm_complete.model_name = "openrouter-selector"

# User RAG Cache
_user_rag_instances = {}
_detected_embedding_dimension = None

async def detect_embedding_dimension() -> int:
    global _detected_embedding_dimension
    if _detected_embedding_dimension is not None:
        return _detected_embedding_dimension
    
    if EMBEDDING_DIM and EMBEDDING_DIM > 0:
        _detected_embedding_dimension = EMBEDDING_DIM
        return _detected_embedding_dimension
        
    try:
        # Get one test embedding to find dimension
        test_embed = await embed_text("test")
        _detected_embedding_dimension = len(test_embed)
        print(f"[Embedding] Auto-detected dimension for model '{EMBEDDING_MODEL}': {_detected_embedding_dimension}")
        return _detected_embedding_dimension
    except Exception as e:
        print(f"[Embedding] Failed to auto-detect dimension: {e}. Falling back to default.")
        if EMBEDDING_PROVIDER == "gemini":
            _detected_embedding_dimension = 768
        else:
            _detected_embedding_dimension = 2048
        return _detected_embedding_dimension

async def get_user_rag(user_id: int) -> LightRAG:
    if user_id in _user_rag_instances:
        return _user_rag_instances[user_id]
        
    user_dir = RAG_DIR / f"user_{user_id}"
    user_dir.mkdir(parents=True, exist_ok=True)
    
    dim = await detect_embedding_dimension()
    custom_embedding_func.embedding_dim = dim
    
    rag = LightRAG(
        working_dir=str(user_dir),
        llm_model_func=custom_llm_complete,
        llm_model_max_async=2,
        embedding_func=EmbeddingFunc(
            embedding_dim=dim,
            max_token_size=8192,
            func=custom_embedding_func
        )
    )
    
    await rag.initialize_storages()
    _user_rag_instances[user_id] = rag
    return rag

async def reset_user_vdb(user_id: int):
    global _detected_embedding_dimension
    _detected_embedding_dimension = None
    
    # Remove from memory cache
    _user_rag_instances.pop(user_id, None)
    
    user_dir = RAG_DIR / f"user_{user_id}"
    if user_dir.exists():
        for filename in ["vdb_entities.json", "vdb_relationships.json", "vdb_chunks.json"]:
            filepath = user_dir / filename
            if filepath.exists():
                filepath.unlink()

async def reset_user_knowledge_base(user_id: int):
    global _detected_embedding_dimension
    _detected_embedding_dimension = None
    
    # Remove from memory cache
    _user_rag_instances.pop(user_id, None)
    
    user_dir = RAG_DIR / f"user_{user_id}"
    if user_dir.exists():
        shutil.rmtree(user_dir)
    user_dir.mkdir(parents=True, exist_ok=True)


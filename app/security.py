import re
import time
import json
import numpy as np
import httpx
from app.config import OPENROUTER_API_KEY, ENABLE_TOPIC_HARDENING
from app.database import db_session

MAX_MESSAGE_LENGTH = 5000
RATE_LIMIT_WINDOW_MS = 60 * 1000  # 1 minute
MAX_REQUESTS_PER_WINDOW = 20      # Max requests per minute

PROMPT_INJECTION_PATTERNS = [
    {
        'id': 'instruction_override',
        'name': 'Instruction Override',
        'regex': re.compile(r'\bignore\s+(all\s+)?(previous|prior|above)\s+instructions\b', re.IGNORECASE),
        'severity': 'HIGH',
        'description': 'Attempts to override or bypass system instructions.'
    },
    {
        'id': 'system_leak',
        'name': 'System Prompt Leakage',
        'regex': re.compile(r'\b(?:reveal|output|print|show|leak|copy)\s+(your\s+)?(?:system\s+prompt|instructions|initialization|system\s+instructions)\b', re.IGNORECASE),
        'severity': 'HIGH',
        'description': 'Attempts to extract the system instructions of the AI.'
    },
    {
        'id': 'jailbreak_dan',
        'name': 'DAN / Jailbreak Mode',
        'regex': re.compile(r'\b(?:dan\s+mode|do\s*anything\s*now|developer\s+mode\s+active|bypass\s+security\s+filters|jailbreak)\b', re.IGNORECASE),
        'severity': 'CRITICAL',
        'description': 'Attempts to force the AI into an unrestricted developer bypass state.'
    },
    {
        'id': 'roleplay_bypass',
        'name': 'Roleplay Bypass',
        'regex': re.compile(r'\b(?:hypothetical\s+scenario\s+where|roleplay\s+as\s+(an?\s+)?unfiltered|pretend\s+you\s+have\s+no\s+restrictions)\b', re.IGNORECASE),
        'severity': 'MEDIUM',
        'description': 'Attempts to bypass restrictions using hypothetical roleplay contexts.'
    }
]

PII_PATTERNS = [
    {
        'id': 'email',
        'name': 'Email Address',
        'regex': re.compile(r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b'),
        'replacement': '[REDACTED_EMAIL]'
    },
    {
        'id': 'phone',
        'name': 'Phone Number',
        'regex': re.compile(r'\b(?:\+?\d{1,3}[-. ]?)?\(?\d{3}\)?[-. ]?(?:\d{3}[-. ]?)?\d{4}\b'),
        'replacement': '[REDACTED_PHONE]'
    },
    {
        'id': 'api_key',
        'name': 'API Key',
        'regex': re.compile(r'\b(?:sk-[a-zA-Z0-9]{20,}|sk-agnostic-[a-zA-Z0-9]{20,}|eyJ[A-Za-z0-9-_=]+\.[A-Za-z0-9-_=]+\.?[A-Za-z0-9-_.+/=]*)\b'),
        'replacement': '[REDACTED_KEY]'
    }
]

def log_security_event(user_id, ip_address, event_type, details, severity):
    try:
        with db_session() as conn:
            conn.execute(
                "INSERT INTO security_logs (user_id, ip_address, event_type, details, severity) VALUES (?, ?, ?, ?, ?)",
                (user_id, ip_address, event_type, details, severity)
            )
    except Exception as e:
        print("[Hardening] Error logging security event:", e)

def prune_rate_limit_hits():
    try:
        cutoff = int(time.time() * 1000) - 10 * 60 * 1000
        with db_session() as conn:
            conn.execute("DELETE FROM rate_limit_hits WHERE timestamp < ?", (cutoff,))
    except Exception as e:
        print("[Hardening] Error pruning rate limit hits:", e)

def check_rate_limit(user_id, ip_address):
    import random
    if random.random() < 0.1:
        prune_rate_limit_hits()

    now = int(time.time() * 1000)
    window_start = now - RATE_LIMIT_WINDOW_MS

    try:
        with db_session() as conn:
            conn.execute(
                "INSERT INTO rate_limit_hits (user_id, ip_address, timestamp) VALUES (?, ?, ?)",
                (user_id, ip_address, now)
            )
            if user_id:
                cursor = conn.execute(
                    "SELECT COUNT(*) as hits FROM rate_limit_hits WHERE user_id = ? AND timestamp > ?",
                    (user_id, window_start)
                )
            else:
                cursor = conn.execute(
                    "SELECT COUNT(*) as hits FROM rate_limit_hits WHERE ip_address = ? AND timestamp > ?",
                    (ip_address, window_start)
                )
            row = cursor.fetchone()
            count = row['hits'] if row else 0
            return count > MAX_REQUESTS_PER_WINDOW
    except Exception as e:
        print("[Hardening] SQLite rate limiter error:", e)
        return False

async def save_blocked_attack(user_id, prompt, detected_via, embedding=None):
    try:
        from app.rag import embed_text
        with db_session() as conn:
            # Check for duplicate
            cursor = conn.execute(
                "SELECT id FROM blocked_attacks_metadata WHERE user_id = ? AND original_prompt = ?",
                (user_id, prompt)
            )
            if cursor.fetchone():
                return

            if embedding is None:
                embedding = await embed_text(prompt)

            cursor = conn.execute(
                "INSERT INTO blocked_attacks_metadata (user_id, original_prompt, detected_via) VALUES (?, ?, ?)",
                (user_id, prompt, detected_via)
            )
            last_id = cursor.lastrowid

            conn.execute(
                "INSERT INTO blocked_attacks_embeddings (attack_id, embedding) VALUES (?, ?)",
                (last_id, json.dumps(embedding))
            )
            print(f"[Hardening] Saved attack to semantic memory: \"{prompt[:50]}...\" via {detected_via}")
    except Exception as e:
        print("[Hardening] Error saving blocked attack:", e)

async def verify_and_harden(request_info, message_text):
    user_id = request_info.get('user_id')
    ip_address = request_info.get('ip_address')

    # 1. Message length validation
    if len(message_text) > MAX_MESSAGE_LENGTH:
        details = f"Prompt length of {len(message_text)} characters exceeded MAX limit of {MAX_MESSAGE_LENGTH}."
        log_security_event(user_id, ip_address, 'ABUSE_LENGTH', details, 'LOW')
        return {
            'allowed': False,
            'reason': f"Blocked: Message exceeds the maximum limit of {MAX_MESSAGE_LENGTH} characters.",
            'redactedText': message_text
        }

    # 2. SQLite Rate Limiting check
    if check_rate_limit(user_id, ip_address):
        details = f"Rate limit block: Exceeded {MAX_REQUESTS_PER_WINDOW} requests in 1 minute."
        log_security_event(user_id, ip_address, 'ABUSE_RATE_LIMIT', details, 'MEDIUM')
        return {
            'allowed': False,
            'reason': "Blocked: Rate limit exceeded. Please wait a moment before sending another message.",
            'redactedText': message_text
        }

    # 3. Heuristics Prompt Injection Check (Static Patterns)
    for pattern in PROMPT_INJECTION_PATTERNS:
        if pattern['regex'].search(message_text):
            details = f"Pattern \"{pattern['name']}\" matched: \"{message_text[:120]}...\""
            log_security_event(user_id, ip_address, 'PROMPT_INJECTION', details, pattern['severity'])
            await save_blocked_attack(user_id, message_text, 'static_regex')
            return {
                'allowed': False,
                'reason': f"Blocked by Security Hardening Guard: {pattern['description']}",
                'redactedText': message_text
            }

    # 3.1 Heuristics Prompt Injection Check (Dynamic User Patterns)
    if user_id:
        try:
            with db_session() as conn:
                cursor = conn.execute(
                    "SELECT name, regex_pattern, severity FROM dynamic_security_rules WHERE (user_id = ? OR user_id IS NULL) AND status = 'active'",
                    (user_id,)
                )
                dynamic_rules = cursor.fetchall()

            for rule in dynamic_rules:
                try:
                    regex = re.compile(rule['regex_pattern'], re.IGNORECASE)
                    if regex.search(message_text):
                        details = f"Dynamic Pattern \"{rule['name']}\" matched: \"{message_text[:120]}...\""
                        log_security_event(user_id, ip_address, 'PROMPT_INJECTION', details, rule['severity'])
                        await save_blocked_attack(user_id, message_text, 'dynamic_regex')
                        return {
                            'allowed': False,
                            'reason': f"Blocked by Adaptive Security Shield: {rule['name']}",
                            'redactedText': message_text
                        }
                except Exception as regex_err:
                    print(f"[Hardening] Invalid dynamic regex pattern: {rule['regex_pattern']}", regex_err)
        except Exception as db_err:
            print("[Hardening] Error loading dynamic rules:", db_err)

    # 3.2 Semantic Similarity Check (NumPy local distance computation)
    if user_id:
        try:
            from app.rag import embed_text
            with db_session() as conn:
                cursor = conn.execute(
                    "SELECT COUNT(*) as count FROM blocked_attacks_metadata WHERE user_id = ?",
                    (user_id,)
                )
                blocked_count = cursor.fetchone()['count']

                if blocked_count > 0:
                    query_embedding = await embed_text(message_text)
                    
                    cursor = conn.execute(
                        "SELECT bam.original_prompt, bae.embedding FROM blocked_attacks_embeddings bae JOIN blocked_attacks_metadata bam ON bae.attack_id = bam.id WHERE bam.user_id = ?",
                        (user_id,)
                    )
                    history_records = cursor.fetchall()
                    
                    min_dist = float('inf')
                    matching_prompt = ""
                    
                    q_vec = np.array(query_embedding, dtype=np.float32)
                    
                    for record in history_records:
                        hist_emb = json.loads(record['embedding'])
                        h_vec = np.array(hist_emb, dtype=np.float32)
                        if q_vec.shape == h_vec.shape:
                            dist = np.linalg.norm(q_vec - h_vec)
                            if dist < min_dist:
                                min_dist = dist
                                matching_prompt = record['original_prompt']
                    
                    threshold = 1.10
                    if min_dist < threshold:
                        details = f"Semantic match with historical attack (distance: {min_dist:.4f}): \"{matching_prompt[:120]}...\""
                        log_security_event(user_id, ip_address, 'PROMPT_INJECTION', details, 'HIGH')
                        
                        # Save new attack record as semantic match
                        with db_session() as conn:
                            cursor = conn.execute(
                                "INSERT INTO blocked_attacks_metadata (user_id, original_prompt, detected_via) VALUES (?, ?, 'semantic_memory')",
                                (user_id, message_text)
                            )
                            last_id = cursor.lastrowid
                            conn.execute(
                                "INSERT INTO blocked_attacks_embeddings (attack_id, embedding) VALUES (?, ?)",
                                (last_id, json.dumps(query_embedding))
                            )
                        
                        return {
                            'allowed': False,
                            'reason': "Blocked by Security Hardening Guard (Semantic Attack Memory Match).",
                            'redactedText': message_text
                        }
        except Exception as semantic_err:
            print("[Hardening] Error in semantic memory scan:", semantic_err)

    # 4. PII Redaction / Fail-safe Data Anonymization
    sanitized_text = message_text
    pii_found = False
    types_found = []

    for pattern in PII_PATTERNS:
        if pattern['regex'].search(sanitized_text):
            pii_found = True
            types_found.append(pattern['name'])
            sanitized_text = pattern['regex'].sub(pattern['replacement'], sanitized_text)

    if pii_found:
        details = f"Redacted sensitive data patterns: {', '.join(types_found)}."
        log_security_event(user_id, ip_address, 'PII_REDACTION', details, 'LOW')

    return {
        'allowed': True,
        'reason': '',
        'redactedText': sanitized_text
    }

async def verify_and_harden_persona(request_info, system_prompt):
    user_id = request_info.get('user_id')
    ip_address = request_info.get('ip_address')

    if not system_prompt:
        return {
            'allowed': True,
            'reason': '',
            'redactedText': ''
        }

    # 1. Message length check
    if len(system_prompt) > MAX_MESSAGE_LENGTH:
        details = f"Persona length of {len(system_prompt)} characters exceeded MAX limit of {MAX_MESSAGE_LENGTH}."
        log_security_event(user_id, ip_address, 'PERSONA_ABUSE_LENGTH', details, 'LOW')
        return {
            'allowed': False,
            'reason': f"Blocked: Persona exceeds the maximum limit of {MAX_MESSAGE_LENGTH} characters.",
            'redactedText': system_prompt
        }

    # 2. Heuristics Static Pattern check
    for pattern in PROMPT_INJECTION_PATTERNS:
        if pattern['regex'].search(system_prompt):
            details = f"Persona pattern \"{pattern['name']}\" matched: \"{system_prompt[:120]}...\""
            log_security_event(user_id, ip_address, 'PERSONA_INJECTION', details, pattern['severity'])
            await save_blocked_attack(user_id, system_prompt, 'persona_static_regex')
            return {
                'allowed': False,
                'reason': f"Blocked: System Persona contains potentially dangerous commands: {pattern['description']}",
                'redactedText': system_prompt
            }

    # 3. Dynamic rule checks
    if user_id:
        try:
            with db_session() as conn:
                cursor = conn.execute(
                    "SELECT name, regex_pattern, severity FROM dynamic_security_rules WHERE (user_id = ? OR user_id IS NULL) AND status = 'active'",
                    (user_id,)
                )
                dynamic_rules = cursor.fetchall()

            for rule in dynamic_rules:
                try:
                    regex = re.compile(rule['regex_pattern'], re.IGNORECASE)
                    if regex.search(system_prompt):
                        details = f"Persona dynamic pattern \"{rule['name']}\" matched: \"{system_prompt[:120]}...\""
                        log_security_event(user_id, ip_address, 'PERSONA_INJECTION', details, rule['severity'])
                        await save_blocked_attack(user_id, system_prompt, 'persona_dynamic_regex')
                        return {
                            'allowed': False,
                            'reason': f"Blocked by Adaptive Security Shield: {rule['name']}",
                            'redactedText': system_prompt
                        }
                except Exception as e:
                    print(f"[Hardening] Invalid dynamic regex in persona: {rule['regex_pattern']}", e)
        except Exception as db_err:
            print("[Hardening] Error loading dynamic rules for persona:", db_err)

    # 4. Semantic similarity check for persona
    if user_id:
        try:
            from app.rag import embed_text
            with db_session() as conn:
                cursor = conn.execute(
                    "SELECT COUNT(*) as count FROM blocked_attacks_metadata WHERE user_id = ?",
                    (user_id,)
                )
                blocked_count = cursor.fetchone()['count']

                if blocked_count > 0:
                    query_embedding = await embed_text(system_prompt)
                    
                    cursor = conn.execute(
                        "SELECT bam.original_prompt, bae.embedding FROM blocked_attacks_embeddings bae JOIN blocked_attacks_metadata bam ON bae.attack_id = bam.id WHERE bam.user_id = ?",
                        (user_id,)
                    )
                    history_records = cursor.fetchall()
                    
                    min_dist = float('inf')
                    matching_prompt = ""
                    
                    q_vec = np.array(query_embedding, dtype=np.float32)
                    
                    for record in history_records:
                        hist_emb = json.loads(record['embedding'])
                        h_vec = np.array(hist_emb, dtype=np.float32)
                        if q_vec.shape == h_vec.shape:
                            dist = np.linalg.norm(q_vec - h_vec)
                            if dist < min_dist:
                                min_dist = dist
                                matching_prompt = record['original_prompt']
                    
                    threshold = 1.10
                    if min_dist < threshold:
                        details = f"Persona semantic match with historical attack (distance: {min_dist:.4f}): \"{matching_prompt[:120]}...\""
                        log_security_event(user_id, ip_address, 'PERSONA_INJECTION', details, 'HIGH')
                        
                        # Save new attack record
                        with db_session() as conn:
                            cursor = conn.execute(
                                "INSERT INTO blocked_attacks_metadata (user_id, original_prompt, detected_via) VALUES (?, ?, 'persona_semantic_memory')",
                                (user_id, system_prompt)
                            )
                            last_id = cursor.lastrowid
                            conn.execute(
                                "INSERT INTO blocked_attacks_embeddings (attack_id, embedding) VALUES (?, ?)",
                                (last_id, json.dumps(query_embedding))
                            )
                        
                        return {
                            'allowed': False,
                            'reason': "Blocked by Security Hardening Guard (Semantic Attack Memory Match).",
                            'redactedText': system_prompt
                        }
        except Exception as semantic_err:
            print("[Hardening] Error in semantic memory scan for persona:", semantic_err)

    # 5. PII / Key Redaction
    redacted_text = system_prompt
    pii_found = False
    types_found = []

    for pattern in PII_PATTERNS:
        if pattern['regex'].search(redacted_text):
            pii_found = True
            types_found.append(pattern['name'])
            redacted_text = pattern['regex'].sub(pattern['replacement'], redacted_text)

    if pii_found:
        details = f"Redacted sensitive data patterns in persona: {', '.join(types_found)}."
        log_security_event(user_id, ip_address, 'PERSONA_PII_REDACTION', details, 'LOW')

    return {
        'allowed': True,
        'reason': '',
        'redactedText': redacted_text
    }

async def run_hermes_auditor(user_id):
    with db_session() as conn:
        cursor = conn.execute(
            "SELECT details, created_at FROM security_logs WHERE user_id = ? AND event_type = 'PROMPT_INJECTION' ORDER BY created_at DESC LIMIT 30",
            (user_id,)
        )
        logs = cursor.fetchall()

    if not logs:
        return {
            'success': True,
            'message': 'No security events available for auditing. Try attacking the system first!',
            'rulesCreated': 0
        }

    logs_text = "\n".join([f"- [{log['created_at']}] {log['details']}" for log in logs])

    system_prompt = (
        "You are Hermes, a security audit agent for an AI assistant platform.\n"
        "Your task is to analyze logs of recent blocked prompt injection attacks and synthesize new heuristic Regex rules to block similar attacks in the future.\n\n"
        "You MUST respond ONLY with a valid JSON array of objects. Do not include markdown code block formatting (like ```json) or any conversational text.\n\n"
        "Each object in the JSON array must contain exactly these fields:\n"
        "- \"name\": A concise, descriptive name for the rule (e.g. \"Direct override bypass\", \"Hypothetical translation trick\").\n"
        "- \"regex_pattern\": A valid JS RegExp string (without the leading/trailing slashes or flags, it will be evaluated case-insensitively) that matches the malicious pattern. Keep it general enough to block the tactic, but specific enough to avoid false positives.\n"
        "- \"severity\": One of: \"LOW\", \"MEDIUM\", \"HIGH\", \"CRITICAL\".\n"
        "- \"description\": A short description explaining what attack vector this rule mitigates.\n\n"
        "Example JSON output:\n"
        "[\n"
        "  {\n"
        "    \"name\": \"Translation Jailbreak\",\n"
        "    \"regex_pattern\": \"translate\\\\\\\\s+the\\\\\\\\s+(?:above|following)\\\\\\\\s+(?:text|instructions)\\\\\\\\s+to\",\n"
        "    \"severity\": \"MEDIUM\",\n"
        "    \"description\": \"Attempts to bypass instructions by framing it as a translation task.\"\n"
        "  }\n"
        "]"
    )

    user_content = (
        f"Here are the logs of recent prompt injections:\n{logs_text}\n\n"
        "Generate up to 3 new regex rules to block these attacks or similar bypass attempts."
    )

    if not OPENROUTER_API_KEY:
        raise ValueError("OPENROUTER_API_KEY is not configured in .env")

    async with httpx.AsyncClient() as client:
        response = await client.post(
            'https://openrouter.ai/api/v1/chat/completions',
            headers={
                'Authorization': f'Bearer {OPENROUTER_API_KEY}',
                'Content-Type': 'application/json'
            },
            json={
                'model': 'openrouter/owl-alpha',
                'messages': [
                    {'role': 'system', 'content': system_prompt},
                    {'role': 'user', 'content': user_content}
                ],
                'temperature': 0.1
            },
            timeout=30.0
        )

    if response.status_code != 200:
        raise Exception(f"OpenRouter API Error: {response.text}")

    data = response.json()
    if 'choices' not in data or not data['choices']:
        print("[Hardening] OpenRouter response missing choices:", json.dumps(data))
        raise Exception("OpenRouter response choices missing. Check model compatibility or quota.")

    content = data['choices'][0]['message']['content'] or '[]'
    # Clean up markdown code blocks if the LLM generated them
    content = content.replace("```json", "").replace("```", "").strip()

    try:
        rules = json.loads(content)
    except Exception as e:
        print("[Hardening] Hermes JSON parse error:", e)
        print("[Hardening] Raw content:", content)
        raise Exception("Hermes returned invalid JSON format. Please run the audit again.")

    created_count = 0
    with db_session() as conn:
        for rule in rules:
            if rule.get('name') and rule.get('regex_pattern'):
                # Validate regex pattern in python
                try:
                    re.compile(rule['regex_pattern'])
                except Exception as e:
                    print(f"Invalid regex from Hermes: {rule['regex_pattern']}", e)
                    continue

                # Check if duplicate rule exists
                cursor = conn.execute(
                    "SELECT id FROM dynamic_security_rules WHERE user_id = ? AND regex_pattern = ?",
                    (user_id, rule['regex_pattern'])
                )
                if not cursor.fetchone():
                    conn.execute(
                        "INSERT INTO dynamic_security_rules (user_id, name, regex_pattern, severity, status) VALUES (?, ?, ?, ?, 'pending')",
                        (user_id, rule['name'], rule['regex_pattern'], rule.get('severity', 'HIGH'))
                    )
                    created_count += 1

    return {
        'success': True,
        'message': f"Hermes audit complete. Synthesized and added {created_count} new security rules for review.",
        'rulesCreated': created_count
    }

def enforce_topic_hardening(system_prompt, context):
    if not ENABLE_TOPIC_HARDENING:
        return system_prompt

    hardening_rules = """
=========================================
CRITICAL TOPIC HARDENING INSTRUCTIONS
=========================================
You are strictly confined to the information provided in the "Retrieved Knowledge" section.
You must NOT use your pre-trained world knowledge to answer questions outside of this provided context.

CRITICAL RULES FOR MIXED QUERIES AND CODE REQUESTS:
1. If the user asks a mixed question where one part is related to the document and another part is unrelated (e.g., asking for programming code like Python/JavaScript, translation, math, or general knowledge), you must decline to answer the unrelated part.
2. If the user asks for code, scripts, or coding tutorials and the "Retrieved Knowledge" does not contain code instructions, you must decline to write or provide any code.

If the user asks a question that is NOT explicitly covered by the "Retrieved Knowledge", or if the Retrieved Knowledge is empty/missing, you must follow these rules:
1. Decline to answer the question politely.
2. Clearly state that your answers are strictly limited to the topics discussed in the uploaded document.
3. If the Retrieved Knowledge is NOT empty, suggest a relevant topic or question that IS covered by the document to guide the user back on track.

Example scenario:
User: "Who is the president of America?"
If the document is about IT Security, you respond: "I am sorry, but my knowledge is restricted to the document provided. I cannot answer who the president of America is. However, I can help you with topics covered in the document, such as [mention a relevant topic from the context]."
If the Retrieved Knowledge is empty, you respond: "I am sorry, but I do not have any documents loaded that contain the answer to your question. My knowledge is strictly limited to the provided documents."
=========================================
"""
    return system_prompt + "\n" + hardening_rules

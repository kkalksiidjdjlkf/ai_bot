"""
ISSAI Gateway — Nomad Clinic Bot
=================================
FastAPI прокси-сервис. Все AI-вычисления идут на сервера ISSAI,
ноутбук не нагружается.

Бэкенды (ISSAI — issai.kz):
  • STT — ISSAI MangiSoz 3.1  (распознавание казахской речи)
  • LLM — ISSAI Oylan 3.0     (ответы на казахском/русском)

Получить API ключ:
  1. Откройте https://issai.kz
  2. Нажмите «For Developers» → «Go to API Docs»
  3. Войдите (через Google) → скопируйте ключ
  4. Добавьте в .env: ISSAI_API_KEY=...

Запуск:
    .venv/bin/uvicorn issai_service:app --host 0.0.0.0 --port 8001 --reload
"""

import os
import base64
import httpx
from typing import Optional
from fastapi import FastAPI, HTTPException, Header
from pydantic import BaseModel, Field
from dotenv import load_dotenv
import logging
import asyncio
import tempfile
import uuid

load_dotenv()

logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(name)s: %(message)s")
logger = logging.getLogger("issai_gateway")

ISSAI_API_KEY       = os.getenv("ISSAI_API_KEY", "")
ISSAI_MANGISOZ_BASE = os.getenv("ISSAI_MANGISOZ_BASE", "https://api.mangisoz.nu.edu.kz")
ISSAI_OYLAN_BASE    = os.getenv("ISSAI_OYLAN_BASE",    "https://api.oylan.nu.edu.kz")
OYLAN_MODEL         = os.getenv("ISSAI_OYLAN_MODEL",   "oylan-3.0")
SERVICE_API_KEY     = os.getenv("SERVICE_API_KEY",     "")

USE_LOCAL_WHISPER   = os.getenv("USE_LOCAL_WHISPER", "false").lower() == "true"
LOCAL_WHISPER_MODEL_KZ = os.getenv("LOCAL_WHISPER_MODEL_KZ", "shyngys879/kazakh-whisper-large-v3-turbo")
LOCAL_WHISPER_MODEL_RU = os.getenv("LOCAL_WHISPER_MODEL_RU", "openai/whisper-medium")
whisper_pipe_kz = None
whisper_pipe_ru = None


class STTRequest(BaseModel):
    audio_base64: str = Field(..., description="Аудио файл в base64 (ogg/wav/mp3/webm)")
    mime_type: Optional[str] = Field("audio/ogg", description="MIME тип файла")
    language: Optional[str] = Field("kk", description="kk | ru | en")

class STTResponse(BaseModel):
    text: str
    language: str
    confidence: Optional[float] = None

class LLMMessage(BaseModel):
    role: str
    content: str

class LLMRequest(BaseModel):
    messages: list[LLMMessage]
    language: Optional[str] = Field("kk")
    max_tokens: Optional[int] = Field(1024, ge=64, le=4096)
    temperature: Optional[float] = Field(0.3, ge=0.0, le=2.0)
    system_prompt: Optional[str] = Field(None)

class LLMResponse(BaseModel):
    text: str
    model: str
    language: str

class HealthResponse(BaseModel):
    status: str
    issai_configured: bool
    mangisoz_base: str
    oylan_base: str


app = FastAPI(
    title="ISSAI Gateway — Nomad Clinic",
    description="ISSAI MangiSoz STT (казахская речь) + ISSAI Oylan LLM (казахские ответы). Серверы ISSAI — ноутбук не нагружается.",
    version="2.0.0",
)

@app.on_event("startup")
async def startup_event():
    global whisper_pipe_kz, whisper_pipe_ru
    if USE_LOCAL_WHISPER:
        logger.info(f"Loading local Whisper models...")
        try:
            import torch
            from transformers import pipeline
            device = "mps" if torch.backends.mps.is_available() else "cpu"
            # Для ускорения используем float16 на mps
            torch_dtype = torch.float16 if device == "mps" else torch.float32
            
            logger.info(f"Loading KZ model: {LOCAL_WHISPER_MODEL_KZ}")
            whisper_pipe_kz = pipeline(
                "automatic-speech-recognition",
                model=LOCAL_WHISPER_MODEL_KZ,
                device=device,
                torch_dtype=torch_dtype
            )
            
            logger.info(f"Loading RU model: {LOCAL_WHISPER_MODEL_RU}")
            whisper_pipe_ru = pipeline(
                "automatic-speech-recognition",
                model=LOCAL_WHISPER_MODEL_RU,
                device=device,
                torch_dtype=torch_dtype
            )
            logger.info(f"✅ Local Whisper models loaded on device: {device}")
        except Exception as e:
            logger.error(f"❌ Failed to load local Whisper: {e}")

def _issai_headers() -> dict:
    if not ISSAI_API_KEY:
        raise HTTPException(
            status_code=503,
            detail=(
                "ISSAI_API_KEY не задан. "
                "Получите на https://issai.kz → 'For Developers' → войдите → скопируйте ключ"
            ),
        )
    return {
        "Authorization": f"Bearer {ISSAI_API_KEY}",
        "Content-Type": "application/json",
    }

def _guard(x_api_key: Optional[str]):
    if SERVICE_API_KEY and x_api_key != SERVICE_API_KEY:
        raise HTTPException(status_code=401, detail="Неверный сервисный ключ")


@app.get("/health", response_model=HealthResponse, tags=["System"])
async def health():
    """Проверка состояния: API ключ настроен?"""
    return HealthResponse(
        status="ok",
        issai_configured=bool(ISSAI_API_KEY),
        mangisoz_base=ISSAI_MANGISOZ_BASE,
        oylan_base=ISSAI_OYLAN_BASE,
    )


@app.post("/stt/recognize", response_model=STTResponse, tags=["STT — Голос в текст"])
async def recognize_voice(req: STTRequest, x_api_key: Optional[str] = Header(None)):
    """
    **Голосовое сообщение WhatsApp → текст** через ISSAI MangiSoz STT.
    Принимает аудио в base64 (ogg/wav/mp3), возвращает текст.
    """
    _guard(x_api_key)

    try:
        audio_bytes = base64.b64decode(req.audio_base64, validate=True)
    except Exception:
        raise HTTPException(status_code=400, detail="Невалидный base64 в audio_base64")

    lang = req.language or "kk"
    logger.info(f"STT: язык={lang}, mime={req.mime_type}")

    if USE_LOCAL_WHISPER:
        logger.info(f"Используем локальный Whisper для языка: {lang}...")
        ext = ".ogg"
        if "wav" in (req.mime_type or ""): ext = ".wav"
        elif "mp3" in (req.mime_type or ""): ext = ".mp3"
        elif "webm" in (req.mime_type or ""): ext = ".webm"
        
        temp_file_path = os.path.join(tempfile.gettempdir(), f"stt_{uuid.uuid4().hex}{ext}")
        with open(temp_file_path, "wb") as f:
            f.write(audio_bytes)
        
        try:
            pipe = whisper_pipe_ru if lang == "ru" else whisper_pipe_kz
            if pipe is None:
                raise Exception(f"Pipeline for {lang} is not loaded")
                
            def run_pipe(path):
                # Для русского явно указываем язык для whisper (повышает точность)
                if lang == "ru":
                    return pipe(path, generate_kwargs={"language": "russian"})
                return pipe(path)
                
            result = await asyncio.to_thread(run_pipe, temp_file_path)
            text = result.get("text", "").strip()
            logger.info(f"Local STT результат: \"{text[:80]}\"")
            return STTResponse(text=text, language=lang, confidence=1.0)
        except Exception as e:
            logger.error(f"Ошибка локального Whisper: {e}")
            raise HTTPException(500, f"Ошибка локального Whisper: {e}")
        finally:
            if os.path.exists(temp_file_path):
                os.remove(temp_file_path)

    headers = _issai_headers()
    payload = {
        "audio":     req.audio_base64,
        "language":  lang,
        "mime_type": req.mime_type or "audio/ogg",
    }

    async with httpx.AsyncClient(timeout=60.0) as client:
        try:
            resp = await client.post(
                f"{ISSAI_MANGISOZ_BASE}/v1/stt/recognize",
                headers=headers,
                json=payload,
            )
        except httpx.ConnectError:
            raise HTTPException(502, "Не удалось подключиться к ISSAI MangiSoz API")
        except httpx.TimeoutException:
            raise HTTPException(504, "ISSAI MangiSoz API timeout")

        if resp.status_code == 401:
            raise HTTPException(401, "Неверный ISSAI_API_KEY. Проверьте https://issai.kz")
        if resp.status_code == 429:
            raise HTTPException(429, "Превышен лимит ISSAI API")
        if not resp.is_success:
            logger.error(f"MangiSoz STT {resp.status_code}: {resp.text[:300]}")
            raise HTTPException(502, f"ISSAI MangiSoz вернул {resp.status_code}")

        data = resp.json()

    text = data.get("text", "").strip()
    logger.info(f"STT результат: \"{text[:80]}\"")
    return STTResponse(text=text, language=data.get("language", lang), confidence=data.get("confidence"))


@app.post("/llm/chat", response_model=LLMResponse, tags=["LLM — Казахский ИИ"])
async def chat_llm(req: LLMRequest, x_api_key: Optional[str] = Header(None)):
    """
    **Генерация ответа на казахском/русском** через ISSAI Oylan 3.0.
    Все вычисления на серверах ISSAI — ноутбук не нагружается.
    """
    _guard(x_api_key)
    headers = _issai_headers()

    messages = []
    if req.system_prompt:
        messages.append({"role": "system", "content": req.system_prompt})
    for msg in req.messages:
        messages.append({"role": msg.role, "content": msg.content})

    payload = {
        "model":       OYLAN_MODEL,
        "messages":    messages,
        "max_tokens":  req.max_tokens,
        "temperature": req.temperature,
        "language":    req.language or "kk",
        "stream":      False,
    }

    logger.info(f"LLM: модель={OYLAN_MODEL}, язык={req.language}, сообщений={len(messages)}")

    async with httpx.AsyncClient(timeout=90.0) as client:
        try:
            resp = await client.post(
                f"{ISSAI_OYLAN_BASE}/v1/chat/completions",
                headers=headers,
                json=payload,
            )
        except httpx.ConnectError:
            raise HTTPException(502, "Не удалось подключиться к ISSAI Oylan API")
        except httpx.TimeoutException:
            raise HTTPException(504, "ISSAI Oylan API timeout")

        if resp.status_code == 401:
            raise HTTPException(401, "Неверный ISSAI_API_KEY. Проверьте https://issai.kz")
        if resp.status_code == 429:
            raise HTTPException(429, "Превышен лимит ISSAI Oylan API")
        if not resp.is_success:
            logger.error(f"Oylan LLM {resp.status_code}: {resp.text[:300]}")
            raise HTTPException(502, f"ISSAI Oylan вернул {resp.status_code}")

        data = resp.json()

    try:
        answer = data["choices"][0]["message"]["content"].strip()
    except (KeyError, IndexError):
        answer = data.get("response") or data.get("text") or ""

    if not answer:
        raise HTTPException(502, "ISSAI Oylan вернул пустой ответ")

    return LLMResponse(text=answer, model=data.get("model", OYLAN_MODEL), language=req.language or "kk")

# backend/app/main.py
import os
import logging
import asyncio
from typing import List, Dict, Any
from fastapi import FastAPI, HTTPException, File, UploadFile, Form, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from dotenv import load_dotenv

# Загрузка конфигурации
load_dotenv()
UPLOAD_DIR = "/app/uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("znatok")

# Инициализация FastAPI
app = FastAPI(title="Znatok API", version="0.1.0")

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in os.getenv('ALLOWED_ORIGINS', '*').split(',')],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Импорты модулей
from .ingestion import index_document, delete_document_from_qdrant, get_qdrant_client
from .rag import search_qdrant, get_llm_response
from .models import ProviderType, ProviderConfig, Settings, load_settings, save_settings

# Глобальные переменные для интеграций
TELEGRAM_BOT_INSTANCE = None
BITRIX24_ROUTER_AVAILABLE = False

# Попытка импорта интеграций
try:
    from .telegram import start_telegram_bot, stop_telegram_bot
    TELEGRAM_AVAILABLE = True
except ImportError as e:
    logger.warning(f"Telegram интеграция недоступна: {e}")
    TELEGRAM_AVAILABLE = False

try:
    from .bitrix24 import router as bitrix24_router
    BITRIX24_ROUTER_AVAILABLE = True
    app.include_router(bitrix24_router)
except ImportError as e:
    logger.warning(f"Bitrix24 интеграция недоступна: {e}")
    BITRIX24_ROUTER_AVAILABLE = False

# Модели данных
class AskRequest(BaseModel):
    question: str
    user_department: str = "all"

class AskResponse(BaseModel):
    answer: str
    sources: List[dict]

class IntegrationUpdate(BaseModel):
    telegram: Dict[str, Any] = {}
    bitrix24: Dict[str, Any] = {}

# Эндпоинты приложения
@app.get("/api/health")
async def health():
    return {"status": "ok", "service": "znatok-backend"}

@app.post("/api/ask", response_model=AskResponse)
async def ask(request: AskRequest):
    question = request.question.strip()
    if not question:
        raise HTTPException(status_code=400, detail="Question is required")

    try:
        hits = search_qdrant(question, request.user_department)
    except Exception as e:
        logger.error(f"Qdrant search error: {e}")
        raise HTTPException(status_code=500, detail="Search failed")

    if not hits:
        return AskResponse(
            answer="Не нашёл ответа в документах компании.",
            sources=[]
        )

    context = "\n\n".join([f"Документ: {hit['source']}\n{hit['text']}" for hit in hits])
    prompt = f"Контекст:\n{context}\n\nВопрос: {question}\n\nОтвет:"

    try:
        answer = await get_llm_response(prompt)
    except Exception as e:
        logger.error(f"LLM error: {e}")
        raise HTTPException(status_code=502, detail="AI service unavailable")

    # Уникальные источники
    unique_sources = set()
    sources = []
    for hit in hits:
        source_name = hit["source"]
        if source_name not in unique_sources:
            unique_sources.add(source_name)
            sources.append({"source": source_name})
    
    return AskResponse(answer=answer, sources=sources)

@app.post("/api/upload")
async def upload_files(
    files: List[UploadFile] = File(...),
    department: str = Form("all")
):
    uploaded_files = []
    for file in files:
        if file.content_type not in [
            "application/pdf",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "text/plain"
        ] and not file.filename.lower().endswith('.txt'):
            raise HTTPException(status_code=400, detail=f"Неподдерживаемый тип: {file.filename}")

        delete_document_from_qdrant(file.filename)

        safe_filename = f"{hash(file.filename)}_{file.filename}"
        filepath = os.path.join(UPLOAD_DIR, safe_filename)
        with open(filepath, "wb") as f:
            f.write(await file.read())

        try:
            index_document(filepath, file.filename, department)
            uploaded_files.append(file.filename)
        except Exception as e:
            logger.error(f"Пропускаем файл {file.filename} из-за ошибки: {e}")
            continue

    return {"status": "ok", "uploaded_files": uploaded_files}

@app.get("/api/documents")
async def list_documents():
    try:
        client = get_qdrant_client()
        collection = os.getenv("QDRANT_COLLECTION", "znatok_chunks")
        
        if not client.collection_exists(collection):
            return []

        response = client.scroll(
            collection_name=collection,
            limit=1000,
            with_payload=True
        )
        
        sources = {}
        for point in response[0]:
            source = point.payload.get("source")
            uploaded_at = point.payload.get("uploaded_at")
            if source and source not in sources:
                sources[source] = {
                    "filename": source,
                    "uploaded_at": uploaded_at
                }
        
        return list(sources.values())

    except Exception as e:
        logger.error(f"Ошибка получения списка документов: {e}")
        return []

@app.delete("/api/documents/{filename}")
async def delete_document_endpoint(filename: str):
    if not filename or filename == "undefined":
        raise HTTPException(status_code=400, detail="Invalid filename")
    
    try:
        delete_document_from_qdrant(filename)
        return {"status": "ok"}
    except Exception as e:
        logger.error(f"Ошибка удаления документа {filename}: {e}")
        raise HTTPException(status_code=500, detail="Failed to delete document")

# Эндпоинты для настроек AI
@app.get("/api/settings")
async def get_settings():
    return load_settings()

@app.post("/api/settings")
async def update_settings(settings: Settings):
    save_settings(settings)
    return {"status": "ok"}

@app.get("/api/providers")
async def get_providers():
    return {
        "providers": [
            {"id": "gigachat", "name": "GigaChat", "description": "SberBank AI"},
            {"id": "yandex_gpt", "name": "Yandex GPT", "description": "Yandex Large Language Model"},
            {"id": "mistral", "name": "Mistral", "description": "Mistral AI Models"}
        ]
    }

# === НОВЫЕ ЭНДПОИНТЫ ДЛЯ ИНТЕГРАЦИЙ ===

@app.get("/api/integrations")
async def get_integrations():
    """Возвращает состояние интеграций и их настройки (без секретов в UI)"""
    settings = load_settings()
    integrations = settings.integrations or {}
    
    def is_configured(name: str) -> bool:
        secret = integrations.get(name, {}).get("bot_token" if name == "telegram" else "client_secret")
        return bool(secret)
    
    return {
        "telegram": {
            "available": TELEGRAM_AVAILABLE,
            "configured": is_configured("telegram"),
            "health": "active" if is_configured("telegram") else "not_configured"
        },
        "bitrix24": {
            "available": BITRIX24_ROUTER_AVAILABLE,
            "configured": is_configured("bitrix24"),
            "health": "active" if is_configured("bitrix24") else "not_configured",
            "webhook_url": f"{os.getenv('BASE_URL', 'http://localhost:8000')}/bitrix24/webhook"
        }
    }

@app.post("/api/integrations")
async def update_integrations(update: IntegrationUpdate):
    """Обновляет настройки интеграций"""
    settings = load_settings()
    if not settings.integrations:
        settings.integrations = {"telegram": {}, "bitrix24": {}}
    
    # Обновляем только указанные поля
    if update.telegram:
        settings.integrations["telegram"]["bot_token"] = update.telegram.get("bot_token")
    if update.bitrix24:
        settings.integrations["bitrix24"]["client_secret"] = update.bitrix24.get("client_secret")
    
    save_settings(settings)
    
    # Перезапуск Telegram бота, если изменился токен
    if TELEGRAM_AVAILABLE and update.telegram and "bot_token" in update.telegram:
        global TELEGRAM_BOT_INSTANCE
        if TELEGRAM_BOT_INSTANCE:
            await stop_telegram_bot()
            TELEGRAM_BOT_INSTANCE = None
        if update.telegram["bot_token"]:
            from .telegram import ZnatokTelegramBot
            bot = ZnatokTelegramBot(backend_url=os.getenv("BASE_URL", "http://localhost:8000"))
            TELEGRAM_BOT_INSTANCE = bot
            asyncio.create_task(bot.run())
            logger.info("Telegram бот перезапущен с новым токеном")
    
    return {"status": "ok"}

# Эндпоинт сброса коллекции (для разработки)
@app.delete("/api/reset-collection")
async def reset_collection():
    try:
        client = get_qdrant_client()
        collection = os.getenv("QDRANT_COLLECTION", "znatok_chunks")
        if client.collection_exists(collection):
            client.delete_collection(collection)
            logger.info(f"Коллекция {collection} удалена")
        return {"status": "collection reset"}
    except Exception as e:
        logger.error(f"Ошибка сброса коллекции: {e}")
        raise HTTPException(status_code=500, detail="Failed to reset collection")

# События жизненного цикла
@app.on_event("startup")
async def startup_event():
    logger.info("Запуск сервиса Znatok...")
    settings = load_settings()
    
    # Запуск Telegram бота
    if TELEGRAM_AVAILABLE:
        telegram_token = settings.integrations.get("telegram", {}).get("bot_token")
        if telegram_token:
            try:
                from .telegram import ZnatokTelegramBot
                global TELEGRAM_BOT_INSTANCE
                TELEGRAM_BOT_INSTANCE = ZnatokTelegramBot(
                    backend_url=os.getenv("BASE_URL", "http://localhost:8000")
                )
                asyncio.create_task(TELEGRAM_BOT_INSTANCE.run())
                logger.info("Telegram бот запущен")
            except Exception as e:
                logger.error(f"Ошибка запуска Telegram бота: {e}")
        else:
            logger.warning("Telegram бот не запущен — токен не задан в настройках")
    else:
        logger.warning("Telegram интеграция недоступна")

    # Bitrix24: роутер уже подключён, проверяем настройки
    if BITRIX24_ROUTER_AVAILABLE:
        bitrix_secret = settings.integrations.get("bitrix24", {}).get("client_secret")
        if bitrix_secret:
            logger.info("Bitrix24 интеграция активна")
        else:
            logger.warning("Bitrix24 не настроен — отсутствует client_secret")

@app.get("/")
async def root():
    integrations = []
    settings = load_settings()
    
    if TELEGRAM_AVAILABLE and settings.integrations.get("telegram", {}).get("bot_token"):
        integrations.append("telegram")
    if BITRIX24_ROUTER_AVAILABLE and settings.integrations.get("bitrix24", {}).get("client_secret"):
        integrations.append("bitrix24")
    
    return {
        "service": "Znatok AI Assistant",
        "version": "1.0.0",
        "integrations": integrations,
        "endpoints": {
            "api": "/api/health",
            "bitrix24": "/bitrix24/health" if BITRIX24_ROUTER_AVAILABLE else "not_available",
            "docs": "/docs"
        }
    }

# Глобальный обработчик ошибок
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.error(f"Глобальная ошибка: {exc}", exc_info=True)
    return JSONResponse(
        status_code=500,
        content={"detail": "Внутренняя ошибка сервера"}
    )
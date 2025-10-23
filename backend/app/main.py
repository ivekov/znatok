import os
import logging
import asyncio
from typing import List
from fastapi import FastAPI, HTTPException, File, UploadFile, Form
from fastapi.middleware.cors import CORSMiddleware
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

# Импорты интеграций (если они настроены)
try:
    from .bitrix24 import router as bitrix24_router
    from .telegram import start_telegram_bot
    BITRIX24_AVAILABLE = True
    TELEGRAM_AVAILABLE = True
except ImportError as e:
    logger.warning(f"Некоторые интеграции недоступны: {e}")
    BITRIX24_AVAILABLE = False
    TELEGRAM_AVAILABLE = False

# Подключаем роутер Битрикс24 если доступен
if BITRIX24_AVAILABLE:
    app.include_router(bitrix24_router)

# Модели данных
class AskRequest(BaseModel):
    question: str
    user_department: str = "all"

class AskResponse(BaseModel):
    answer: str
    sources: List[dict]

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

        # Удаляем старую версию документа из Qdrant
        delete_document_from_qdrant(file.filename)

        # Сохраняем файл на диск
        safe_filename = f"{hash(file.filename)}_{file.filename}"
        filepath = os.path.join(UPLOAD_DIR, safe_filename)
        with open(filepath, "wb") as f:
            f.write(await file.read())

        # Индексируем в Qdrant
        try:
            index_document(filepath, file.filename, department)
            uploaded_files.append(file.filename)
        except Exception as e:
            logger.error(f"Пропускаем файл {file.filename} из-за ошибки: {e}")
            continue

    return {"status": "ok", "uploaded_files": uploaded_files}

@app.get("/api/documents")
async def list_documents():
    """Возвращает список документов напрямую из Qdrant."""
    try:
        client = get_qdrant_client()
        collection = os.getenv("QDRANT_COLLECTION", "znatok_chunks")
        
        if not client.collection_exists(collection):
            return []

        # Получаем все точки (ограничено 1000 — достаточно для MVP)
        response = client.scroll(
            collection_name=collection,
            limit=1000,
            with_payload=True
        )
        
        # Собираем уникальные имена файлов
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
    """Удаляет документ по имени файла."""
    if not filename or filename == "undefined":
        raise HTTPException(status_code=400, detail="Invalid filename")
    
    try:
        delete_document_from_qdrant(filename)
        return {"status": "ok"}
    except Exception as e:
        logger.error(f"Ошибка удаления документа {filename}: {e}")
        raise HTTPException(status_code=500, detail="Failed to delete document")

# Эндпоинты для настроек
@app.get("/api/settings")
async def get_settings():
    """Получить текущие настройки"""
    return load_settings()

@app.post("/api/settings")
async def update_settings(settings: Settings):
    """Обновить настройки"""
    save_settings(settings)
    return {"status": "ok"}

@app.get("/api/providers")
async def get_providers():
    """Получить список доступных провайдеров"""
    return {
        "providers": [
            {"id": "gigachat", "name": "GigaChat", "description": "SberBank AI"},
            {"id": "yandex_gpt", "name": "Yandex GPT", "description": "Yandex Large Language Model"},
            {"id": "mistral", "name": "Mistral", "description": "Mistral AI Models"}
        ]
    }

@app.delete("/api/reset-collection")
async def reset_collection():
    """Временный эндпоинт для сброса коллекции (только для разработки)"""
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

@app.on_event("startup")
async def startup_event():
    """Запускаем интеграции при старте приложения"""
    logger.info("Запуск интеграций...")
    
    # Запускаем Telegram бота в фоне если доступен и настроен
    if TELEGRAM_AVAILABLE and os.getenv("TELEGRAM_BOT_TOKEN"):
        try:
            asyncio.create_task(start_telegram_bot())
            logger.info("Telegram бот запущен")
        except Exception as e:
            logger.error(f"Ошибка запуска Telegram бота: {e}")
    else:
        logger.warning("Telegram бот не запущен - токен не задан или интеграция недоступна")
    
    # Битрикс24 бот запускается автоматически через роутер
    if BITRIX24_AVAILABLE and os.getenv("BITRIX24_CLIENT_SECRET"):
        logger.info("Bitrix24 бот готов к работе")
    else:
        logger.warning("Bitrix24 бот не настроен - секрет не задан или интеграция недоступна")

@app.get("/")
async def root():
    """Корневой эндпоинт с информацией о сервисе"""
    integrations = []
    
    if TELEGRAM_AVAILABLE and os.getenv("TELEGRAM_BOT_TOKEN"):
        integrations.append("telegram")
    if BITRIX24_AVAILABLE and os.getenv("BITRIX24_CLIENT_SECRET"):
        integrations.append("bitrix24")
    
    return {
        "service": "Znatok AI Assistant",
        "version": "1.0.0",
        "integrations": integrations,
        "endpoints": {
            "api": "/api/health",
            "bitrix24": "/bitrix24/health" if BITRIX24_AVAILABLE else "not_available",
            "docs": "/docs"
        }
    }

# Эндпоинт для проверки статуса интеграций
@app.get("/integrations")
async def get_integrations_status():
    """Возвращает статус всех интеграций"""
    integrations_status = {}
    
    # Telegram статус
    if TELEGRAM_AVAILABLE:
        integrations_status["telegram"] = {
            "available": True,
            "configured": bool(os.getenv("TELEGRAM_BOT_TOKEN")),
            "health": "active" if os.getenv("TELEGRAM_BOT_TOKEN") else "not_configured"
        }
    else:
        integrations_status["telegram"] = {
            "available": False,
            "configured": False,
            "health": "integration_not_available"
        }
    
    # Bitrix24 статус
    if BITRIX24_AVAILABLE:
        integrations_status["bitrix24"] = {
            "available": True,
            "configured": bool(os.getenv("BITRIX24_CLIENT_SECRET")),
            "health": "active" if os.getenv("BITRIX24_CLIENT_SECRET") else "not_configured"
        }
    else:
        integrations_status["bitrix24"] = {
            "available": False,
            "configured": False,
            "health": "integration_not_available"
        }
    
    return integrations_status

# Глобальный обработчик ошибок
@app.exception_handler(Exception)
async def global_exception_handler(request, exc):
    """Глобальный обработчик исключений"""
    logger.error(f"Глобальная ошибка: {exc}", exc_info=True)
    return JSONResponse(
        status_code=500,
        content={"detail": "Внутренняя ошибка сервера"}
    )
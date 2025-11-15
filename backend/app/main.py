# backend/app/main.py
import os
import logging
import asyncio
import httpx
from typing import List, Optional, Dict, Any
from fastapi import FastAPI, HTTPException, File, UploadFile, Form, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from dotenv import load_dotenv


# Загрузка конфигурации
load_dotenv()
UPLOAD_DIR = "/app/uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("znatok")

# Простое in-memory хранилище контекста (в проде — Redis)
_CHAT_CONTEXTS = defaultdict(list)  # conversation_id -> list of messages
_CONTEXT_TTL = timedelta(minutes=30)

def _cleanup_old_contexts():
    """Очистка старых контекстов"""
    now = datetime.utcnow()
    to_delete = []
    for conv_id, msgs in _CHAT_CONTEXTS.items():
        if msgs and (now - msgs[-1].get("timestamp", now)) > _CONTEXT_TTL:
            to_delete.append(conv_id)
    for conv_id in to_delete:
        del _CHAT_CONTEXTS[conv_id]

async def sync_bitrix24_kb():
    """Синхронизирует статьи из Битрикс24 Базы знаний"""
    settings = load_settings()
    kb_config = settings.knowledge_sources.get("bitrix24_kb", {})
    
    if not kb_config.get("enabled") or not kb_config.get("domain") or not kb_config.get("access_token"):
        logger.warning("Bitrix24 KB sync skipped: not configured")
        return {"status": "skipped", "reason": "not configured"}

    domain = kb_config["domain"]
    token = kb_config["access_token"]
    last_sync = kb_config.get("last_sync")
    
    if not domain.startswith("https://"):
        domain = f"https://{domain.strip('/')}"
    
    articles_synced = 0
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            # Получаем список статей
            resp = await client.post(
                f"{domain}/rest/crm/knowledge-base/article.list",
                json={"auth": token}
            )
            resp.raise_for_status()
            data = resp.json()
            
            if "result" not in data or "articles" not in data["result"]:
                raise ValueError(f"Unexpected Bitrix24 response: {data}")
            
            articles = data["result"]["articles"]
            now = datetime.now(timezone.utc).isoformat()
            
            for article in articles:
                # Пропускаем, если не изменилась с последней синхронизации
                updated = article.get("updated")
                if last_sync and updated and updated <= last_sync:
                    continue
                
                # Получаем полный текст статьи
                detail_resp = await client.post(
                    f"{domain}/rest/crm/knowledge-base/article.get",
                    json={"auth": token, "id": article["id"]}
                )
                detail_resp.raise_for_status()
                detail = detail_resp.json()
                
                if "result" not in detail or "text" not in detail["result"]:
                    logger.warning(f"Пропускаем статью {article['id']}: нет текста")
                    continue
                
                text = detail["result"]["text"]
                source_name = f"bitrix24_kb:{article['id']}"
                
                # Индексируем
                await index_text_content(text, source_name, "all")
                articles_synced += 1
            
            # Обновляем время последней синхронизации
            kb_config["last_sync"] = now
            settings.knowledge_sources["bitrix24_kb"] = kb_config
            save_settings(settings)
            
            logger.info(f"Синхронизировано {articles_synced} статей из Bitrix24 KB")
            return {"status": "ok", "synced": articles_synced}
            
    except Exception as e:
        logger.error(f"Ошибка синхронизации Bitrix24 KB: {e}")
        return {"status": "error", "message": str(e)}

async def sync_confluence():
    """Синхронизирует статьи из Confluence с надёжной пагинацией и обработкой ошибок"""
    settings = load_settings()
    ks = settings.knowledge_sources or {}
    conf = ks.get("confluence", {})
    
    if not (
        conf.get("enabled") and 
        conf.get("base_url") and 
        conf.get("email") and 
        conf.get("api_token")
    ):
        logger.warning("Confluence sync skipped: not configured")
        return {"status": "skipped", "reason": "not configured"}

    base_url = conf["base_url"].rstrip("/")
    if not base_url.startswith("https://"):
        base_url = f"https://{base_url}"

    space_key = conf.get("space_key")
    last_sync = conf.get("last_sync")
    auth = (conf["email"], conf["api_token"])

    try:
        articles_synced = 0
        start = 0
        limit = 250

        async with httpx.AsyncClient(timeout=30.0) as client:
            while True:
                # Формируем URL с пагинацией
                url = f"{base_url}/rest/api/content"
                params = {
                    "type": "page",
                    "expand": "version,history,body.storage",
                    "limit": limit,
                    "start": start
                }
                if space_key:
                    params["spaceKey"] = space_key

                resp = await client.get(url, auth=auth, params=params)
                if resp.status_code == 401:
                    raise ValueError("Неверные учётные данные Confluence (email или API token)")
                if resp.status_code == 404:
                    raise ValueError("Не найден указанный SpaceKey или неверный Base URL")
                resp.raise_for_status()

                data = resp.json()
                results = data.get("results", [])
                if not results:
                    break

                for page in results:
                    # Безопасное извлечение даты последнего обновления
                    last_modified = None
                    history = page.get("history") or {}
                    last_updated = history.get("lastUpdated")
                    if last_updated and isinstance(last_updated, dict):
                        last_modified = last_updated.get("when")
                    elif history.get("created") and isinstance(history["created"], dict):
                        # fallback: используем дату создания, если нет lastUpdated
                        last_modified = history["created"].get("when")

                    # Пропускаем, если не изменилась с последней синхронизации
                    if last_sync and last_modified and last_modified <= last_sync:
                        continue

                    # Извлекаем текст
                    body = page.get("body") or {}
                    storage = body.get("storage") or {}
                    html = storage.get("value") or ""
                    
                    if not html.strip():
                        logger.warning(f"Страница {page['id']} пустая, пропускаем")
                        continue

                    text = BeautifulSoup(html, "html.parser").get_text(separator="\n", strip=True)
                    if not text.strip():
                        logger.warning(f"Текст страницы {page['id']} не извлечён, пропускаем")
                        continue

                    source = f"confluence:{page['id']}"
                    try:
                        await index_text_content(text, source, "all")
                        articles_synced += 1
                    except Exception as e:
                        logger.error(f"Ошибка индексации страницы {page['id']}: {e}")
                        continue

                # Проверка окончания пагинации
                if len(results) < limit:
                    break
                start += limit

            # Обновляем last_sync только при успешной синхронизации
            conf["last_sync"] = datetime.now(timezone.utc).isoformat()
            settings.knowledge_sources["confluence"] = conf
            save_settings(settings)

            logger.info(f"✅ Синхронизировано {articles_synced} статей из Confluence")
            return {"status": "ok", "synced": articles_synced}

    except Exception as e:
        error_msg = str(e)
        logger.error(f"❌ Ошибка синхронизации Confluence: {error_msg}")
        return {"status": "error", "message": error_msg}

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
_active_telegram_bot = None
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
    conversation_id: Optional[str] = None

class AskResponse(BaseModel):
    answer: str
    sources: List[dict]
    conversation_id: str

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

    conv_id = request.conversation_id or os.urandom(8).hex()
    context_question = question

    if conv_id in _CHAT_CONTEXTS and _CHAT_CONTEXTS[conv_id]:
        history = "\n".join([
            f"{'Вопрос' if msg['role'] == 'user' else 'Ответ'}: {msg['content']}"
            for msg in _CHAT_CONTEXTS[conv_id][-2:]
        ])
        context_question = f"История диалога:\n{history}\n\nНовый вопрос: {question}"

    try:
        hits = search_qdrant(context_question, request.user_department)
    except Exception as e:
        logger.error(f"Qdrant search error: {e}")
        raise HTTPException(status_code=500, detail="Search failed")

    if not hits:
        _CHAT_CONTEXTS[conv_id].append({"role": "user", "content": question, "timestamp": datetime.utcnow()})
        _CHAT_CONTEXTS[conv_id].append({"role": "assistant", "content": "Не нашёл ответа в документах компании.", "timestamp": datetime.utcnow()})
        return AskResponse(
            answer="Не нашёл ответа в документах компании.",
            sources=[],
            conversation_id=conv_id
        )

    context = "\n\n".join([f"Документ: {hit['source']}\n{hit['text']}" for hit in hits])
    prompt = f"Контекст:\n{context}\n\nВопрос: {context_question}\n\nОтвет:"

    try:
        answer = await get_llm_response(prompt)
    except Exception as e:
        logger.error(f"LLM error: {e}")
        raise HTTPException(status_code=502, detail="AI service unavailable")

    unique_sources = set()
    sources = []
    for hit in hits:
        source_name = hit["source"]
        if source_name not in unique_sources:
            unique_sources.add(source_name)
            sources.append({"source": source_name})

    _CHAT_CONTEXTS[conv_id].append({"role": "user", "content": question, "timestamp": datetime.utcnow()})
    _CHAT_CONTEXTS[conv_id].append({"role": "assistant", "content": answer, "timestamp": datetime.utcnow()})

    if len(_CHAT_CONTEXTS) > 1000:
        _cleanup_old_contexts()

    return AskResponse(answer=answer, sources=sources, conversation_id=conv_id)

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

# Эндпоинты для интеграций
@app.get("/api/integrations")
async def get_integrations():
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
    settings = load_settings()
    if not settings.integrations:
        settings.integrations = {"telegram": {}, "bitrix24": {}}
    
    if update.telegram:
        settings.integrations["telegram"]["bot_token"] = update.telegram.get("bot_token")
    if update.bitrix24:
        settings.integrations["bitrix24"]["client_secret"] = update.bitrix24.get("client_secret")
    
    save_settings(settings)
    
    # Перезапуск Telegram бота
    if TELEGRAM_AVAILABLE and update.telegram and "bot_token" in update.telegram:
        global _active_telegram_bot
        if _active_telegram_bot:
            await stop_telegram_bot()
            _active_telegram_bot = None
        if update.telegram["bot_token"]:
            backend_url = os.getenv("BASE_URL", "http://localhost:8000")
            _active_telegram_bot = asyncio.create_task(
                start_telegram_bot(backend_url=backend_url, bot_token=update.telegram["bot_token"])
            )
            logger.info("Telegram бот перезапущен с новым токеном")
    
    return {"status": "ok"}

# Эндпоинт сброса коллекции (только для разработки)
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
                backend_url = os.getenv("BASE_URL", "http://localhost:8000")
                global _active_telegram_bot
                _active_telegram_bot = asyncio.create_task(
                    start_telegram_bot(backend_url=backend_url, bot_token=telegram_token)
                )
                logger.info("Telegram бот запущен")
            except Exception as e:
                logger.error(f"Ошибка запуска Telegram бота: {e}")
        else:
            logger.warning("Telegram бот не запущен — токен не задан в настройках")
    else:
        logger.warning("Telegram интеграция недоступна")

    # Bitrix24: роутер уже подключён
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

# Эндпоинт статуса интеграций (дублирует /api/integrations для обратной совместимости)
@app.get("/integrations")
async def get_integrations_status():
    return await get_integrations()

# Глобальный обработчик ошибок
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.error(f"Глобальная ошибка: {exc}", exc_info=True)
    return JSONResponse(
        status_code=500,
        content={"detail": "Внутренняя ошибка сервера"}
    )

# Эндпоинт для ручного запуска
@app.post("/api/sources/bitrix24/kb/sync")
async def trigger_bitrix24_kb_sync():
    result = await sync_bitrix24_kb()
    if result["status"] == "error":
        raise HTTPException(status_code=500, detail=result["message"])
    return result

# Эндпоинт для получения статуса
@app.get("/api/sources/bitrix24/kb/status")
async def get_bitrix24_kb_status():
    settings = load_settings()
    kb = settings.knowledge_sources.get("bitrix24_kb", {})
    return {
        "enabled": kb.get("enabled", False),
        "domain": kb.get("domain"),
        "last_sync": kb.get("last_sync"),
        "configured": bool(kb.get("domain") and kb.get("access_token"))
    }

@app.post("/api/sources/confluence/sync")
async def trigger_confluence_sync():
    result = await sync_confluence()
    if result["status"] == "error":
        raise HTTPException(status_code=500, detail=result["message"])
    return result

@app.get("/api/sources/confluence/status")
async def get_confluence_status():
    settings = load_settings()
    ks = settings.knowledge_sources or {}
    conf = ks.get("confluence", {})
    
    base_url = conf.get("base_url")
    email = conf.get("email")  # ← добавлено
    api_token = conf.get("api_token")
    configured = bool(base_url and email and api_token)
    
    return {
        "enabled": bool(conf.get("enabled")),
        "base_url": base_url,
        "email": email,            # ← отдаём
        "api_token": api_token,    # ← отдаём (фронтенд сам заменит на ••••)
        "space_key": conf.get("space_key"),
        "last_sync": conf.get("last_sync"),
        "configured": configured
    }
import os
import logging
from typing import List
from fastapi import FastAPI, HTTPException, File, UploadFile, Form
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv
from .ingestion import index_document, delete_document_from_qdrant, get_qdrant_client

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

# Модели данных
class AskRequest(BaseModel):
    question: str
    user_department: str = "all"

class AskResponse(BaseModel):
    answer: str
    sources: List[dict]

# Эндпоинты
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
        token = await get_gigachat_token()
        answer = await call_gigachat(prompt, token)
    except Exception as e:
        logger.error(f"GigaChat error: {e}")
        raise HTTPException(status_code=502, detail="AI service unavailable")

    # ФИКС: Уникальные источники вместо дубликатов
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

        response = client.scroll(
            collection_name=collection,
            limit=1000,
            with_payload=True
        )
        
        # Собираем уникальные имена файлов ИЗ PAYLOAD (оригинальные имена)
        sources = {}
        for point in response[0]:
            source = point.payload.get("source")
            uploaded_at = point.payload.get("uploaded_at")
            if source and source not in sources:
                sources[source] = {
                    "filename": source,  # Оригинальное имя, а не хэшированное
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

# Импорты RAG-функций (должны быть в конце, чтобы избежать circular import)
from .rag import search_qdrant, get_gigachat_token, call_gigachat
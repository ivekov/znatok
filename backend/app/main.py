# backend/app/main.py
import os
import logging
from typing import List
from fastapi import FastAPI, HTTPException, File, UploadFile, Form
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv

from .storage import add_document, get_documents, delete_document
from .ingestion import index_document
from .rag import search_qdrant, get_gigachat_token, call_gigachat

# Настройка
load_dotenv()
UPLOAD_DIR = "/app/uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("znatok")

app = FastAPI(title="Znatok API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in os.getenv('ALLOWED_ORIGINS', '*').split(',')],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Модели
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

    # Поиск в Qdrant
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

    # Формирование контекста
    context = "\n\n".join([f"Документ: {hit['source']}\n{hit['text']}" for hit in hits])
    prompt = f"Контекст:\n{context}\n\nВопрос: {question}\n\nОтвет:"

    # Генерация ответа
    try:
        token = await get_gigachat_token()
        answer = await call_gigachat(prompt, token)
    except Exception as e:
        logger.error(f"GigaChat error: {e}")
        raise HTTPException(status_code=502, detail="AI service unavailable")

    sources = [{"source": hit["source"]} for hit in hits]
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
        ] and not file.filename.lower().endswith('.txt'):  # fallback для txt
            raise HTTPException(status_code=400, detail=f"Неподдерживаемый тип: {file.filename}")

        safe_filename = f"{hash(file.filename)}_{file.filename}"
        filepath = os.path.join(UPLOAD_DIR, safe_filename)
        with open(filepath, "wb") as f:
            f.write(await file.read())

        doc_id = add_document(file.filename, department, filepath)

        try:
            chunks_count = index_document(filepath, file.filename, department, doc_id)
        except Exception as e:
            # Важно: не прерываем загрузку других файлов
            logger.error(f"Пропускаем файл {file.filename} из-за ошибки: {e}")
            continue

        uploaded_files.append(file.filename)

    return {"status": "ok", "uploaded_files": uploaded_files}

@app.get("/api/documents")
async def list_documents():
    return get_documents()

@app.delete("/api/documents/{doc_id}")
async def delete_document_endpoint(doc_id: str):
    if delete_document(doc_id):
        # TODO: удалить из Qdrant по doc_id
        return {"status": "ok"}
    raise HTTPException(status_code=404, detail="Document not found")
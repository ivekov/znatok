import os
import uuid
import logging
from datetime import datetime
from typing import List
from qdrant_client import QdrantClient
from qdrant_client.models import PointStruct, VectorParams, Distance, Filter, FieldCondition, MatchValue
from qdrant_client.http.models import FilterSelector  # ← добавили для удаления
from sentence_transformers import SentenceTransformer

logger = logging.getLogger("znatok.ingestion")

_EMBEDDING_MODEL = None
_QDRANT_CLIENT = None

def get_embedding_model():
    global _EMBEDDING_MODEL
    if _EMBEDDING_MODEL is None:
        logger.info("Загрузка модели эмбеддингов...")# Используйте (в 3 раза меньше и быстрее)
        _EMBEDDING_MODEL = SentenceTransformer('sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2')
        logger.info("Модель загружена.")
    return _EMBEDDING_MODEL

def get_qdrant_client():
    global _QDRANT_CLIENT
    if _QDRANT_CLIENT is None:
        host = os.getenv("QDRANT_HOST", "qdrant")
        port = int(os.getenv("QDRANT_PORT", 6333))
        _QDRANT_CLIENT = QdrantClient(host=host, port=port)
    return _QDRANT_CLIENT

def ensure_collection_exists(collection_name: str):
    client = get_qdrant_client()
    if not client.collection_exists(collection_name):
        logger.info(f"Создаём коллекцию {collection_name} с размерностью 384")
        client.create_collection(
            collection_name=collection_name,
            vectors_config=VectorParams(size=384, distance=Distance.COSINE)  # ← 384 вместо 1024
        )

def chunk_text(text: str, max_length: int = 512) -> List[str]:
    import re
    if not text.strip():
        return []
    sentences = re.split(r'(?<=[.!?])\s+', text)
    chunks = []
    current = ""
    for sent in sentences:
        if len(current) + len(sent) < max_length:
            current += " " + sent
        else:
            if current:
                chunks.append(current.strip())
            current = sent
    if current:
        chunks.append(current.strip())
    return chunks or [text[:max_length]]

def read_text_file(filepath: str) -> str:
    encodings = ['utf-8', 'cp1251', 'iso-8859-1']
    for enc in encodings:
        try:
            with open(filepath, 'r', encoding=enc) as f:
                return f.read()
        except UnicodeDecodeError:
            continue
    with open(filepath, 'rb') as f:
        return f.read().decode('utf-8', errors='replace')

def delete_document_from_qdrant(filename: str):
    """Удаляет документ из Qdrant по имени файла."""
    if not filename or filename == "undefined":
        logger.warning(f"Попытка удаления с невалидным именем: {filename}")
        return

    try:
        client = get_qdrant_client()
        collection = os.getenv("QDRANT_COLLECTION", "znatok_chunks")
        if not client.collection_exists(collection):
            return

        # ВАЖНО: используем оригинальное имя файла (без хэша)
        # При индексации мы сохраняем оригинальное имя в payload.source
        delete_filter = Filter(
            must=[FieldCondition(key="source", match=MatchValue(value=filename))]
        )
        
        client.delete(
            collection_name=collection,
            points_selector=FilterSelector(filter=delete_filter)
        )
        logger.info(f"Удалено из Qdrant: {filename}")
    except Exception as e:
        logger.warning(f"Ошибка удаления из Qdrant: {e}")

def index_document(filepath: str, filename: str, department: str):
    """Индексирует документ в Qdrant."""
    try:
        delete_document_from_qdrant(filename)

        # Извлечение текста с использованием более простых методов
        if filename.lower().endswith('.txt'):
            text = read_text_file(filepath)
        elif filename.lower().endswith('.pdf'):
            # Используем PyPDF2 для PDF
            from PyPDF2 import PdfReader
            reader = PdfReader(filepath)
            text = ""
            for page in reader.pages:
                text += page.extract_text() + "\n"
        elif filename.lower().endswith(('.docx', '.doc')):
            # Используем python-docx для Word
            from docx import Document
            doc = Document(filepath)
            text = "\n".join([paragraph.text for paragraph in doc.paragraphs])
        else:
            # Для других форматов используем минимальную версию unstructured
            from unstructured.partition.auto import partition
            elements = partition(filename=filepath)
            text = "\n".join([str(el) for el in elements])
        
        if not text.strip():
            raise ValueError("Пустой текст")

        chunks = chunk_text(text)
        if not chunks:
            raise ValueError("Нет чанков")

        model = get_embedding_model()
        embeddings = model.encode([f"passage: {chunk}" for chunk in chunks]).tolist()

        points = []
        uploaded_at = datetime.utcnow().isoformat()
        for chunk, emb in zip(chunks, embeddings):
            points.append(PointStruct(
                id=str(uuid.uuid4()),
                vector=emb,
                payload={
                    "text": chunk,
                    "source": filename,
                    "department": department,
                    "uploaded_at": uploaded_at
                }
            ))

        collection = os.getenv("QDRANT_COLLECTION", "znatok_chunks")
        ensure_collection_exists(collection)
        client = get_qdrant_client()
        client.upsert(collection_name=collection, points=points)

        logger.info(f"Проиндексировано {len(chunks)} чанков из {filename}")
        return len(chunks)

    except Exception as e:
        logger.error(f"Ошибка индексации {filename}: {e}", exc_info=True)
        raise
    
async def index_text_content(text: str, source: str, department: str = "all"):
    """
    Индексирует чистый текст (без файла на диске)
    """
    if not text.strip():
        raise ValueError("Пустой текст")

    chunks = chunk_text(text)
    if not chunks:
        raise ValueError("Нет чанков")

    model = get_embedding_model()
    embeddings = model.encode([f"passage: {chunk}" for chunk in chunks]).tolist()

    points = []
    uploaded_at = datetime.utcnow().isoformat()
    for chunk, emb in zip(chunks, embeddings):
        points.append(PointStruct(
            id=str(uuid.uuid4()),
            vector=emb,
            payload={
                "text": chunk,
                "source": source,
                "department": department,
                "uploaded_at": uploaded_at
            }
        ))

    collection = os.getenv("QDRANT_COLLECTION", "znatok_chunks")
    ensure_collection_exists(collection)
    client = get_qdrant_client()
    
    # Удаляем старую версию по source
    delete_filter = Filter(
        must=[FieldCondition(key="source", match=MatchValue(value=source))]
    )
    client.delete(
        collection_name=collection,
        points_selector=FilterSelector(filter=delete_filter)
    )
    
    client.upsert(collection_name=collection, points=points)
    logger.info(f"Проиндексировано {len(chunks)} чанков из источника: {source}")
    return len(chunks)
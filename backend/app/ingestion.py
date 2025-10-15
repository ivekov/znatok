# backend/app/ingestion.py
import os
import uuid
import logging
from typing import List
from qdrant_client import QdrantClient
from qdrant_client.models import PointStruct, VectorParams, Distance
from sentence_transformers import SentenceTransformer

logger = logging.getLogger("znatok.ingestion")

# Глобальные объекты
_EMBEDDING_MODEL = None
_QDRANT_CLIENT = None

def get_embedding_model():
    global _EMBEDDING_MODEL
    if _EMBEDDING_MODEL is None:
        logger.info("Загрузка модели эмбеддингов...")
        _EMBEDDING_MODEL = SentenceTransformer('intfloat/multilingual-e5-large')
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
        logger.info(f"Создаём коллекцию {collection_name}")
        client.create_collection(
            collection_name=collection_name,
            vectors_config=VectorParams(size=1024, distance=Distance.COSINE)
        )

def chunk_text(text: str, max_length: int = 512) -> List[str]:
    """Разбивка текста на чанки по предложениям."""
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
    """Надёжное чтение TXT-файла с разными кодировками."""
    encodings = ['utf-8', 'cp1251', 'iso-8859-1']
    for enc in encodings:
        try:
            with open(filepath, 'r', encoding=enc) as f:
                return f.read()
        except UnicodeDecodeError:
            continue
    # Если все кодировки провалились — читаем как бинарник
    with open(filepath, 'rb') as f:
        return f.read().decode('utf-8', errors='replace')

def index_document(filepath: str, filename: str, department: str, doc_id: str):
    """Индексирует документ в Qdrant."""
    try:
        # Извлечение текста
        text = ""
        if filename.lower().endswith('.txt'):
            text = read_text_file(filepath)
        else:
            # Для PDF/DOCX используем unstructured
            from unstructured.partition.auto import partition
            elements = partition(filename=filepath)
            text = "\n".join([str(el) for el in elements])
        
        if not text.strip():
            raise ValueError("Пустой текст после извлечения")

        # Разбивка на чанки
        chunks = chunk_text(text)
        if not chunks:
            raise ValueError("Нет чанков для индексации")

        # Эмбеддинги
        model = get_embedding_model()
        embeddings = model.encode([f"passage: {chunk}" for chunk in chunks]).tolist()

        # Подготовка точек
        points = []
        for chunk, emb in zip(chunks, embeddings):
            points.append(PointStruct(
                id=str(uuid.uuid4()),
                vector=emb,
                payload={
                    "text": chunk,
                    "source": filename,
                    "department": department,
                    "doc_id": doc_id
                }
            ))

        # Сохранение в Qdrant
        collection = os.getenv("QDRANT_COLLECTION", "znatok_chunks")
        ensure_collection_exists(collection)
        client = get_qdrant_client()
        client.upsert(collection_name=collection, points=points)

        logger.info(f"Успешно проиндексировано {len(chunks)} чанков из {filename}")
        return len(chunks)

    except Exception as e:
        logger.error(f"КРИТИЧЕСКАЯ ОШИБКА индексации {filename}: {e}", exc_info=True)
        raise
# backend/app/ingestion.py
import os
from typing import List
from qdrant_client import QdrantClient
from qdrant_client.models import PointStruct, VectorParams, Distance
from unstructured.partition.auto import partition
from sentence_transformers import SentenceTransformer

# Глобальная модель эмбеддингов (загружается один раз)
_EMBEDDING_MODEL = None
_QDRANT_CLIENT = None

def get_embedding_model():
    global _EMBEDDING_MODEL
    if _EMBEDDING_MODEL is None:
        # Используем multilingual модель — отлично работает с русским
        _EMBEDDING_MODEL = SentenceTransformer('intfloat/multilingual-e5-large')
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
        client.create_collection(
            collection_name=collection_name,
            vectors_config=VectorParams(size=1024, distance=Distance.COSINE)
        )

def chunk_text(text: str, max_length: int = 512) -> List[str]:
    """Простая разбивка на чанки по предложениям."""
    import re
    sentences = re.split(r'(?<=[.!?])\s+', text)
    chunks = []
    current_chunk = ""
    for sent in sentences:
        if len(current_chunk) + len(sent) < max_length:
            current_chunk += " " + sent
        else:
            if current_chunk:
                chunks.append(current_chunk.strip())
            current_chunk = sent
    if current_chunk:
        chunks.append(current_chunk.strip())
    return chunks or [text]

def index_document(filepath: str, filename: str, department: str, doc_id: str):
    """Извлекает текст, разбивает на чанки, индексирует в Qdrant."""
    try:
        # Извлечение текста
        elements = partition(filename=filepath)
        text = "\n".join([str(el) for el in elements])
        
        if not text.strip():
            raise ValueError("Пустой документ")

        # Разбивка на чанки
        chunks = chunk_text(text)

        # Эмбеддинги
        model = get_embedding_model()
        embeddings = model.encode([f"passage: {chunk}" for chunk in chunks]).tolist()

        # Подготовка точек
        points = []
        for i, (chunk, emb) in enumerate(zip(chunks, embeddings)):
            points.append(PointStruct(
                id=str(uuid.uuid4()),
                vector=emb,
                payload={
                    "text": chunk,
                    "source": filename,
                    "department": department,
                    "doc_id": doc_id,
                    "chunk_index": i
                }
            ))

        # Сохранение в Qdrant
        collection = os.getenv("QDRANT_COLLECTION", "znatok_chunks")
        ensure_collection_exists(collection)
        client = get_qdrant_client()
        client.upsert(collection_name=collection, points=points)

        return len(chunks)
    except Exception as e:
        print(f"Ошибка индексации {filename}: {e}")
        raise
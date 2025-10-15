# backend/app/rag.py
import os
import logging
import base64
import httpx
import uuid  # ← добавили импорт
from typing import List, Optional
from qdrant_client import QdrantClient
from qdrant_client.models import Filter, FieldCondition, MatchValue
from sentence_transformers import SentenceTransformer

logger = logging.getLogger("znatok.rag")

# Кэшируем
_EMBEDDING_MODEL = None
_QDRANT_CLIENT = None

# ======================
# GigaChat API
# ======================

async def get_gigachat_token() -> str:
    """Получает access_token для GigaChat API с уникальным RqUID."""
    auth_key = os.getenv("GIGACHAT_AUTHORIZATION_KEY")
    if not auth_key:
        raise ValueError("GIGACHAT_AUTHORIZATION_KEY не задан в .env")
    
    scope = os.getenv("GIGACHAT_SCOPE", "GIGACHAT_API_PERS")
    rq_uid = str(uuid.uuid4())  # ← генерируем UUID v4 для каждого запроса
    
    async with httpx.AsyncClient(verify=False) as client:  # ← НЕБЕЗОПАСНО! Только для теста
        try:
            resp = await client.post(
                "https://ngw.devices.sberbank.ru:9443/api/v2/oauth",
                headers={
                    "Authorization": f"Basic {auth_key}",
                    "RqUID": rq_uid,  # ← теперь валидный UUID v4
                    "Content-Type": "application/x-www-form-urlencoded",
                    "Accept": "application/json"
                },
                data={"scope": scope},
                timeout=10.0
            )
            resp.raise_for_status()
            return resp.json()["access_token"]
        except Exception as e:
            logger.error(f"GigaChat auth error (RqUID: {rq_uid}): {e}")
            raise

async def call_gigachat(prompt: str, token: str) -> str:
    """Отправляет запрос в GigaChat с уникальным RqUID."""
    rq_uid = str(uuid.uuid4())  # ← уникальный ID для каждого запроса к API
    
    async with httpx.AsyncClient(verify=False) as client:  # ← НЕБЕЗОПАСНО! Только для теста
        try:
            resp = await client.post(
                "https://gigachat.devices.sberbank.ru/api/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {token}",
                    "RqUID": rq_uid,  # ← обязательно для GigaChat API
                    "Content-Type": "application/json",
                    "Accept": "application/json"
                },
                json={
                    "model": "GigaChat",
                    "messages": [
                        {"role": "system", "content": "Ты — корпоративный ассистент «Знаток». Отвечай кратко, по делу, на русском языке. Если информации нет — скажи: «Не нашёл ответа в документах компании.»"},
                        {"role": "user", "content": prompt}
                    ],
                    "temperature": 0.1,
                    "max_tokens": 512
                },
                timeout=30.0
            )
            resp.raise_for_status()
            return resp.json()["choices"][0]["message"]["content"].strip()
        except Exception as e:
            logger.error(f"GigaChat inference error (RqUID: {rq_uid}): {e}")
            raise

# ======================
# Qdrant + Embeddings
# ======================

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

def build_metadata_filter(department: Optional[str] = None) -> Optional[Filter]:
    if not department or department == "all":
        return None
    return Filter(must=[FieldCondition(key="department", match=MatchValue(value=department))])

def search_qdrant(question: str, department: Optional[str] = None) -> List[dict]:
    try:
        client = get_qdrant_client()
        collection = os.getenv("QDRANT_COLLECTION", "znatok_chunks")

        collections = client.get_collections().collections
        collection_names = [c.name for c in collections]
        if collection not in collection_names:
            logger.info(f"Коллекция {collection} не найдена. Возвращаем пустой результат.")
            return []

        model = get_embedding_model()
        query_vector = model.encode(f"query: {question}").tolist()

        search_result = client.search(
            collection_name=collection,
            query_vector=query_vector,
            query_filter=build_metadata_filter(department),
            limit=4
        )

        return [
            {
                "text": hit.payload.get("text", ""),
                "source": hit.payload.get("source", "неизвестный источник"),
                "score": hit.score
            }
            for hit in search_result
        ]

    except Exception as e:
        logger.error(f"Ошибка поиска в Qdrant: {e}", exc_info=True)
        raise
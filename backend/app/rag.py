# backend/app/rag.py
import os
import base64
import httpx
from typing import List, Optional
from qdrant_client import QdrantClient
from qdrant_client.models import Filter, FieldCondition, MatchValue

async def get_gigachat_token() -> str:
    creds = os.getenv("GIGACHAT_CREDENTIALS")
    if not creds:
        raise ValueError("GIGACHAT_CREDENTIALS не задан")
    
    auth = base64.b64encode(creds.encode()).decode()
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            "https://ngw.devices.sberbank.ru:9443/api/v2/oauth",
            headers={
                "Authorization": f"Basic {auth}",
                "RqUID": "znatok-rag-001",
                "Content-Type": "application/x-www-form-urlencoded"
            },
            data={"scope": os.getenv("GIGACHAT_SCOPE", "GIGACHAT_API_PUB")},
            timeout=10.0
        )
        resp.raise_for_status()
        return resp.json()["access_token"]

async def call_gigachat(prompt: str, token: str) -> str:
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            "https://gigachat.devices.sberbank.ru/api/v1/chat/completions",
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
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

def build_metadata_filter(department: Optional[str] = None) -> Optional[Filter]:
    if not department or department == "all":
        return None
    return Filter(must=[FieldCondition(key="department", match=MatchValue(value=department))])

def search_qdrant(question: str, department: Optional[str] = None) -> List[dict]:
    client = QdrantClient(
        host=os.getenv("QDRANT_HOST", "qdrant"),
        port=int(os.getenv("QDRANT_PORT", 6333))
    )
    collection = os.getenv("QDRANT_COLLECTION", "znatok_chunks")
    
    model = SentenceTransformer('intfloat/multilingual-e5-large')
    query_vector = model.encode(f"query: {question}").tolist()
    
    search_result = client.search(
        collection_name=collection,
        query_vector=query_vector,
        query_filter=build_metadata_filter(department),
        limit=4
    )
    
    return [
        {
            "text": hit.payload["text"],
            "source": hit.payload["source"],
            "score": hit.score
        }
        for hit in search_result
    ]
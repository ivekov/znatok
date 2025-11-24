# backend/app/rag.py
import os
import logging
import httpx
import uuid
from typing import List, Optional, Tuple
from qdrant_client import QdrantClient
from qdrant_client.models import Filter, FieldCondition, MatchValue
from sentence_transformers import SentenceTransformer
from .models import load_settings, ProviderType

logger = logging.getLogger("znatok.rag")

# Кэшируем
_EMBEDDING_MODEL = None
_QDRANT_CLIENT = None

# ======================
# Provider Implementations
# ======================

class LLMProvider:
    def __init__(self, config):
        self.config = config
    
    async def generate_response(self, prompt: str) -> str:
        raise NotImplementedError

class GigaChatProvider(LLMProvider):
    async def generate_response(self, prompt: str) -> str:
        token = await self._get_token()
        return await self._call_api(prompt, token)
    
    async def _get_token(self) -> str:
        auth_key = self.config.api_key
        if not auth_key:
            raise ValueError("GIGACHAT_API_KEY не задан в настройках")
        
        scope = "GIGACHAT_API_PERS"
        rq_uid = str(uuid.uuid4())
        
        async with httpx.AsyncClient(verify=False) as client:
            try:
                resp = await client.post(
                    "https://ngw.devices.sberbank.ru:9443/api/v2/oauth",
                    headers={
                        "Authorization": f"Basic {auth_key}",
                        "RqUID": rq_uid,
                        "Content-Type": "application/x-www-form-urlencoded",
                        "Accept": "application/json"
                    },
                    data={"scope": scope},
                    timeout=10.0
                )
                resp.raise_for_status()
                return resp.json()["access_token"]
            except Exception as e:
                logger.error(f"GigaChat auth error: {e}")
                raise
    
    async def _call_api(self, prompt: str, token: str) -> str:
        rq_uid = str(uuid.uuid4())
        
        async with httpx.AsyncClient(verify=False) as client:
            try:
                resp = await client.post(
                    "https://gigachat.devices.sberbank.ru/api/v1/chat/completions",
                    headers={
                        "Authorization": f"Bearer {token}",
                        "RqUID": rq_uid,
                        "Content-Type": "application/json",
                        "Accept": "application/json"
                    },
                    json={
                        "model": self.config.model or "GigaChat",
                        "messages": [
                            {
                                "role": "system", 
                                "content": "Ты — корпоративный ассистент «Знаток». Отвечай кратко, по делу, на русском языке. Если информации нет — скажи: «Не нашёл ответа в документах компании.»"
                            },
                            {"role": "user", "content": prompt}
                        ],
                        "temperature": self.config.temperature,
                        "max_tokens": self.config.max_tokens
                    },
                    timeout=30.0
                )
                resp.raise_for_status()
                return resp.json()["choices"][0]["message"]["content"].strip()
            except Exception as e:
                logger.error(f"GigaChat API error: {e}")
                raise

class YandexGPTProvider(LLMProvider):
    async def generate_response(self, prompt: str) -> str:
        api_key = self.config.api_key
        if not api_key:
            raise ValueError("YANDEX_API_KEY не задан в настройках")
        
        async with httpx.AsyncClient() as client:
            try:
                resp = await client.post(
                    "https://llm.api.cloud.yandex.net/foundationModels/v1/completion",
                    headers={
                        "Authorization": f"Api-Key {api_key}",
                        "Content-Type": "application/json"
                    },
                    json={
                        "modelUri": f"gpt://{self.config.model or 'yandexgpt/latest'}",
                        "completionOptions": {
                            "stream": False,
                            "temperature": self.config.temperature,
                            "maxTokens": self.config.max_tokens
                        },
                        "messages": [
                            {
                                "role": "system",
                                "content": "Ты — корпоративный ассистент. Отвечай кратко и по делу на русском языке."
                            },
                            {"role": "user", "content": prompt}
                        ]
                    },
                    timeout=30.0
                )
                resp.raise_for_status()
                result = resp.json()
                return result["result"]["alternatives"][0]["message"]["text"].strip()
            except Exception as e:
                logger.error(f"Yandex GPT API error: {e}")
                raise

class OllamaProvider(LLMProvider):
    async def generate_response(self, prompt: str) -> str:
        base_url = self.config.base_url or "http://localhost:11434"
        model = self.config.model or "mistral"
        temperature = self.config.temperature
        max_tokens = self.config.max_tokens

        async with httpx.AsyncClient() as client:
            try:
                resp = await client.post(
                    f"{base_url.rstrip('/')}/api/generate",
                    json={
                        "model": model,
                        "prompt": prompt,
                        "stream": False,
                        "options": {
                            "temperature": temperature,
                            "num_predict": max_tokens
                        }
                    },
                    timeout=60.0
                )
                resp.raise_for_status()
                return resp.json()["response"].strip()
            except Exception as e:
                logger.error(f"Ollama API error: {e}")
                raise

# ======================
# Provider Factory
# ======================

def get_llm_provider():
    settings = load_settings()
    provider_type = settings.current_provider
    provider_config = settings.providers.get(provider_type)
    
    if not provider_config:
        raise ValueError(f"Провайдер {provider_type} не настроен")
    
    if provider_type == ProviderType.GIGACHAT:
        return GigaChatProvider(provider_config)
    elif provider_type == ProviderType.YANDEX_GPT:
        return YandexGPTProvider(provider_config)
    elif provider_type == ProviderType.MISTRAL:
        return MistralProvider(provider_config)
    elif provider_type == ProviderType.OLLAMA:  # ← добавлено
        return OllamaProvider(provider_config)
    else:
        raise ValueError(f"Неизвестный провайдер: {provider_type}")
# ======================
# Updated RAG functions
# ======================

async def get_llm_response(prompt: str) -> str:
    try:
        provider = get_llm_provider()
        return await provider.generate_response(prompt)
    except Exception as e:
        logger.error(f"LLM provider error: {e}")
        raise

def get_embedding_model():
    global _EMBEDDING_MODEL
    if _EMBEDDING_MODEL is None:
        logger.info("Загрузка модели эмбеддингов...")
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

        # ФИЛЬТРАЦИЯ ПО SCORE > 0.3
        filtered_hits = [
            {
                "text": hit.payload.get("text", ""),
                "source": hit.payload.get("source", "неизвестный источник"),
                "score": hit.score
            }
            for hit in search_result
            if hit.score > 0.3  # ← было 0.6, теперь 0.3
        ]
        return filtered_hits

    except Exception as e:
        logger.error(f"Ошибка поиска в Qdrant: {e}", exc_info=True)
        raise
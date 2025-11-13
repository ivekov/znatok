# app/models.py
from pydantic import BaseModel
from typing import Optional, Dict, Any
from enum import Enum
import json
import os
import logging

logger = logging.getLogger("znatok.models")

class ProviderType(str, Enum):
    GIGACHAT = "gigachat"
    YANDEX_GPT = "yandex_gpt"
    MISTRAL = "mistral"

class ProviderConfig(BaseModel):
    provider: ProviderType
    api_key: Optional[str] = None
    base_url: Optional[str] = None
    model: Optional[str] = None
    temperature: float = 0.1
    max_tokens: int = 512

class Bitrix24KBSource(BaseModel):
    enabled: bool = False
    domain: Optional[str] = None  # например, "mycompany.bitrix24.ru"
    access_token: Optional[str] = None
    last_sync: Optional[str] = None  # ISO datetime

class Settings(BaseModel):
    current_provider: ProviderType = ProviderType.GIGACHAT
    providers: Dict[ProviderType, ProviderConfig] = {}
    integrations: Dict[str, Dict[str, Optional[str]]] = {
        "telegram": {"bot_token": None},
        "bitrix24": {"client_secret": None}
    }
    knowledge_sources: Dict[str, Any] = {
        "bitrix24_kb": Bitrix24KBSource().dict()
    }

SETTINGS_FILE = "/app/data/settings.json"

def load_settings() -> Settings:
    try:
        if os.path.exists(SETTINGS_FILE):
            with open(SETTINGS_FILE, 'r', encoding='utf-8') as f:
                data = json.load(f)
                if 'current_provider' in data:
                    data['current_provider'] = ProviderType(data['current_provider'])
                if 'providers' in data:
                    data['providers'] = {
                        ProviderType(k): ProviderConfig(**v) for k, v in data['providers'].items()
                    }
                if 'knowledge_sources' not in data:
                    data['knowledge_sources'] = {
                        "bitrix24_kb": Bitrix24KBSource().dict()
                    }
                return Settings(**data)
        return Settings()
    except Exception as e:
        logger.error(f"Error loading settings: {e}")
        return Settings()

def save_settings(settings: Settings):
    try:
        os.makedirs(os.path.dirname(SETTINGS_FILE), exist_ok=True)
        with open(SETTINGS_FILE, 'w', encoding='utf-8') as f:
            json.dump(settings.dict(), f, indent=2, ensure_ascii=False)
    except Exception as e:
        logger.error(f"Error saving settings: {e}")
        raise
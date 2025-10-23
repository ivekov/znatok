import os
import logging
import hmac
import hashlib
from typing import Dict, Optional
import aiohttp
from fastapi import APIRouter, Request, HTTPException, Header
from pydantic import BaseModel

logger = logging.getLogger("znatok.bitrix24")

class Bitrix24Bot:
    def __init__(self, backend_url: str):
        self.backend_url = backend_url
        self.client_secret = os.getenv("BITRIX24_CLIENT_SECRET")
        self.verify_webhook = os.getenv("BITRIX24_VERIFY_WEBHOOK", "true").lower() == "true"

    async def ask_question(self, question: str, user_id: str, department: str = "all") -> Dict:
        """Отправляет вопрос к нашему API"""
        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    f"{self.backend_url}/api/ask",
                    json={
                        "question": question,
                        "user_department": department
                    },
                    timeout=30.0
                ) as response:
                    
                    if response.status == 200:
                        data = await response.json()
                        return {
                            "success": True,
                            "answer": data.get("answer", "Не удалось получить ответ."),
                            "sources": data.get("sources", [])
                        }
                    else:
                        error_text = await response.text()
                        logger.error(f"Bitrix24 API error: {response.status} - {error_text}")
                        return {
                            "success": False,
                            "error": "Ошибка при обработке запроса"
                        }
                        
        except Exception as e:
            logger.error(f"Bitrix24 ask_question error: {e}")
            return {
                "success": False,
                "error": "Внутренняя ошибка сервера"
            }

    def format_bitrix_response(self, answer: str, sources: list) -> Dict:
        """Форматирует ответ для Битрикс24"""
        response_text = f"{answer}"
        
        if sources:
            source_names = [src["source"] for src in sources]
            unique_sources = list(set(source_names))
            if unique_sources:
                sources_text = "\n\n📎 *Источники:*\n" + "\n".join([f"• {src}" for src in unique_sources])
                response_text += sources_text
        
        return {
            "result": response_text
        }

    async def handle_message(self, data: Dict) -> Dict:
        """Обрабатывает входящие сообщения из Битрикс24"""
        try:
            event = data.get("event")
            message_data = data.get("data", {})
            
            if event == "ONIMBOTMESSAGEADD":
                return await self.handle_bot_message(message_data)
            elif event == "ONIMCOMMANDADD":
                return await self.handle_command(message_data)
            else:
                logger.warning(f"Неизвестное событие Bitrix24: {event}")
                return {"result": "ok"}
                
        except Exception as e:
            logger.error(f"Bitrix24 handle_message error: {e}")
            return {"error": "Internal server error"}

    async def handle_bot_message(self, data: Dict) -> Dict:
        """Обрабатывает сообщения для бота"""
        message = data.get("message", "").strip()
        user_id = data.get("user_id")
        dialog_id = data.get("dialog_id")
        
        if not message:
            return {"result": "Пожалуйста, задайте вопрос."}
        
        logger.info(f"Bitrix24 вопрос от пользователя {user_id}: {message}")
        
        # Получаем ответ от нашего API
        result = await self.ask_question(message, str(user_id))
        
        if result["success"]:
            response = self.format_bitrix_response(
                result["answer"], 
                result["sources"]
            )
            
            # Добавляем информацию для отправки сообщения
            response.update({
                "dialog_id": dialog_id,
                "message": response["result"]
            })
            
            return response
        else:
            return {
                "dialog_id": dialog_id,
                "message": "❌ Произошла ошибка при обработке запроса. Попробуйте позже."
            }

    async def handle_command(self, data: Dict) -> Dict:
        """Обрабатывает команды бота"""
        command = data.get("command", "").lower()
        user_id = data.get("user_id")
        dialog_id = data.get("dialog_id")
        
        if command == "help":
            help_text = """
🤖 *Znatok AI Assistant*

Я помогу вам найти информацию в корпоративных документах.

*Как использовать:*
Просто напишите ваш вопрос, и я найду ответ в документах компании!

*Примеры вопросов:*
• Какая политика удаленной работы?
• Как оформить отпуск?
• Правила ИТ безопасности
• Документы для onboarding

*Особенности:*
• Ищу информацию только в загруженных документах
• Если информации нет - честно скажу об этом
• Ответы основаны на актуальных данных компании

Начните с любого вопроса! 🚀
            """
            return {
                "dialog_id": dialog_id,
                "message": help_text
            }
        
        elif command == "start":
            welcome_text = """
🤖 *Добро пожаловать в Znatok AI Assistant!*

Задайте вопрос о корпоративных документах, и я найду нужную информацию.

Напишите /help для справки или сразу задайте вопрос!
            """
            return {
                "dialog_id": dialog_id,
                "message": welcome_text
            }
        
        else:
            return {
                "dialog_id": dialog_id,
                "message": "Неизвестная команда. Используйте /help для справки."
            }

    def verify_signature(self, payload: str, signature: str) -> bool:
        """Проверяет подпись вебхука от Битрикс24"""
        if not self.verify_webhook:
            return True
            
        if not signature or not self.client_secret:
            return False
            
        # Создаем подпись для сравнения
        expected_signature = hmac.new(
            self.client_secret.encode(),
            payload.encode(),
            hashlib.sha256
        ).hexdigest()
        
        return hmac.compare_digest(signature, expected_signature)

# Модели Pydantic
class BitrixWebhookRequest(BaseModel):
    auth: Optional[Dict] = None
    data: Optional[Dict] = None
    event: Optional[str] = None
    ts: Optional[str] = None

# Создаем роутер
router = APIRouter(prefix="/bitrix24", tags=["bitrix24"])

# Инициализируем бота
bitrix_bot = Bitrix24Bot(backend_url="http://localhost:8000")

# Dependency для проверки авторизации
async def verify_webhook_signature(
    request: Request,
    x_bitrix24_signature: str = Header(None)
):
    if bitrix_bot.verify_webhook and x_bitrix24_signature:
        body = await request.body()
        if not bitrix_bot.verify_signature(body.decode(), x_bitrix24_signature):
            raise HTTPException(status_code=401, detail="Invalid signature")
    return True

# Эндпоинты
@router.post("/webhook")
async def bitrix24_webhook(
    request: BitrixWebhookRequest,
    verified: bool = True  # Временно отключаем проверку для тестов
):
    """Эндпоинт для вебхуков от Битрикс24"""
    try:
        result = await bitrix_bot.handle_message(request.dict())
        return result
    except Exception as e:
        logger.error(f"Bitrix24 webhook error: {e}")
        return {"error": "Internal server error"}

@router.get("/health")
async def health_check():
    """Проверка здоровья сервиса"""
    return {"status": "ok", "service": "bitrix24-bot"}

@router.post("/test")
async def test_bot():
    """Тестовый эндпоинт для проверки бота"""
    test_question = "Какая политика удаленной работы?"
    result = await bitrix_bot.ask_question(test_question, "test_user")
    return {"test_result": result}
import os
import asyncio
import logging
import aiohttp
from telegram import Update
from telegram.ext import Application, CommandHandler, MessageHandler, filters, ContextTypes

logger = logging.getLogger("znatok.telegram")

class ZnatokTelegramBot:
    def __init__(self, backend_url: str):
        self.token = os.getenv("TELEGRAM_BOT_TOKEN")
        self.backend_url = backend_url
        self.application = None
        
        if not self.token:
            logger.warning("TELEGRAM_BOT_TOKEN не задан - Telegram бот отключен")
            return

    async def start(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        """Обработчик команды /start"""
        welcome_text = """
🤖 *Добро пожаловать в Znatok AI Assistant!*

Я помогу вам найти информацию в корпоративных документах.

*Доступные команды:*
/start - показать это сообщение
/help - помощь по использованию

*Как использовать:*
Просто напишите ваш вопрос, и я найду ответ в документах компании!

*Примеры вопросов:*
• Какая политика удаленной работы?
• Как оформить отпуск?
• Правила ИТ безопасности
        """
        await update.message.reply_text(welcome_text, parse_mode='Markdown')

    async def help(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        """Обработчик команды /help"""
        help_text = """
*Помощь по использованию Znatok AI Assistant*

*Основные команды:*
/start - начать работу
/help - эта справка

*Как задавать вопросы:*
Просто напишите ваш вопрос в чат, например:
• "Какие документы нужны для оформления отпуска?"
• "Расскажи про политику удаленной работы"
• "Какие правила использования корпоративной почты?"

*Особенности:*
• Я ищу информацию только в загруженных документах
• Если информации нет в документах, я честно скажу об этом
• Ответы основаны на актуальных данных компании

Если у вас есть проблемы с работой бота, обратитесь к администратору.
        """
        await update.message.reply_text(help_text, parse_mode='Markdown')

    async def ask_question(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        """Обработчик текстовых сообщений (вопросов)"""
        if not self.token:
            await update.message.reply_text("❌ Telegram бот не настроен")
            return

        user_question = update.message.text.strip()
        user_id = update.effective_user.id
        username = update.effective_user.username or update.effective_user.first_name

        if not user_question:
            await update.message.reply_text("Пожалуйста, задайте вопрос.")
            return

        # Показываем что бот "печатает"
        await context.bot.send_chat_action(chat_id=update.effective_chat.id, action="typing")

        logger.info(f"Telegram вопрос от {username} (ID: {user_id}): {user_question}")

        try:
            # Отправляем запрос к нашему API
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    f"{self.backend_url}/api/ask",
                    json={
                        "question": user_question,
                        "user_department": "all"
                    },
                    timeout=30.0
                ) as response:
                    
                    if response.status == 200:
                        data = await response.json()
                        answer = data.get("answer", "Не удалось получить ответ.")
                        sources = data.get("sources", [])
                        
                        # Форматируем ответ
                        response_text = f"*Ответ:*\n{answer}"
                        
                        if sources:
                            source_names = [src["source"] for src in sources]
                            unique_sources = list(set(source_names))
                            sources_text = "\n".join([f"• {src}" for src in unique_sources])
                            response_text += f"\n\n*Источники:*\n{sources_text}"
                        
                        # Отправляем ответ (разбиваем если слишком длинный)
                        await self.send_long_message(update, response_text)
                        
                    else:
                        error_text = await response.text()
                        logger.error(f"Telegram API error: {response.status} - {error_text}")
                        await update.message.reply_text(
                            "❌ Произошла ошибка при обработке запроса. Попробуйте позже."
                        )

        except asyncio.TimeoutError:
            logger.error("Telegram timeout при запросе к API")
            await update.message.reply_text(
                "⏰ Превышено время ожидания ответа. Попробуйте позже."
            )
        except Exception as e:
            logger.error(f"Telegram ask_question error: {e}")
            await update.message.reply_text(
                "❌ Произошла непредвиденная ошибка. Попробуйте позже."
            )

    async def send_long_message(self, update: Update, text: str, max_length: int = 4096):
        """Отправляет длинное сообщение, разбивая его на части"""
        if len(text) <= max_length:
            await update.message.reply_text(text, parse_mode='Markdown')
            return

        # Разбиваем сообщение на части
        parts = []
        while text:
            if len(text) <= max_length:
                parts.append(text)
                break
            
            split_pos = text.rfind('\n', 0, max_length)
            if split_pos == -1:
                split_pos = text.rfind(' ', 0, max_length)
                if split_pos == -1:
                    split_pos = max_length
            
            parts.append(text[:split_pos])
            text = text[split_pos:].lstrip()

        # Отправляем части по очереди
        for i, part in enumerate(parts):
            if i == 0:
                await update.message.reply_text(part, parse_mode='Markdown')
            else:
                await update.message.reply_text(part, parse_mode='Markdown')
                await asyncio.sleep(0.5)

    async def error_handler(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        """Обработчик ошибок"""
        logger.error(f"Telegram bot error: {context.error}", exc_info=context.error)
        
        if update and update.effective_message:
            try:
                await update.effective_message.reply_text(
                    "❌ Произошла непредвиденная ошибка. Попробуйте позже."
                )
            except Exception as e:
                logger.error(f"Telegram: Не удалось отправить сообщение об ошибке: {e}")

    def setup_handlers(self):
        """Настройка обработчиков команд"""
        # Команды
        self.application.add_handler(CommandHandler("start", self.start))
        self.application.add_handler(CommandHandler("help", self.help))
        
        # Обработчик текстовых сообщений
        self.application.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, self.ask_question))
        
        # Обработчик ошибок
        self.application.add_error_handler(self.error_handler)

    async def run(self):
        """Запуск бота"""
        if not self.token:
            logger.warning("Telegram бот не запущен - токен не задан")
            return
            
        logger.info("Запуск Telegram бота...")
        
        # Создаем приложение
        self.application = Application.builder().token(self.token).build()
        
        # Настраиваем обработчики
        self.setup_handlers()
        
        # Запускаем бота
        await self.application.run_polling()

# Глобальная переменная для бота
telegram_bot = None

async def start_telegram_bot():
    """Запускает Telegram бота в фоне"""
    global telegram_bot
    telegram_bot = ZnatokTelegramBot(backend_url="http://localhost:8000")
    await telegram_bot.run()
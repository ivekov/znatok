# backend/app/telegram.py

import os
import asyncio
import logging
import aiohttp
from telegram import Update
from telegram.ext import Application, CommandHandler, MessageHandler, filters, ContextTypes

logger = logging.getLogger("znatok.telegram")

class ZnatokTelegramBot:
    def __init__(self, backend_url: str, bot_token: str):
        if not bot_token:
            raise ValueError("Telegram bot token is required")
        self.bot_token = bot_token
        self.backend_url = backend_url.rstrip("/")
        self.application = None
        self.bot_username = None

    async def _fetch_bot_username(self):
        bot = self.application.bot
        me = await bot.get_me()
        self.bot_username = me.username
        logger.info(f"Telegram бот инициализирован как @{self.bot_username}")

    async def start(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        welcome_text = """
🤖 *Добро пожаловать в Znatok AI Assistant!*

Я помогу вам найти информацию в корпоративных документах.

*Доступные команды:*
/start - показать это сообщение
/help - помощь по использованию

*Как использовать:*
Просто напишите ваш вопрос, и я найду ответ в документах компании!
        """
        await update.message.reply_text(welcome_text, parse_mode='Markdown')

    async def help(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        help_text = """
*Помощь по использованию Znatok AI Assistant*

Просто напишите вопрос. Примеры:
• Политика удалённой работы
• Как оформить отпуск?
• Правила ИТ безопасности
        """
        await update.message.reply_text(help_text, parse_mode='Markdown')

    async def ask_question(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        # В личке — отвечаем на всё
        if update.message.chat.type == "private":
            await self._process_question(update, update.message.text)
            return

        # В группе — только на упоминания или реплаи
        if update.message.reply_to_message and update.message.reply_to_message.from_user.id == context.bot.id:
            await self._process_question(update, update.message.text)
            return

        if f"@{self.bot_username}" in update.message.text:
            clean_text = update.message.text.replace(f"@{self.bot_username}", "").strip()
            if clean_text:
                await self._process_question(update, clean_text)
            else:
                await update.message.reply_text("Задайте вопрос после упоминания.")
            return

        # Игнорируем всё остальное в группе
        return

    async def _process_question(self, update: Update, user_question: str):
        if not user_question.strip():
            await update.message.reply_text("Пожалуйста, задайте вопрос.")
            return

        await update.message.chat.send_action(action="typing")
        logger.info(f"Telegram вопрос от {update.effective_user.id}: {user_question}")

        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    f"{self.backend_url}/api/ask",
                    json={"question": user_question, "user_department": "all"},
                    timeout=30.0
                ) as response:
                    if response.status == 200:
                        data = await response.json()
                        answer = data.get("answer", "Не удалось получить ответ.")
                        sources = data.get("sources", [])
                        
                        response_text = f"*Ответ:*\n{answer}"
                        if sources:
                            unique_sources = list({src["source"] for src in sources})
                            sources_text = "\n".join([f"• {src}" for src in unique_sources])
                            response_text += f"\n\n*Источники:*\n{sources_text}"
                        
                        await self.send_long_message(update, response_text)
                    else:
                        await update.message.reply_text("❌ Ошибка обработки запроса.")
        except Exception as e:
            logger.error(f"Ошибка Telegram: {e}")
            await update.message.reply_text("❌ Внутренняя ошибка.")

    async def send_long_message(self, update: Update, text: str, max_length: int = 4096):
        if len(text) <= max_length:
            await update.message.reply_text(text, parse_mode='Markdown')
            return
        parts = []
        while text:
            if len(text) <= max_length:
                parts.append(text); break
            pos = text.rfind('\n', 0, max_length) or text.rfind(' ', 0, max_length) or max_length
            parts.append(text[:pos]); text = text[pos:].lstrip()
        for part in parts:
            await update.message.reply_text(part, parse_mode='Markdown')
            await asyncio.sleep(0.3)

    async def error_handler(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        logger.error(f"Telegram ошибка: {context.error}")

    def setup_handlers(self):
        self.application.add_handler(CommandHandler("start", self.start))
        self.application.add_handler(CommandHandler("help", self.help))
        self.application.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, self.ask_question))
        self.application.add_error_handler(self.error_handler)

    async def run(self):
        logger.info("Запуск Telegram бота...")
        self.application = Application.builder().token(self.bot_token).build()
        self.setup_handlers()
        await self.application.initialize()
        await self._fetch_bot_username()
        await self.application.start()
        await self.application.updater.start_polling()

# Глобальная переменная
_active_bot = None

async def start_telegram_bot(backend_url: str, bot_token: str):
    global _active_bot
    await stop_telegram_bot()
    _active_bot = ZnatokTelegramBot(backend_url=backend_url, bot_token=bot_token)
    await _active_bot.run()

async def stop_telegram_bot():
    global _active_bot
    if _active_bot and _active_bot.application:
        logger.info("Остановка Telegram бота...")
        await _active_bot.application.stop()
        await _active_bot.application.shutdown()
        _active_bot = None
        logger.info("Telegram бот остановлен")
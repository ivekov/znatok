import os
import logging
logging.basicConfig(level=logging.INFO)
TOKEN = os.getenv('TELEGRAM_BOT_TOKEN')
if not TOKEN:
    raise ValueError('TELEGRAM_BOT_TOKEN is required')
print('Telegram bot stub started.')

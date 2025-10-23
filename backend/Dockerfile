# backend/Dockerfile
FROM python:3.11-slim

# Установка системных зависимостей + сертификатов
RUN apt-get update && apt-get install -y \
    ca-certificates \
    poppler-utils \
    libmagic1 \
    tesseract-ocr \
    libtesseract-dev \
    libgl1 \
    libglib2.0-0 \
    libxml2-dev \
    libxslt1-dev \
    && update-ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Копируем requirements и устанавливаем зависимости поэтапно для лучшего кэширования
COPY requirements.txt .

# Сначала устанавливаем torch CPU версию отдельно
RUN pip install --no-cache-dir torch==2.9.0 --index-url https://download.pytorch.org/whl/cpu

# Затем остальные зависимости (включая telegram и bitrix24)
RUN pip install --no-cache-dir -r requirements.txt

# Устанавливаем sentence-transformers БЕЗ зависимостей
RUN pip install --no-deps sentence-transformers==3.0.1

COPY app/ ./app/
RUN mkdir -p /app/uploads /app/data

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
# backend/Dockerfile
FROM python:3.11-slim

# Установка системных зависимостей для unstructured (PDF, DOCX)
RUN apt-get update && apt-get install -y \
    poppler-utils \
    libmagic1 \
    tesseract-ocr \
    libtesseract-dev \
    libgl1 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app/ ./app/
COPY uploads/ ./uploads/

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
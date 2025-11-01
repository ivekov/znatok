# backend/app/storage.py
from typing import List, Dict, Optional
import uuid
from datetime import datetime

# В MVP — in-memory. В продакшене — БД.
DOCUMENTS: List[Dict] = []

def add_document(filename: str, department: str, filepath: str) -> str:
    global DOCUMENTS
    # Удаляем старую версию
    DOCUMENTS = [d for d in DOCUMENTS if d["filename"] != filename]
    
    doc_id = str(uuid.uuid4())
    DOCUMENTS.append({
        "id": doc_id,
        "filename": filename,
        "department": department,
        "filepath": filepath,
        "uploaded_at": datetime.utcnow().isoformat()
    })
    return doc_id

def get_documents() -> List[Dict]:
    return [
        {k: v for k, v in doc.items() if k != "filepath"}  # не возвращаем путь наружу
        for doc in DOCUMENTS
    ]

def delete_document(doc_id: str) -> bool:
    global DOCUMENTS
    before = len(DOCUMENTS)
    DOCUMENTS = [d for d in DOCUMENTS if d["id"] != doc_id]
    return len(DOCUMENTS) < before

def get_document_by_id(doc_id: str) -> Optional[Dict]:
    for doc in DOCUMENTS:
        if doc["id"] == doc_id:
            return doc
    return None
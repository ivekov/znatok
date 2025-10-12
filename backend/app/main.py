from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import os
from dotenv import load_dotenv

load_dotenv()

app = FastAPI(title='Znatok API', version='0.1.0')

app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in os.getenv('ALLOWED_ORIGINS', '*').split(',')],
    allow_credentials=True,
    allow_methods=['*'],
    allow_headers=['*'],
)

@app.get('/api/health')
async def health():
    return {'status': 'ok', 'service': 'znatok-backend'}

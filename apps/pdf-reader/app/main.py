from fastapi import FastAPI

from app.routers import extract, health, sitfis

app = FastAPI(title="pdf-reader", version="1.0.0")

app.include_router(health.router)
app.include_router(extract.router)
# ⚠ SITFIS não é guia: é relatório de tabelas, lido pela POSIÇÃO das palavras no PDF. Router
# próprio (`/sitfis/posicional`) — ver `app/routers/sitfis.py` e a seção "SITFIS — leitura
# POSICIONAL" no CLAUDE.md deste app.
app.include_router(sitfis.router)

from fastapi import FastAPI

from app.routers import extract, health

app = FastAPI(title="pdf-reader", version="1.0.0")

app.include_router(health.router)
app.include_router(extract.router)

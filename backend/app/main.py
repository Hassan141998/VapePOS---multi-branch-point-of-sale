"""FastAPI application entry point."""
from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.config import DEFAULT_SECRET, settings
from app.database import get_db
from app.routers import auth, branches, inventory, products, reports, sales, transfers, users, ws

if settings.environment == "production" and settings.secret_key == DEFAULT_SECRET:
    raise RuntimeError("SECRET_KEY must be changed before running in production.")

app = FastAPI(
    title="VapePOS Multi-Branch API",
    version="1.0.0",
    description="Multi-location point of sale: branches, per-branch inventory, transfers, sales and reports.",
    docs_url="/api/v1/docs",
    redoc_url="/api/v1/redoc",
    openapi_url="/api/v1/openapi.json",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

API = "/api/v1"
for module in (auth, branches, users, products, inventory, transfers, sales, reports):
    app.include_router(module.router, prefix=API)
app.include_router(ws.router, prefix=API)


@app.get(f"{API}/health", tags=["System"])
def health(db: Session = Depends(get_db)):
    db.execute(text("SELECT 1"))
    return {"status": "ok"}

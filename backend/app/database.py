"""SQLAlchemy engine, session factory and declarative base."""
from collections.abc import Iterator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import settings

engine = create_engine(
    settings.database_url,
    pool_pre_ping=True,          # drop dead connections (Neon suspends idle databases)
    pool_recycle=300,            # renew connections every 5 minutes
    connect_args={"prepare_threshold": None},   # no server-side prepared statements: safe behind PgBouncer poolers
)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


def get_db() -> Iterator[Session]:
    """FastAPI dependency: one DB session per request, always closed afterwards."""
    with SessionLocal() as session:
        yield session

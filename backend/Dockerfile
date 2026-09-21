FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY . .

# Run as an unprivileged user
RUN useradd --create-home appuser && chown -R appuser /app
USER appuser

EXPOSE 8000

# 1) apply DB migrations  2) start the API (one worker: see docs/ARCHITECTURE.md, "Real-time")
CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 8000"]

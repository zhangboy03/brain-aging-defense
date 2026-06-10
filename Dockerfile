# Backend-only image for the cross-device sync relay, deployed to AI Builder
# Space (Koyeb). The frontend is built separately and served by GitHub Pages;
# this Dockerfile intentionally builds only the FastAPI relay under server/.
FROM python:3.11-slim

WORKDIR /app

# Install deps first for layer caching.
COPY server/requirements.txt ./server/requirements.txt
RUN pip install --no-cache-dir -r server/requirements.txt

# App code.
COPY server/ ./server/

EXPOSE 8000

# Shell form so ${PORT} (set by Koyeb at runtime) expands; default 8000 locally.
CMD sh -c "uvicorn server.app:app --host 0.0.0.0 --port ${PORT:-8000}"

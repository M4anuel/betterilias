# syntax=docker/dockerfile:1
FROM python:3.14-slim-bookworm@sha256:3fe1a0b6c2d6b2ebb572906cdabeca75aeb558c0c17db5ffefbcf8094871c32b
ARG VCS_REF=unknown
LABEL org.opencontainers.image.source="https://github.com/M4anuel/betterilias" \
      org.opencontainers.image.revision=$VCS_REF
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PYTHONPATH=/app \
    APP_ENV=production CAPTURE_FAILED_HTML=false TMPDIR=/data/.tmp
WORKDIR /app
COPY requirements-runtime.txt ./
RUN python -m pip install --no-cache-dir --only-binary=:all: --require-hashes -r requirements-runtime.txt \
    && groupadd --gid 10001 betterilias \
    && useradd --uid 10001 --gid 10001 --no-create-home --shell /usr/sbin/nologin betterilias \
    && mkdir -p /data/.tmp \
    && chown -R 10001:10001 /data \
    && chmod 700 /data /data/.tmp
COPY backend ./backend
COPY locales ./locales
COPY deploy/runtime.py ./deploy/runtime.py
WORKDIR /data
USER 10001:10001
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=3)"]
ENTRYPOINT ["python", "/app/deploy/runtime.py"]
CMD ["api"]

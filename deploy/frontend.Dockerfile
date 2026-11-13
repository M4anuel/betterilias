# syntax=docker/dockerfile:1
FROM --platform=$BUILDPLATFORM node:26-bookworm-slim@sha256:add5c17c14752c54d2f3d519ec46a3815684d41c33f198bcb09fb998f7dcbf68 AS build
WORKDIR /build
COPY frontend/package.json frontend/package-lock.json ./frontend/
RUN npm ci --prefix frontend --no-audit --no-fund
COPY frontend ./frontend
COPY backend ./backend
COPY locales ./locales
COPY extensions ./extensions
COPY scripts/sync-extension-locales.mjs scripts/check-locales.mjs ./scripts/
RUN npm --prefix frontend run build

FROM caddy:2.11-alpine@sha256:78bd35025c7ba85961dd149ae670315129954e77abe2383ac47c89106b35ade9
ARG VCS_REF=unknown
LABEL org.opencontainers.image.source="https://github.com/M4anuel/betterilias" \
      org.opencontainers.image.revision=$VCS_REF
ENV XDG_DATA_HOME=/tmp/caddy/data XDG_CONFIG_HOME=/tmp/caddy/config
COPY --from=build /build/frontend/dist /srv
COPY deploy/frontend.Caddyfile /etc/caddy/Caddyfile
WORKDIR /srv
USER 10001:10001
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/
ENTRYPOINT ["caddy"]
CMD ["run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]

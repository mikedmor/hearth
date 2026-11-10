# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Build: the page (Vite) and the server (tsup, bundled with its dependencies)
# ---------------------------------------------------------------------------
FROM node:24-trixie-slim AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json vite.config.ts tsup.config.ts ./
COPY config ./config
COPY src ./src
RUN npm run build

# ---------------------------------------------------------------------------
# Runtime: no node_modules needed, everything is in dist/
# ---------------------------------------------------------------------------
FROM node:24-trixie-slim AS runtime

ARG HEARTH_VERSION=dev
LABEL org.opencontainers.image.title="Hearth" \
      org.opencontainers.image.description="The home network's start page" \
      org.opencontainers.image.version="${HEARTH_VERSION}"

ENV NODE_ENV=production \
    HEARTH_HOST=0.0.0.0 \
    HEARTH_PORT=8082 \
    HEARTH_DATA_DIR=/data \
    HEARTH_WEB_DIR=/app/web \
    HEARTH_VERSION=${HEARTH_VERSION}

WORKDIR /app
COPY --from=build /src/dist/server ./
COPY --from=build /src/dist/web ./web

# Runs as the unprivileged "node" user (uid 1000). On Synology, set `user:` in compose.yaml
# to the owner of the data folder.
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 8082

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.HEARTH_PORT||8082)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

CMD ["node", "--enable-source-maps", "index.js"]

# ---------- Build Stage ----------
FROM node:22-alpine AS build
ARG VERSION=dev
WORKDIR /app

# Install only production dependencies first (leveraging cache)
COPY package.json ./
# Using npm install instead of npm ci because lock file appears out-of-sync
RUN npm install --omit=dev

# Copy only required source
COPY apiServer.js ./
COPY providers ./providers
COPY scrapers ./scrapers
COPY proxy ./proxy
COPY public ./public
COPY utils ./utils
COPY README.md ./

# ---------- Runtime Stage ----------
FROM node:22-alpine AS runtime
ARG VERSION=dev
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    BIND_HOST=0.0.0.0 \
    APP_VERSION=${VERSION}

# Create non-root user
RUN addgroup -S app && adduser -S app -G app

# Copy node_modules from build and necessary source
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apiServer.js ./
COPY --from=build /app/public ./public
COPY --from=build /app/providers ./providers
COPY --from=build /app/scrapers ./scrapers
COPY --from=build /app/proxy ./proxy
COPY --from=build /app/utils ./utils
COPY --from=build /app/package.json ./
COPY --from=build /app/README.md ./

# Expose port (documentational; runtime can override)
EXPOSE 3000

# Ensure runtime user owns app directory for writes (overrides, restart marker)
RUN mkdir -p /app/utils && \
    [ -f /app/utils/user-config.json ] || echo "{}" > /app/utils/user-config.json && \
    chown -R app:app /app && chmod -R 775 /app/utils
USER app

# Labels / metadata
LABEL org.opencontainers.image.title="TMDB Embed API" \
    org.opencontainers.image.description="Streaming metadata + source aggregation API with multi-key TMDB rotation" \
    org.opencontainers.image.version="${VERSION}" \
    org.opencontainers.image.source="https://github.com/Inside4ndroid/TMDB-Embed-API" \
    org.opencontainers.image.licenses="MIT"

# Healthcheck using Node fetch directly against 127.0.0.1 (avoids IPv6 localhost resolution issues in Alpine)
HEALTHCHECK --interval=20s --timeout=5s --start-period=15s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node","apiServer.js"]

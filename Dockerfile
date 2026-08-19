# ─────────────────────────────────────────────────────────────────────────────
# Stage 1 — builder
# Install ALL dependencies (including devDependencies) and compile TypeScript.
# ─────────────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Copy manifests first so Docker can cache the npm install layer.
COPY package.json package-lock.json ./

# Install everything (dev deps needed for the TypeScript compiler).
RUN npm ci

# Copy source and compile.
COPY tsconfig.json ./
COPY src/ ./src/

RUN npm run build

# ─────────────────────────────────────────────────────────────────────────────
# Stage 2 — runner
# Lean production image: only compiled JS + production node_modules.
# ─────────────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS runner

# Create a non-root user for the process.
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

# Copy manifests and install production dependencies only.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy compiled output from the builder stage.
COPY --from=builder /app/dist ./dist

# The chunk storage directory — will be a Docker volume mount.
RUN mkdir -p /data/chunks && chown appuser:appgroup /data/chunks

# Switch to non-root user.
USER appuser

# Environment defaults (overridable at runtime).
ENV NODE_ENV=production \
    PORT=3001 \
    STORAGE_PATH=/data/chunks \
    LOG_LEVEL=info

EXPOSE 3001

# Healthcheck — calls GET /health every 30 s, 3 retries, 10 s timeout.
# wget is available in node:alpine.
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3001/health || exit 1

CMD ["node", "dist/main.js"]

# Stage 1: Install dependencies
FROM node:20-alpine AS deps
RUN apk add --no-cache libc6-compat python3 make g++
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# Stage 2: Build the application
FROM node:20-alpine AS builder
RUN apk add --no-cache libc6-compat python3 make g++
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Ensure the data directory exists for SQLite
RUN mkdir -p data

# Build Next.js (standalone output)
RUN npm run build

# Stage 3: Production runner
FROM node:20-alpine AS runner
RUN apk add --no-cache libc6-compat
WORKDIR /app

ENV NODE_ENV=production
ENV HOSTNAME="0.0.0.0"

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Copy standalone build
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# Copy config and data directory
COPY --from=builder /app/gtm-config.yaml ./gtm-config.yaml

# Create writable data directory for SQLite
RUN mkdir -p data && chown nextjs:nodejs data

# Copy better-sqlite3 native bindings (needed at runtime)
COPY --from=builder /app/node_modules/better-sqlite3 ./node_modules/better-sqlite3
COPY --from=builder /app/node_modules/bindings ./node_modules/bindings
COPY --from=builder /app/node_modules/file-uri-to-path ./node_modules/file-uri-to-path
COPY --from=builder /app/node_modules/prebuild-install ./node_modules/prebuild-install
COPY --from=builder /app/node_modules/node-gyp-build ./node_modules/node-gyp-build

# Copy drizzle-orm for runtime schema usage
COPY --from=builder /app/node_modules/drizzle-orm ./node_modules/drizzle-orm

# Copy yaml for config parsing
COPY --from=builder /app/node_modules/yaml ./node_modules/yaml

# Copy migration and collector scripts for runtime use
COPY --from=builder /app/src ./src
COPY --from=builder /app/node_modules/tsx ./node_modules/tsx
COPY --from=builder /app/node_modules/esbuild ./node_modules/esbuild
COPY --from=builder /app/tsconfig.json ./tsconfig.json

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV DATABASE_PATH=/app/data/gtm-tracker.db

CMD ["node", "server.js"]

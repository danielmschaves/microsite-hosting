# syntax=docker/dockerfile:1

# --- deps: install node_modules ------------------------------------------------
FROM node:20-alpine AS deps
WORKDIR /app
# argon2 (CD-15) ships prebuilt musl binaries for common targets, but when
# none matches it falls back to compiling from source — this toolchain makes
# that fallback succeed instead of failing the whole build on Alpine.
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json* ./
RUN npm install

# --- builder: compile the Next.js standalone output ---------------------------
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# --- runner: minimal runtime image -------------------------------------------
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]

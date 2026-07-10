# Multi-stage build: the runtime image contains only Node + dist, no dev deps.
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsup.config.ts ./
COPY src ./src
RUN npm run build

FROM node:24-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY package.json ./

# Session data lives here — mount a volume so it survives container recreation.
VOLUME /data
ENV MEMORY_DB=/data/agent-memory.db
EXPOSE 8790

# API_KEYS must be provided at runtime; the server refuses to boot without it.
CMD ["node", "dist/server-main.js"]

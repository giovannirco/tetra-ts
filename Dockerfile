# syntax=docker/dockerfile:1
# Compile with the dev toolchain, then ship dist/ with production deps only.
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-fund --no-audit
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-fund --no-audit

FROM node:24-alpine
LABEL org.opencontainers.image.source="https://github.com/giovannirco/tetra-ts" \
      org.opencontainers.image.description="Tetra arithmetic API (TypeScript)" \
      org.opencontainers.image.licenses="MIT"
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY web ./web
ARG VERSION=
ARG COMMIT=unknown
ARG BUILD_DATE=
ENV VERSION=${VERSION} COMMIT=${COMMIT} BUILD_DATE=${BUILD_DATE}
USER node
EXPOSE 8000
HEALTHCHECK --interval=10s --timeout=3s --start-period=3s --retries=3 CMD ["node", "dist/healthcheck.js"]
CMD ["node", "dist/server.js"]

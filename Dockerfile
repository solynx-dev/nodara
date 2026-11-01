# syntax=docker/dockerfile:1.7
# Nodara — single image containing the API server and the built web app.

ARG NODE_VERSION=22

# ---- build -----------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS build
WORKDIR /src
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

COPY . .
RUN pnpm --filter @nodara/web build && pnpm --filter @nodara/server build
# Standalone server folder with production dependencies only.
RUN pnpm --filter @nodara/server deploy --prod --legacy /out \
  && rm -rf /out/src /out/test /out/*.config.ts /out/tsconfig.json \
  && cp -r apps/server/dist /out/dist \
  && cp -r apps/web/dist /out/web \
  && cp PRIVACY.md /out/PRIVACY.md

# ---- runtime ---------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim
ARG NODARA_VERSION=0.1.0
LABEL org.opencontainers.image.title="Nodara" \
      org.opencontainers.image.description="Self-hosted location sharing, family safety & personal mobility platform" \
      org.opencontainers.image.url="https://nodara.ca" \
      org.opencontainers.image.licenses="AGPL-3.0-only" \
      org.opencontainers.image.version="${NODARA_VERSION}"

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080 \
    WEB_DIST=/app/web \
    NODARA_VERSION=${NODARA_VERSION}

WORKDIR /app
COPY --from=build --chown=node:node /out /app
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Migrations run automatically at startup.
CMD ["node", "dist/index.js"]

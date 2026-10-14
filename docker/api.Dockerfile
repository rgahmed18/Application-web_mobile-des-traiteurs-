# syntax=docker/dockerfile:1.7
# Image de l'API, du worker et des commandes d'administration (même code, commande différente) :
#   API        : node dist/main.js
#   worker     : node dist/worker.js
#   migrations : node node_modules/prisma/build/index.js migrate deploy && node dist/cli/sync-permissions.js
#   traiteur   : node dist/cli/create-traiteur.js …
# Contexte de build : la racine du dépôt.
ARG NODE_VERSION=24

FROM node:${NODE_VERSION}-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN corepack enable
WORKDIR /repo

# ── Build : dépendances complètes, compilation, puis copie de production (pnpm deploy) ──
FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
COPY packages/config/package.json packages/config/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @traiteur/api...
COPY packages/config packages/config
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @traiteur/shared build \
 && pnpm --filter @traiteur/api db:generate \
 && pnpm --filter @traiteur/api build \
 && pnpm --filter @traiteur/api build:seed
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm --filter @traiteur/api deploy --prod --legacy /out

# ── Exécution : dépendances de production et code compilé uniquement ──
FROM node:${NODE_VERSION}-bookworm-slim AS runtime
# openssl : détection de la plateforme par Prisma (migrations)
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out/package.json ./package.json
COPY --from=build --chown=node:node /out/node_modules ./node_modules
COPY --from=build --chown=node:node /repo/apps/api/dist ./dist
COPY --from=build --chown=node:node /repo/apps/api/dist-seed ./dist-seed
COPY --from=build --chown=node:node /repo/apps/api/assets ./assets
COPY --from=build --chown=node:node /repo/apps/api/prisma/schema.prisma ./prisma/schema.prisma
COPY --from=build --chown=node:node /repo/apps/api/prisma/migrations ./prisma/migrations
COPY --from=build --chown=node:node /repo/apps/api/prisma.config.ts ./prisma.config.ts
# Fichiers de déploiement de cette version (extraits sur le serveur par ci-deploy.sh)
COPY --chown=node:node deploy ./deploy
# Version de l'image (étiquette Git), transmise à Sentry
ARG RELEASE=dev
ENV SENTRY_RELEASE=${RELEASE}
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/v1/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]

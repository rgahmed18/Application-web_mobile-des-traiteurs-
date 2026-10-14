# syntax=docker/dockerfile:1.7
# Image du back-office (Next.js, serveur autonome « standalone »). Les adresses publiques
# (PUBLIC_API_URL, PUBLIC_MEDIA_URL…) sont lues au démarrage : la même image sert le staging et
# la production. Contexte de build : la racine du dépôt.
ARG NODE_VERSION=24

FROM node:${NODE_VERSION}-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/config/package.json packages/config/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @traiteur/web...
COPY packages/config packages/config
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN pnpm --filter @traiteur/shared build \
 && NEXT_OUTPUT=standalone pnpm --filter @traiteur/web build

FROM node:${NODE_VERSION}-bookworm-slim AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3001 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
ARG RELEASE=dev
ENV SENTRY_RELEASE=${RELEASE}
USER node
EXPOSE 3001
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3001/admin/login').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/web/server.js"]

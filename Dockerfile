FROM node:24-alpine AS build

WORKDIR /app
RUN corepack enable
COPY . .
RUN corepack pnpm install --frozen-lockfile
RUN corepack pnpm --filter @nexus/shared build \
  && corepack pnpm --filter @nexus/api prisma:generate \
  && corepack pnpm --filter @nexus/api build \
  && corepack pnpm --filter @nexus/bot build \
  && corepack pnpm --filter @nexus/web build

FROM node:24-alpine AS api

ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=build --chown=node:node /app/apps/api/package.json ./apps/api/package.json
COPY --from=build --chown=node:node /app/apps/api/dist ./apps/api/dist
COPY --from=build --chown=node:node /app/apps/api/prisma ./apps/api/prisma
COPY --from=build --chown=node:node /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=build --chown=node:node /app/packages/shared/dist ./packages/shared/dist
USER node
CMD ["node", "apps/api/dist/server.js"]

FROM node:24-alpine AS bot

ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/apps/bot/node_modules ./apps/bot/node_modules
COPY --from=build --chown=node:node /app/apps/bot/package.json ./apps/bot/package.json
COPY --from=build --chown=node:node /app/apps/bot/dist ./apps/bot/dist
COPY --from=build --chown=node:node /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=build --chown=node:node /app/packages/shared/dist ./packages/shared/dist
USER node
CMD ["node", "apps/bot/dist/index.js"]

FROM nginx:alpine AS web

COPY --from=build /app/apps/web/dist /usr/share/nginx/html

# ── Stage 0: Base (shared dep install) ─────────────────────────
FROM node:22-alpine AS base

RUN corepack enable && corepack prepare pnpm@10.12.1 --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml nx.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/tsconfig*.json apps/api/webpack*.js apps/api/
COPY apps/web/tsconfig*.json apps/web/project.json apps/web/
COPY libs/shared-types/package.json libs/shared-types/

RUN pnpm install --frozen-lockfile

# ── Stage 1: Dev (docker compose target for hot-reload) ────────
FROM base AS dev

COPY . .

EXPOSE 3000 4200

# ── Stage 2: Build ─────────────────────────────────────────────
FROM base AS build

COPY libs/shared-types/ libs/shared-types/
COPY apps/api/ apps/api/

RUN npx nx build api --configuration=production

# ── Stage 3: Production (used by Render) ───────────────────────
FROM node:22-alpine AS production

RUN corepack enable && corepack prepare pnpm@10.12.1 --activate

WORKDIR /app

ENV NODE_ENV=production

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY libs/shared-types/package.json libs/shared-types/

RUN pnpm install --frozen-lockfile --prod --ignore-scripts

COPY --from=build /app/apps/api/dist apps/api/dist

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/health || exit 1

CMD ["node", "apps/api/dist/main.js"]

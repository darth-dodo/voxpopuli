# ── Stage 1: Build ─────────────────────────────────────────────
FROM node:22-alpine AS build

RUN corepack enable && corepack prepare pnpm@10.12.1 --activate

WORKDIR /app

# Copy workspace config first (layer cache for deps)
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml nx.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/tsconfig*.json apps/api/webpack*.js apps/api/
COPY libs/shared-types/package.json libs/shared-types/

# Install all deps (including devDeps for build)
RUN pnpm install --frozen-lockfile

# Copy source
COPY libs/shared-types/ libs/shared-types/
COPY apps/api/ apps/api/

# Build
RUN npx nx build api --configuration=production

# ── Stage 2: Production ───────────────────────────────────────
FROM node:22-alpine AS production

RUN corepack enable && corepack prepare pnpm@10.12.1 --activate

WORKDIR /app

ENV NODE_ENV=production

# Copy workspace config for pruned install
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY libs/shared-types/package.json libs/shared-types/

# Production deps only (--ignore-scripts skips husky prepare hook)
RUN pnpm install --frozen-lockfile --prod --ignore-scripts

# Copy built output
COPY --from=build /app/dist/apps/api dist/apps/api

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/health || exit 1

CMD ["node", "dist/apps/api/main.js"]

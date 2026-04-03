.PHONY: dev dev-api dev-web build build-api build-web test test-api test-web lint lint-fix format format-check clean install eval

# ── Development ──────────────────────────────────────────────

dev:
	npx nx run-many -t serve

dev-api:
	npx nx serve api

dev-web:
	npx nx serve web

# ── Build ────────────────────────────────────────────────────

build:
	npx nx run-many -t build

build-api:
	npx nx build api

build-web:
	npx nx build web

# ── Test ─────────────────────────────────────────────────────

test:
	npx nx run-many -t test

test-api:
	npx nx test api

test-web:
	npx nx test web

# ── Lint & Format ────────────────────────────────────────────

lint:
	npx nx run-many -t lint

lint-fix:
	npx nx run-many -t lint -- --fix

format:
	pnpm exec prettier --write "**/*.{ts,tsx,json,md,yml,yaml,css,html}"

format-check:
	pnpm exec prettier --check "**/*.{ts,tsx,json,md,yml,yaml,css,html}"

# ── Cleanup & Install ────────────────────────────────────────

clean:
	rm -rf dist node_modules/.cache .nx/cache

install:
	pnpm install

# ── Try It (temporary M1 test endpoints) ────────────────────

search: ## Search HN stories. Usage: make search q="rust vs go"
	curl -s "http://localhost:3000/api/hn/search?q=$(q)&limit=5" | jq .

item: ## Get a story by ID. Usage: make item id=38543832
	curl -s "http://localhost:3000/api/hn/item/$(id)" | jq .

comments: ## Get comments for a story. Usage: make comments id=38543832
	curl -s "http://localhost:3000/api/hn/comments/$(id)" | jq .

health: ## Health check
	curl -s http://localhost:3000/api/health | jq .

# ── Eval (placeholder for M6) ────────────────────────────────

eval:
	@echo "Eval target placeholder - will be implemented in M6"

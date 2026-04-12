.PHONY: help install dev dev-api dev-web build test lint lint-fix format \
       docker-up docker-down docker-build docker-logs \
       eval eval-compare health query clean clean-all

help: ## Show available targets
	@grep -E '^[a-zA-Z_-]+:.*?##' $(MAKEFILE_LIST) | sort | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'

# ── Local Dev ────────────────────────────────────────────────
install: ## Install dependencies (pnpm)
	pnpm install

dev: ## Start API + Web dev servers
	npx nx run-many -t serve

dev-api: ## Start API only (:3000)
	npx nx serve api

dev-web: ## Start Web only (:4200)
	npx nx serve web

# ── Build & Quality ──────────────────────────────────────────
build: ## Build all projects
	npx nx run-many -t build

test: ## Run all tests
	npx nx run-many -t test

lint: ## Lint all projects
	npx nx run-many -t lint

lint-fix: ## Lint with auto-fix
	npx nx run-many -t lint -- --fix

format: ## Format with Prettier
	pnpm exec prettier --write "**/*.{ts,tsx,json,md,yml,yaml,css,html}"

# ── Docker (local full-stack) ────────────────────────────────
docker-up: ## Start API + Web in Docker with hot-reload
	docker compose up --build

docker-down: ## Stop Docker containers
	docker compose down

docker-build: ## Build Docker dev images (no start)
	docker compose build

docker-logs: ## Tail Docker logs
	docker compose logs -f

docker-clean: ## Stop containers and remove volumes
	docker compose down -v

# ── Eval ─────────────────────────────────────────────────────
eval: ## Run eval harness (requires running API)
	npx tsx evals/run-eval.ts

eval-compare: ## Compare groq, mistral, claude
	npx tsx evals/run-eval.ts -c groq,mistral,claude

# ── Shortcuts ────────────────────────────────────────────────
health: ## Health-check the running API
	@curl -sf http://localhost:3000/api/health | python3 -m json.tool || echo "API not running"

query: ## Ask VoxPopuli. Usage: make query q="What does HN think about AI?"
	@curl -sf -X POST http://localhost:3000/api/rag/query \
		-H 'Content-Type: application/json' \
		-d '{"query":"$(q)"}' | python3 -m json.tool

# ── Cleanup ──────────────────────────────────────────────────
clean: ## Remove build caches
	rm -rf dist node_modules/.cache .nx/cache .angular

clean-all: clean ## Remove everything including node_modules
	rm -rf node_modules

# ADR-001: CI/CD Pipeline and Quality Gates

**Date:** 2026-04-03
**Status:** Accepted
**Linear:** AI-139 (GitHub Actions CI), AI-140 (Pre-commit hooks)

---

## Context

VoxPopuli is an Nx monorepo with a NestJS backend and Angular frontend. As a solo-developer project with ambitions to be demo-ready at each milestone, we need quality gates that:

1. Catch issues early without slowing down the development loop
2. Mirror each other locally and in CI (no "works on my machine" surprises)
3. Scale with the monorepo -- only check what changed, not the entire workspace
4. Prevent broken code from reaching `main`

The Ledger project (predecessor) had a single-job CI pipeline and pre-commit hooks but no pre-push checks. This led to situations where type errors and test failures reached the remote because pre-commit only lints staged files.

## Decision

We implement a **three-layer quality gate** strategy: fast local checks on commit, thorough local checks on push, and authoritative CI checks on PR/merge.

### Layer 1: Pre-commit (Husky + lint-staged)

**File:** `.husky/pre-commit`
**Runs:** On every `git commit`
**Checks:** ESLint + Prettier on staged files only
**Speed:** <1 second

```
git commit → lint-staged → ESLint --fix + Prettier --write on staged *.ts files
```

This catches formatting and lint issues instantly. It only touches staged files, so it never slows you down even in a large monorepo. The `--fix` flag auto-corrects what it can.

### Layer 2: Pre-push (Husky)

**File:** `.husky/pre-push`
**Runs:** On every `git push`
**Checks:** lint, typecheck, test, format-check on affected projects
**Speed:** ~15 seconds (Nx-cached), ~60 seconds (cold)

```
git push → nx affected:lint
         → nx affected --target=typecheck
         → nx affected:test
         → prettier --check
```

This is the "did I break anything cross-file?" check. It catches:

- Type errors that lint misses (wrong argument types, missing imports)
- Test failures from changes in shared code
- Formatting drift in non-staged files

The `affected` commands use `--base=main` to only check projects touched since the branch diverged. Falls back to `run-many` if `main` isn't available locally.

### Layer 3: CI (GitHub Actions)

**File:** `.github/workflows/ci.yml`
**Runs:** On PRs (any target) and pushes to `main`
**Checks:** Same as pre-push, plus build, in a clean environment

```
setup ──┬── lint ────────┐
        ├── typecheck ───┤
        ├── test ────────┼── build
        └── format ──────┘
```

**Key design choices:**

| Choice                                           | Rationale                                                                                                                                                   |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `push` only on `main`, `pull_request` unfiltered | Avoids double runs when a feature branch has an open PR. `push` on `main` catches direct merges. `pull_request` covers all PRs regardless of target branch. |
| `concurrency` with `cancel-in-progress`          | Kills stale CI runs when you push again to the same branch. Saves GitHub Actions minutes.                                                                   |
| `nrwl/nx-set-shas@v4`                            | Correctly determines the base SHA for `affected` commands on both PRs and pushes. Replaces error-prone hardcoded `--base=origin/main`.                      |
| `build` depends on all 4 gates                   | Build is the most expensive step. Don't run it if lint, typecheck, test, or format already failed.                                                          |
| Parallel lint/typecheck/test/format              | Surfaces failures ~3x faster than sequential execution. Each job is independent.                                                                            |
| `pnpm` cache via `setup-node`                    | `actions/setup-node` caches the pnpm store, so `pnpm install --frozen-lockfile` only downloads what's missing.                                              |
| `packageManager` field in `package.json`         | `pnpm/action-setup@v4` reads the version from here. Also enables corepack locally. Single source of truth for pnpm version.                                 |

## Consequences

### Benefits

- **Fast feedback loop:** Pre-commit is instant, pre-push is ~15s cached. Developers (even solo) get feedback before code leaves the machine.
- **No drift between local and CI:** Pre-push runs the same 4 checks as CI. If pre-push passes, CI almost certainly passes.
- **Nx-aware:** Only affected projects are checked. As the monorepo grows, CI time stays proportional to change size, not repo size.
- **Escapable when needed:** `git push --no-verify` bypasses hooks for emergency pushes. CI still catches it.

### Trade-offs

- **Pre-push adds ~15s to pushes:** Acceptable since pushes are less frequent than commits. Nx caching keeps it fast for incremental changes.
- **No deployment pipeline yet:** This ADR covers CI only. CD (deploy to staging/production) will be added in a future ADR when the frontend is ready (M4+).
- **No E2E tests in CI:** Playwright E2E tests exist in `apps/web-e2e` and `apps/api-e2e` but are not wired into CI yet. Will add when there are meaningful E2E scenarios to test (M3+).

### Bypass

- **Pre-commit:** `git commit --no-verify`
- **Pre-push:** `git push --no-verify`
- **CI:** Cannot be bypassed (enforced by GitHub branch protection, when enabled)

## Files

| File                       | Purpose                                                       |
| -------------------------- | ------------------------------------------------------------- |
| `.github/workflows/ci.yml` | GitHub Actions CI pipeline                                    |
| `.husky/pre-commit`        | Pre-commit hook (lint-staged)                                 |
| `.husky/pre-push`          | Pre-push hook (lint + typecheck + test + format)              |
| `.prettierrc`              | Prettier config (singleQuote, trailingComma, printWidth: 100) |
| `.prettierignore`          | Excludes dist, node_modules, .nx, .angular, .playwright-mcp   |
| `package.json`             | `lint-staged` config, `packageManager` field                  |

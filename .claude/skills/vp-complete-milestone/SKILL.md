---
name: vp-complete-milestone
description: Use when VoxPopuli feature or milestone code is implemented and you are about to commit, open a PR, or mark Linear issues Done, or when the pre-push hook or CI fails on lint, test, build, or prettier
---

# Complete a Feature / Milestone (VoxPopuli)

## Overview

"Code works" is not done. Done means: every CI check passes locally, it's verified end-to-end against real services, docs match the code, Linear is updated, and a PR is open.

## 1. Verify (mirrors CI and the pre-push hook)

```bash
pnpm exec nx run-many -t test lint build -p api web shared-types   # there is no typecheck target; build type-checks
pnpm exec vitest run evals                                          # eval harness unit tests
git ls-files | grep -E '\.(ts|tsx|json|md|yml|yaml|css|html)$' | xargs pnpm exec prettier --check
```

- Lint must report **0 errors**. Warnings are pre-existing; don't add new ones in code you touch.
- The pre-push hook runs `prettier --check "**/*..."`, which also scans untracked files, including other worktrees under `.claude/worktrees/`. If it fails **only** on untracked paths and the tracked-files check above passes, push with `--no-verify` and say so in the PR body. Never use `--no-verify` to skip a failure in tracked files.

## 2. Verify End-to-End

For anything touching an external provider (LLM, TTS, HN), unit tests with mocks aren't enough. **REQUIRED SUB-SKILL:** use vp-e2e-verify.

## 2b. Check Compatibility With the Deployed Config

If you **renamed or removed** an env var or an accepted value (a provider name like `groq`, a voice id, an endpoint field), the deployed environment still has the old one:

- Render env-group values set in the dashboard are **not** overwritten by `render.yaml`, and PR previews share the `voxpopuli-secrets` group with production.
- Production runs `main`, so you can't switch the shared value to the new name until the change has merged.
- Cached frontends keep sending old values (e.g. `provider=groq`) for a while.

So keep a deprecated alias that logs a warning (see `PROVIDER_ALIASES` in `llm.service.ts`), and prove the build boots with the **old** value:

```bash
pnpm exec nx build api && set -a && source .env && set +a
LLM_PROVIDER=<old-value> PORT=3100 node apps/api/dist/main.js   # expect "Application is running", then GET /api/health -> 200
```

List the Render dashboard changes the user must make in the PR's unchecked test-plan items.

## 3. Update Docs

Find every stale reference first, rather than relying on memory:

```bash
git grep -n -i "<old name>\|<old env var>\|<old package>" -- '*.md' .env.example render.yaml apps libs .claude/skills
```

| Change type                     | Update                                                                             |
| ------------------------------- | ---------------------------------------------------------------------------------- |
| Any user-visible change         | `CHANGELOG.md` under `## [Unreleased]`                                             |
| Module, endpoint, or provider   | `docs/architecture.md`, `docs/codebase-summary.md`, `docs/product.md`, `README.md` |
| Convention or pitfall           | `CLAUDE.md` (and any `.claude/skills/*` that teach the old way)                    |
| Env var                         | `.env.example`, `render.yaml`, `CLAUDE.md`, `docs/codebase-summary.md`             |
| Design decision with trade-offs | New `docs/adr/NNN-*.md` and add it to the ADR list in `CLAUDE.md`                  |
| Eval behaviour                  | `evals/README.md`                                                                  |

Leave history alone: past milestone checklists, version tables, and measured benchmarks stay as they are. Add an italic note if they're now outdated.

## 4. Commit and PR

Use conventional commits, matching `git log`: `feat: …`, `fix: …`, `docs: …`, `refactor: …`. Put what changed and why in the body. Work on a feature branch. If the work builds on an unmerged PR, branch from that PR's branch and open the new PR with `--base <that-branch>` (a stacked PR).

**Stacked PR merge order:** merge the child into its base branch _before_ the base merges to `main`, or retarget the child to `main` first. A child merged into an already-merged base branch never reaches `main`.

The PR body has: Summary, Test plan (checked boxes for what you ran; unchecked for deploy steps like Render secrets), and Notes (known limits, anything skipped and why).

## 5. Linear (milestones)

Follow vp-linear-sync. Filter by milestone rather than keyword, close leaf tasks and then epics, and add an "Implementation Drift Notes" comment wherever the result differs from the spec.

## Common Mistakes

- Running only `nx test api`, which misses web, evals, lint, and the prettier check CI runs
- Using `npx`/`npm`; this repo uses `pnpm`
- Updating `architecture.md` but not `product.md`, the CHANGELOG, or the skills that document the old behaviour
- Rewriting historical benchmark numbers instead of annotating them
- Renaming a provider or env value without an alias, which crashes deployments whose env group still has the old value (`Unknown LLM provider "groq"`)

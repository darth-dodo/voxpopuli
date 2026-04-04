---
name: vp-implement-module
description: Use when creating a new NestJS module in the VoxPopuli backend - covers service, module, spec file, shared types, and AppModule wiring following project conventions
---

# Implement NestJS Module (VoxPopuli)

## Overview

Pattern for creating a new NestJS module in VoxPopuli. Every module follows the same structure: injectable service, NestJS module with exports, Jest spec file, and wiring into AppModule.

## When to Use

- Adding a new domain module to `apps/api/src/`
- Implementing a Linear epic that introduces a new service
- **Not for:** modifying existing modules, frontend work, or eval harness

## Module Structure

```
apps/api/src/{module-name}/
  {module-name}.service.ts      # @Injectable() service
  {module-name}.module.ts       # NestJS module
  {module-name}.service.spec.ts # Jest tests
  {module-name}.controller.ts   # Only if HTTP endpoints needed
```

## Implementation Checklist

1. **Shared types first** -- Add any new interfaces to `libs/shared-types/src/lib/shared-types.ts` and re-export from `index.ts`
2. **Service** -- `@Injectable()`, constructor injection for dependencies, JSDoc on public methods, strict TypeScript (no `any`)
3. **Module** -- Import dependencies, provide service, export service
4. **Tests** -- Jest with `@swc/jest`, use `Test.createTestingModule()`, mock all external dependencies (HTTP, LLM, cache)
5. **Wire up** -- Import module in `apps/api/src/app/app.module.ts`
6. **Verify** -- `npx nx test api` and `npx nx build api`

## Key Conventions

| Convention     | Rule                                                              |
| -------------- | ----------------------------------------------------------------- |
| DI             | Constructor injection only, no direct imports between modules     |
| External calls | All go through `CacheService.getOrSet<T>()`                       |
| LLM access     | Via `LlmService.getModel()`, never instantiate providers directly |
| Token budgets  | Via `LlmService.getMaxContextTokens()`, not hardcoded             |
| SSE events     | Only `thought`, `action`, `observation`, `answer`, `error` types  |
| Test framework | Jest (not Vitest), mocks via `jest.fn()`                          |

## Common Mistakes

- Importing between NestJS modules directly instead of using DI
- Forgetting to export service from module (other modules can't inject it)
- Using `ConfigModule` import in module -- it's already global
- Hitting real APIs in tests -- always mock HTTP and LLM calls

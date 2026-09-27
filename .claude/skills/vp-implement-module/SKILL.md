---
name: vp-implement-module
description: Use when creating a new NestJS module or service in the VoxPopuli backend, integrating a third-party HTTP API (e.g. a new AI, speech, or data provider), or adding a new environment variable to the API
---

# Implement NestJS Module (VoxPopuli)

## Overview

Every backend module has the same shape: an injectable service, a module that exports it, a Jest spec, and wiring into `AppModule`. Third-party APIs and env vars each have their own checklists below.

## Module Structure

```
apps/api/src/{name}/
  {name}.service.ts       # @Injectable(), constructor DI, JSDoc on public methods
  {name}.module.ts        # imports deps, provides + exports the service
  {name}.service.spec.ts  # Jest (not Vitest), Test.createTestingModule()
  {name}.controller.ts    # only if it exposes HTTP endpoints
```

1. Shared request/response types go in `libs/shared-types/src/lib/shared-types.ts`.
2. Write the service, module, and spec.
3. Import the module in `apps/api/src/app/app.module.ts` (`ConfigModule` is already global).

## Calling a Third-Party HTTP API

Use Node's native `fetch` (no axios or vendor SDK unless it's already in `package.json`), with `AbortSignal.timeout()`.

- **Caching:** if the call is an idempotent read of cacheable data (HN items, deterministic lookups), wrap it in `CacheService.getOrSet(key, fetcher, ttl)`. If it generates fresh or large binary output (TTS audio, LLM generations), call it directly.
- **Errors:** throw a typed error class from the service (e.g. `TtsUpstreamError`). The controller maps that class to **502 Bad Gateway** with the upstream reason in the message, and everything else to 500. Never pass the upstream status straight to our client: an upstream 401 means _our_ key is wrong, not the user's.
- **Config:** the key and model come from `ConfigService`. Fail fast with a clear error if the key is missing.
- **LLM access:** go through `LlmService.getModel()`. Never construct LangChain providers directly.

Reference implementation: `apps/api/src/tts/tts.service.ts` (Mistral Voxtral).

### Testing it

Spy on the global `fetch` and return real `Response` objects. Never hit the real API from Jest, including "skipped" integration specs.

```typescript
const fetchMock = jest
  .spyOn(global, 'fetch')
  .mockResolvedValue(
    new Response(JSON.stringify({ translations: [{ text: 'hola' }] }), { status: 200 }),
  );
afterEach(() => fetchMock.mockRestore());

it('maps upstream failures to the typed error', async () => {
  fetchMock.mockResolvedValueOnce(
    new Response(JSON.stringify({ message: 'quota' }), { status: 456 }),
  );
  await expect(service.translate('hi', 'ES')).rejects.toBeInstanceOf(TranslateUpstreamError);
});
```

Cover the request shape (URL, auth header, body), success parsing, an HTTP error, a non-JSON error body, and a missing key. Real-API checks belong to vp-e2e-verify, not the test suite.

## Adding an Environment Variable

Add it in every one of these places:

| File                                    | What                                                         |
| --------------------------------------- | ------------------------------------------------------------ |
| `apps/api/src/config/env.validation.ts` | `@IsString() @IsOptional()` field (class-validator, not Joi) |
| `.env.example`                          | Commented placeholder with the default                       |
| `render.yaml`                           | `sync: false` for secrets, `value:` for plain config         |
| `CLAUDE.md`                             | Environment Variables section                                |
| `docs/codebase-summary.md`              | Env var table                                                |

When you remove or rename a var (or an accepted value, like a provider name), delete it from all of these too and tell the user to clean up the Render dashboard. Until they do, the old value is still deployed; see vp-complete-milestone §2b.

## Test Setup Gotcha

Specs that transitively import `LlmService` or `AgentService` must mock the providers, because Jest can't load `@langchain/*` ESM:

```typescript
jest.mock('../llm/providers/openrouter.provider', () => ({ OpenRouterProvider: jest.fn() }));
jest.mock('../llm/providers/claude.provider', () => ({ ClaudeProvider: jest.fn() }));
jest.mock('../llm/providers/mistral.provider', () => ({ MistralProvider: jest.fn() }));
```

## Common Mistakes

- Importing another module's service directly instead of through DI and module imports
- Forgetting to export the service from its module
- Using `vi.fn()` in API specs; the API uses Jest (`jest.fn()`)
- `jest.mock('axios')` or `jest.mock('node-fetch')`; spy on the global `fetch` instead
- Adding an env var to `env.validation.ts` but not to `render.yaml` or `.env.example`

Before opening a PR, use vp-complete-milestone.

# ADR-003: LLM Provider Architecture and Tool Protocol Design

**Status:** Accepted
**Date:** 2026-04-04
**Deciders:** Abhishek Juneja
**Linear:** AI-145

## Context

VoxPopuli's agent needs to call three different LLM providers (Claude, Mistral, Groq), each with its own SDK, tool-calling protocol, and message format. The agent uses a ReAct loop with three tools (`search_hn`, `get_story`, `get_comments`), and each provider has a different wire format for passing tool definitions and returning tool results:

- **Claude** uses `tool_use` / `tool_result` content blocks within its native message format.
- **Mistral** uses OpenAI-compatible function calling with `tool` role messages.
- **Groq** uses OpenAI-compatible function calling with `tool` role messages.

Without an abstraction layer, the AgentService would need to maintain three separate code paths for tool invocation, message formatting, and response parsing. For a solo developer, this is a maintenance burden that directly competes with time spent on the actual product.

## Decision

### 1. LangChain.js as the LLM abstraction layer

VoxPopuli uses LangChain.js (`@langchain/core` and provider-specific packages) rather than hand-rolled provider wrappers or the Vercel AI SDK.

**Alternatives evaluated:**

| Option            | Pros                                                                                       | Cons                                                                     |
| ----------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| **LangChain.js**  | Unified ChatModel interface, native tool protocol handling, battle-tested agent primitives | Extra dependency (~200KB), version coupling to LangChain release cycle   |
| **Hand-rolled**   | Zero external dependencies, full control over every API call                               | ~500 lines of tool protocol code across 3 providers, ongoing maintenance |
| **Vercel AI SDK** | Good streaming primitives, lighter weight                                                  | Weaker agent/tool-calling support, less mature tool result handling      |

LangChain.js is chosen because it eliminates the most tedious and error-prone code in the system: translating between VoxPopuli's tool definitions and each provider's native tool protocol. For a solo developer building a demo-quality product, this is the right trade-off between control and velocity.

### 2. Thin provider wrapper pattern

Each LLM provider is a NestJS injectable class that implements `LlmProviderInterface`:

```typescript
export interface LlmProviderInterface {
  readonly name: string; // "claude" | "mistral" | "groq"
  readonly maxContextTokens: number; // Token budget for ChunkerService
  getModel(): BaseChatModel; // LangChain ChatModel instance
}
```

Provider implementations are 20-30 lines each. They instantiate the LangChain ChatModel with the correct API key and model name, and expose the context window size. Example:

```typescript
@Injectable()
export class GroqProvider implements LlmProviderInterface {
  readonly name = 'groq';
  readonly maxContextTokens = 50_000;

  getModel(): BaseChatModel {
    return new ChatGroq({
      apiKey: this.configService.get('GROQ_API_KEY'),
      modelName: 'llama-3.3-70b-versatile',
    });
  }
}
```

This pattern keeps provider-specific code isolated and trivially testable. Adding a new provider (e.g., Google Gemini) requires one new class and a registration in `LlmModule`.

### 3. Tool definitions via LangChain DynamicTool with Zod schemas

Agent tools (`search_hn`, `get_story`, `get_comments`) are defined once in `AgentService` using LangChain's `DynamicTool` class with Zod input schemas. LangChain translates these definitions into the correct format for each provider:

- Claude receives `tools` in Anthropic's native schema format
- Mistral and Groq receive `tools` in OpenAI-compatible function calling format

The AgentService never constructs provider-specific tool payloads. This is the primary value proposition of the LangChain dependency.

### 4. Responsibility boundary between LangChain and VoxPopuli

A clear boundary separates what LangChain handles from what VoxPopuli owns:

**LangChain handles:**

- Tool protocol translation (tool_use/tool_result for Claude, tool role messages for Mistral/Groq)
- Message serialization per provider's expected format
- Streaming token delivery from the model
- Parsing tool calls from model responses
- Agent executor loop (ReAct pattern)

**VoxPopuli owns:**

- Provider instantiation and API key management (NestJS ConfigService)
- Token budget management (ChunkerService -- see ADR-002)
- Response caching (CacheService wrapping node-cache)
- SSE streaming to the frontend (RagController translates LangChain stream events to SSE)
- Safety constraints (max 7 steps, 60s timeout, 5-agent semaphore)
- Tool implementation (the actual `search_hn`, `get_story`, `get_comments` functions that call HnService)

This boundary means LangChain is a transport layer for LLM communication. All business logic -- caching, budgeting, safety, data fetching -- stays in VoxPopuli's own services.

### 5. Provider selection via environment variable with per-request override

The active provider is set by the `LLM_PROVIDER` environment variable (`groq`, `mistral`, or `claude`). Only the active provider's API key is required at startup.

Users can override the provider per-request via a `provider` query parameter on the RAG endpoints. This allows the frontend's provider selector dropdown to switch models without restarting the server.

The `LlmService` facade reads the env var at startup to set the default, and checks for query-param overrides at request time. Zero code changes are needed to switch the default provider.

### 6. Provider packages

Each provider uses a dedicated LangChain adapter package:

| Provider | Package                | Approximate Size | LangChain Class |
| -------- | ---------------------- | ---------------- | --------------- |
| Claude   | `@langchain/anthropic` | ~20 KB           | `ChatAnthropic` |
| Mistral  | `@langchain/mistralai` | ~20 KB           | `ChatMistralAI` |
| Groq     | `@langchain/groq`      | ~20 KB           | `ChatGroq`      |

All three depend on `@langchain/core` (~180 KB), which provides the `BaseChatModel` interface, tool abstractions, and message types. The total LangChain footprint is approximately 200-240 KB.

## Consequences

### Positive

- **Single tool definition.** Tools are defined once with Zod schemas. No per-provider tool formatting code exists anywhere in the codebase.
- **Trivial provider addition.** Adding a fourth provider (e.g., Google Gemini via `@langchain/google-genai`) requires one 20-30 line class and a module registration. No changes to AgentService, ChunkerService, or any controller.
- **Clean responsibility boundary.** LangChain handles LLM communication plumbing; VoxPopuli handles business logic. Neither layer needs to know the internals of the other.
- **Per-request provider switching.** The frontend can let users compare providers on the same query without server restarts, which is valuable for the eval harness and demos.
- **Minimal provider code.** Each provider wrapper is 20-30 lines. The total LLM integration code (excluding tool implementations) is under 200 lines across all files.

### Negative

- **LangChain version coupling.** Breaking changes in `@langchain/core` or provider packages require coordinated updates. LangChain's release cadence is fast, and minor versions occasionally introduce breaking changes in agent APIs.
- **Abstraction opacity.** When a provider-specific issue occurs (e.g., Claude returning an unexpected content block format), debugging requires understanding LangChain's internal message translation, not just the provider's API docs.
- **Bundle size.** The ~200 KB LangChain core dependency is non-trivial for a Node.js backend, though it is modest compared to the NestJS framework itself (~1.5 MB).

### Risks

- **LangChain agent API instability.** LangChain's agent primitives (AgentExecutor, tool calling interfaces) have changed significantly between major versions. Mitigation: pin exact versions in `package.json` and upgrade deliberately. The thin provider wrapper pattern means only `AgentService` touches LangChain's agent APIs directly.
- **Provider SDK version drift.** If a provider updates its API (e.g., Anthropic introduces a new message format), the LangChain adapter package must be updated before VoxPopuli can use it. This creates a dependency on the LangChain maintainers' responsiveness. Mitigation: all three current providers have active LangChain adapter maintenance.
- **Streaming translation complexity.** LangChain's streaming interface may not map cleanly to the SSE event types VoxPopuli needs (`thought`, `action`, `observation`, `answer`, `error`). The RagController may need custom stream transformation logic. Mitigation: this is a localized concern in one controller method, not a systemic risk.

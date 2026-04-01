/**
 * VoxPopuli shared type definitions.
 *
 * Canonical interfaces consumed by both the NestJS API and the Angular client.
 */

// ---------------------------------------------------------------------------
// Core query / response
// ---------------------------------------------------------------------------

/** Inbound RAG query sent by the client. */
export interface RagQuery {
  query: string;
  maxSteps?: number;
  includeComments?: boolean;
  provider?: string;
}

/** Top-level response returned by the agentic RAG pipeline. */
export interface AgentResponse {
  answer: string;
  steps: AgentStep[];
  sources: AgentSource[];
  meta: AgentMeta;
}

/** A single reasoning / action step produced by the agent. */
export interface AgentStep {
  type: 'thought' | 'action' | 'observation';
  content: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolOutput?: string;
  timestamp: number;
}

/** A Hacker News story referenced as a source in the answer. */
export interface AgentSource {
  storyId: number;
  title: string;
  url: string;
  author: string;
  points: number;
  commentCount: number;
}

/** Token-usage and timing metadata for a single agent run. */
export interface AgentMeta {
  provider: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  durationMs: number;
  cached: boolean;
}

// ---------------------------------------------------------------------------
// HN data types
// ---------------------------------------------------------------------------

/** Algolia HN search API response shape. */
export interface HnSearchResult {
  hits: HnSearchHit[];
  nbHits: number;
  page: number;
  nbPages: number;
  hitsPerPage: number;
}

/** A single hit returned by the Algolia HN search API. */
export interface HnSearchHit {
  objectID: string;
  title: string;
  url: string | null;
  author: string;
  points: number;
  num_comments: number;
  created_at: string;
  story_text: string | null;
}

/** A story fetched from the official HN Firebase API. */
export interface HnStory {
  id: number;
  type: string;
  by: string;
  time: number;
  title: string;
  url?: string;
  text?: string;
  score: number;
  descendants: number;
  kids?: number[];
}

/** A comment fetched from the official HN Firebase API. */
export interface HnComment {
  id: number;
  type: string;
  by: string;
  time: number;
  text: string;
  parent: number;
  kids?: number[];
  deleted?: boolean;
  dead?: boolean;
  depth: number;
}

/** Options for HN Algolia search queries. */
export interface HnSearchOptions {
  /** Minimum points filter (default: 1) */
  minPoints?: number;
  /** Number of results per page (default 10, max 20) */
  hitsPerPage?: number;
}

// ---------------------------------------------------------------------------
// Context window chunks
// ---------------------------------------------------------------------------

/** Token-counted chunk of a story used to build the context window. */
export interface StoryChunk {
  storyId: number;
  title: string;
  author: string;
  points: number;
  url: string | null;
  text: string | null;
  tokenCount: number;
}

/** Token-counted chunk of a comment used to build the context window. */
export interface CommentChunk {
  commentId: number;
  storyId: number;
  author: string;
  text: string;
  depth: number;
  tokenCount: number;
}

/** Assembled context window ready to be injected into the LLM prompt. */
export interface ContextWindow {
  stories: StoryChunk[];
  comments: CommentChunk[];
  totalTokens: number;
  truncated: boolean;
}

// ---------------------------------------------------------------------------
// LLM / tool-use types
// ---------------------------------------------------------------------------

/** Descriptor for a tool the agent may invoke. */
export interface ToolDefinition {
  name: string;
  description: string;
  schema: Record<string, unknown>;
}

/** A single message in the LLM conversation. */
export interface LlmMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCallId?: string;
}

/** Response returned by an LLM provider adapter. */
export interface LlmResponse {
  content: string;
  toolCalls?: ToolCall[];
  inputTokens: number;
  outputTokens: number;
}

/** A tool invocation requested by the LLM. */
export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/** Options passed to the LLM chat completion call. */
export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
  tools?: ToolDefinition[];
}

// ---------------------------------------------------------------------------
// TTS
// ---------------------------------------------------------------------------

/** Request payload for the text-to-speech endpoint. */
export interface TtsRequest {
  text: string;
  rewrite?: boolean;
  voiceId?: string;
}

// ---------------------------------------------------------------------------
// Operational
// ---------------------------------------------------------------------------

/** In-memory cache statistics. */
export interface CacheStats {
  hits: number;
  misses: number;
  keys: number;
}

/** Response shape for the health-check endpoint. */
export interface HealthResponse {
  status: 'ok';
  uptime: number;
  cacheStats: CacheStats;
}

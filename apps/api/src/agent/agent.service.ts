import { Injectable, Logger } from '@nestjs/common';
import { createAgent } from 'langchain';
import type { AgentResponse, AgentStep, AgentSource } from '@voxpopuli/shared-types';
import { LlmService } from '../llm/llm.service';
import { HnService } from '../hn/hn.service';
import { ChunkerService } from '../chunker/chunker.service';
import { createAgentTools } from './tools';
import { AGENT_SYSTEM_PROMPT } from './system-prompt';
import { computeTrustMetadata } from './trust';
import { buildPartialResponse } from './partial-response';

/** Maximum concurrent agent runs. */
const MAX_CONCURRENT = 5;

/** Maximum agent steps (recursion limit includes tool call + response pairs). */
const MAX_STEPS = 7;

/** Default recursion limit — each "step" is ~2 graph nodes (call + tool). Add buffer. */
const RECURSION_LIMIT = MAX_STEPS * 2 + 1;

/** Global timeout per agent run in milliseconds. */
const TIMEOUT_MS = 60_000;

/**
 * Core service orchestrating the VoxPopuli ReAct agent loop.
 *
 * Uses LangChain's `createAgent` with the active LLM provider,
 * HnService-backed tools, and the agent system prompt.
 *
 * Constraints: max 7 steps, 60s timeout, 5 concurrent runs.
 */
@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);

  /** Simple semaphore for concurrent run limiting. */
  private activeConcurrent = 0;

  constructor(
    private readonly llm: LlmService,
    private readonly hn: HnService,
    private readonly chunker: ChunkerService,
  ) {}

  /**
   * Execute the full ReAct agent loop for a user query.
   *
   * @param query   - The user's natural-language question
   * @param options - Optional overrides for max steps and provider
   * @returns A complete {@link AgentResponse} with answer, steps, sources, and metadata
   * @throws Error if the concurrency limit is reached or the agent times out
   */
  async run(
    query: string,
    options?: { maxSteps?: number; provider?: string },
  ): Promise<AgentResponse> {
    if (this.activeConcurrent >= MAX_CONCURRENT) {
      throw new Error('Too many concurrent agent runs. Please try again later.');
    }

    this.activeConcurrent++;
    const startTime = Date.now();

    try {
      const maxSteps = options?.maxSteps ?? MAX_STEPS;
      const model = this.llm.getModel(options?.provider);
      const tools = createAgentTools(this.hn, this.chunker);

      const systemPrompt = AGENT_SYSTEM_PROMPT.replace('{{maxSteps}}', String(maxSteps));

      const agent = createAgent({
        model,
        tools,
        systemPrompt,
      });

      const steps: AgentStep[] = [];
      const sourcesMap = new Map<number, AgentSource>();

      // Stream the agent execution to capture intermediate steps
      const stream = await agent.stream(
        { messages: [{ role: 'user', content: query }] },
        {
          recursionLimit: RECURSION_LIMIT,
          signal: AbortSignal.timeout(TIMEOUT_MS),
          streamMode: 'values',
        },
      );

      let finalAnswer = '';

      try {
        for await (const event of stream) {
          const messages = event.messages ?? [];
          const lastMsg = messages[messages.length - 1];
          if (!lastMsg) continue;

          // Tool call — record as action step
          if (lastMsg.tool_calls?.length) {
            for (const tc of lastMsg.tool_calls) {
              steps.push({
                type: 'action',
                content: `Calling ${tc.name}`,
                toolName: tc.name,
                toolInput: tc.args,
                timestamp: Date.now(),
              });
            }
          }

          // Tool result message — record as observation
          if (lastMsg._getType?.() === 'tool' || lastMsg.constructor?.name === 'ToolMessage') {
            steps.push({
              type: 'observation',
              content:
                typeof lastMsg.content === 'string'
                  ? lastMsg.content
                  : JSON.stringify(lastMsg.content),
              toolName: lastMsg.name,
              toolOutput:
                typeof lastMsg.content === 'string'
                  ? lastMsg.content
                  : JSON.stringify(lastMsg.content),
              timestamp: Date.now(),
            });

            // Extract source IDs from search results and story fetches
            this.extractSources(lastMsg.content, sourcesMap);
          }

          // AI message with content but no tool calls — this is a thought or final answer
          if (
            lastMsg.content &&
            !lastMsg.tool_calls?.length &&
            (lastMsg._getType?.() === 'ai' ||
              lastMsg.constructor?.name === 'AIMessage' ||
              lastMsg.constructor?.name === 'AIMessageChunk')
          ) {
            const content = typeof lastMsg.content === 'string' ? lastMsg.content : '';
            finalAnswer = content;

            // If there are already tool steps, AI content before answer is a "thought"
            if (steps.length > 0 && steps[steps.length - 1]?.type === 'observation') {
              steps.push({
                type: 'thought',
                content,
                timestamp: Date.now(),
              });
            }
          }
        }
      } catch (err) {
        // AI-164: Return partial results if we have any useful data
        const error = err instanceof Error ? err : new Error(String(err));
        this.logger.error(`Agent failed after ${steps.length} steps: ${error.message}`);

        const sources = Array.from(sourcesMap.values());
        const partial = buildPartialResponse(
          steps,
          sources,
          this.llm.getProviderName(),
          startTime,
          error,
        );

        if (partial) {
          return partial;
        }

        // No useful data collected — throw clean error
        throw error;
      }

      const durationMs = Date.now() - startTime;
      const sources = Array.from(sourcesMap.values());

      this.logger.log(
        `Agent completed: ${steps.length} steps, ${sourcesMap.size} sources, ${durationMs}ms`,
      );

      return {
        answer: finalAnswer,
        steps,
        sources,
        trust: computeTrustMetadata(steps, sources, finalAnswer),
        meta: {
          provider: this.llm.getProviderName(),
          totalInputTokens: 0,
          totalOutputTokens: 0,
          durationMs,
          cached: false,
        },
      };
    } finally {
      this.activeConcurrent--;
    }
  }

  /**
   * Extract source story IDs from tool output text.
   * Matches the `[storyId]` pattern used by ChunkerService.formatForPrompt().
   */
  private extractSources(content: unknown, sourcesMap: Map<number, AgentSource>): void {
    if (typeof content !== 'string') return;

    // Match story references like [12345] "Title" by author (N points)
    const storyPattern = /\[(\d+)\]\s+"([^"]+)"\s+by\s+(\S+)\s+\((\d+)\s+points/g;
    let match;
    while ((match = storyPattern.exec(content)) !== null) {
      const storyId = parseInt(match[1], 10);
      if (!sourcesMap.has(storyId)) {
        sourcesMap.set(storyId, {
          storyId,
          title: match[2],
          url: '',
          author: match[3],
          points: parseInt(match[4], 10),
          commentCount: 0,
        });
      }
    }
  }
}

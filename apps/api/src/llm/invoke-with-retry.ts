import { Logger } from '@nestjs/common';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { BaseMessage } from '@langchain/core/messages';
import type { AIMessage } from '@langchain/core/messages';
import type { RunnableConfig } from '@langchain/core/runnables';

const logger = new Logger('invokeWithRetry');

/**
 * Maximum fraction of the longest message's content to keep on each retry.
 * Halving the biggest payload is aggressive enough to drop below the TPM
 * limit in one retry while preserving as much context as possible.
 */
const TRUNCATION_FACTOR = 0.5;

/**
 * Detect whether an error is a Groq-style TPM / request-size rate-limit.
 *
 * Groq returns HTTP 413 with:
 *   `{ error: { code: "rate_limit_exceeded", type: "tokens" } }`
 *
 * The LangChain ChatGroq wrapper wraps this in a generic Error whose
 * message contains the original JSON body.
 */
export function isTpmError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message;
  return (
    (msg.includes('rate_limit_exceeded') && msg.includes('tokens per minute')) ||
    (msg.includes('Request too large') && msg.includes('TPM'))
  );
}

/**
 * Find the index of the message with the longest string content.
 * Skips SystemMessage (index 0) since truncating the system prompt
 * would degrade quality more than truncating data payloads.
 */
function indexOfLongestContent(messages: BaseMessage[]): number {
  let maxLen = 0;
  let maxIdx = -1;
  for (let i = 1; i < messages.length; i++) {
    const content = messages[i].content;
    const len = typeof content === 'string' ? content.length : 0;
    if (len > maxLen) {
      maxLen = len;
      maxIdx = i;
    }
  }
  return maxIdx;
}

/**
 * Clone a message array and truncate the longest message's content
 * to `factor` of its original length.
 */
function truncateMessages(messages: BaseMessage[], factor: number): BaseMessage[] {
  const idx = indexOfLongestContent(messages);
  if (idx === -1) return messages;

  const original = messages[idx];
  const content = typeof original.content === 'string' ? original.content : '';
  const truncatedLength = Math.floor(content.length * factor);

  // Clone the messages array with the truncated content
  return messages.map((msg, i) => {
    if (i !== idx) return msg;
    // Construct a new message of the same type with truncated content.
    // LangChain message classes accept (content) or ({content, ...fields}).
    const Ctor = msg.constructor as new (fields: { content: string }) => BaseMessage;
    return new Ctor({ ...msg, content: content.slice(0, truncatedLength) });
  });
}

/**
 * Invoke a LangChain model with automatic retry on Groq TPM rate-limit errors.
 *
 * On a TPM error the function truncates the longest message by 50% and
 * retries once. This covers the common case where a large tool output or
 * raw HN data payload pushes a single request over the per-minute token
 * limit.
 *
 * @param model    - LangChain BaseChatModel (works with any provider but
 *                   the retry only triggers on Groq-style TPM errors)
 * @param messages - The message array to send
 * @param options  - Optional LangChain RunnableConfig (metadata, tags, etc.)
 * @returns The AI message response
 */
export async function invokeWithRetry(
  model: BaseChatModel,
  messages: BaseMessage[],
  options?: RunnableConfig,
): Promise<AIMessage> {
  try {
    return (await model.invoke(messages, options)) as AIMessage;
  } catch (err) {
    if (!isTpmError(err)) throw err;

    const idx = indexOfLongestContent(messages);
    const originalLen = idx >= 0 ? (messages[idx].content as string).length : 0;
    const truncatedLen = Math.floor(originalLen * TRUNCATION_FACTOR);

    logger.warn(
      `TPM rate-limit hit — retrying with truncated context ` +
        `(message[${idx}]: ${originalLen} → ${truncatedLen} chars)`,
    );

    const trimmed = truncateMessages(messages, TRUNCATION_FACTOR);
    return (await model.invoke(trimmed, options)) as AIMessage;
  }
}

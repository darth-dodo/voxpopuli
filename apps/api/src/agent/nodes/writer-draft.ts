import { parsePartialJson } from '@langchain/core/output_parsers';

/** The Writer's JSON fields, as far as they have streamed so far. */
interface PartialWriterOutput {
  headline?: unknown;
  context?: unknown;
  sections?: unknown;
  bottomLine?: unknown;
}

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

/**
 * Render Writer output as the answer's markdown. Used for the final answer and for
 * the live draft of a partially streamed response, so the two can't drift apart.
 *
 * Fields are emitted in order and each string only grows, so every rendering is a
 * prefix of the next one — which is what lets {@link WriterDraftStreamer} send
 * append-only deltas.
 */
export function renderAnswerMarkdown(partial: PartialWriterOutput): string {
  let out = '';
  const headline = str(partial.headline);
  if (headline === undefined) return out;
  out += `## ${headline}`;

  const context = str(partial.context);
  if (context === undefined) return out;
  out += `\n\n${context}`;

  const sections = Array.isArray(partial.sections) ? partial.sections : undefined;
  if (sections === undefined) return out;
  for (const section of sections as Array<Record<string, unknown>>) {
    const heading = str(section?.heading);
    if (heading === undefined) return out;
    out += `\n\n### ${heading}`;
    const body = str(section.body);
    if (body === undefined) return out;
    out += `\n\n${body}`;
  }

  const bottomLine = str(partial.bottomLine);
  if (bottomLine === undefined) return out;
  return `${out}\n\n**Bottom line:** ${bottomLine}`;
}

/** Strip a leading `<think>…</think>` block and markdown fence; undefined until JSON starts. */
function jsonPortion(raw: string): string | undefined {
  let text = raw;
  const thinkStart = text.indexOf('<think>');
  if (thinkStart !== -1) {
    const thinkEnd = text.indexOf('</think>', thinkStart);
    if (thinkEnd === -1) return undefined;
    text = text.slice(thinkEnd + '</think>'.length);
  }
  const brace = text.indexOf('{');
  return brace === -1 ? undefined : text.slice(brace);
}

/**
 * True when the text stops inside a string escape (`\` or `\u00`). parsePartialJson
 * mis-decodes those (`"caf\u00` → `cafu00`), and text already shown can't be taken
 * back, so wait for the next chunk. An even run of backslashes is a complete `\\`.
 */
export function endsMidEscape(json: string): boolean {
  const tail = /(\\+)(u[0-9a-fA-F]{0,3})?$/.exec(json);
  return tail !== null && tail[1].length % 2 === 1;
}

/**
 * Turns the Writer's growing raw output into append-only markdown deltas for the
 * UI's live draft. The final `answer` event replaces the draft, so a skipped or
 * imperfect delta only affects the preview, never the answer.
 */
export class WriterDraftStreamer {
  private rendered = '';

  /** Feed the full raw text so far; returns the new markdown to append ('' if none). */
  push(rawSoFar: string): string {
    const json = jsonPortion(rawSoFar);
    if (json === undefined || endsMidEscape(json)) return '';
    const parsed = parsePartialJson(json) as PartialWriterOutput | null;
    if (!parsed || typeof parsed !== 'object') return '';

    const next = renderAnswerMarkdown(parsed);
    // Only ever append. A non-prefix rendering (e.g. a partial escape sequence that
    // resolved differently) is skipped rather than contradicting text already shown.
    if (next.length <= this.rendered.length || !next.startsWith(this.rendered)) return '';
    const delta = next.slice(this.rendered.length);
    this.rendered = next;
    return delta;
  }
}

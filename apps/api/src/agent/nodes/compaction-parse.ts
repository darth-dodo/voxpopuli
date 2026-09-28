import { parsePartialJson } from '@langchain/core/output_parsers';
import { EvidenceBundleSchema, type ThemeGroup } from '@voxpopuli/shared-types';
import { cleanLlmOutput } from './parse-llm-json';

const EVIDENCE_TYPES = ['evidence', 'anecdote', 'opinion', 'consensus'] as const;
type EvidenceType = (typeof EVIDENCE_TYPES)[number];

/** EvidenceBundleSchema allows at most this many themes. */
const MAX_THEMES = 6;

const StrictThemesSchema = EvidenceBundleSchema.pick({ themes: true });

export type ParsedThemes =
  | { ok: true; themes: ThemeGroup[]; salvaged: boolean }
  | { ok: false; error: string };

type RawItem = Record<string, unknown>;

/**
 * Normalize one evidence item, or drop it (null).
 *
 * Labels are cosmetic, so an unknown `type` becomes `opinion` and `relevance` is
 * clamped — failing the whole query over them sent it to the legacy agent. In
 * salvage mode an item without `type`/`relevance` was cut off mid-write and is dropped.
 */
function normalizeItem(raw: unknown, salvaged: boolean): ThemeGroup['items'][number] | null {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as RawItem;
  if (salvaged && (item['type'] === undefined || item['relevance'] === undefined)) return null;

  // Number(null) and Number('') are 0, so only accept real numbers or numeric strings.
  const rawId = item['sourceId'];
  const sourceId =
    typeof rawId === 'number' || (typeof rawId === 'string' && rawId.trim() !== '')
      ? Number(rawId)
      : Number.NaN;
  const text = typeof item['text'] === 'string' ? item['text'].trim() : '';
  if (!Number.isFinite(sourceId) || !text) return null;

  const type = EVIDENCE_TYPES.includes(item['type'] as EvidenceType)
    ? (item['type'] as EvidenceType)
    : 'opinion';
  const rel = Number(item['relevance']);
  const relevance = Number.isFinite(rel) ? Math.min(1, Math.max(0, rel)) : 0.5;
  return { sourceId, text, type, relevance };
}

function normalizeThemes(raw: unknown, salvaged: boolean): ThemeGroup[] {
  const themes = (raw as { themes?: unknown } | null)?.themes;
  if (!Array.isArray(themes)) return [];
  const out: ThemeGroup[] = [];
  for (const theme of themes) {
    const label = typeof theme?.label === 'string' ? theme.label.trim() : '';
    const items = Array.isArray(theme?.items)
      ? theme.items
          .map((i: unknown) => normalizeItem(i, salvaged))
          .filter((i: ThemeGroup['items'][number] | null): i is ThemeGroup['items'][number] => !!i)
      : [];
    if (label && items.length > 0) out.push({ label, items });
  }
  return out.slice(0, MAX_THEMES);
}

/**
 * Parse the compactor's output into themes, as leniently as is safe.
 *
 * The compactor only generates themes; source metadata, counts and token
 * estimates are filled in by code (ADR-009), because transcribing ~30 source rows
 * cost thousands of output tokens and produced schema failures.
 *
 * - Valid JSON: invalid labels are normalized instead of rejected.
 * - Malformed JSON (e.g. an unescaped quote mid-array): everything before the
 *   syntax error is kept, via a partial parse of that prefix. `salvaged` tells
 *   the caller a retry may recover the rest.
 */
export function parseCompactedThemes(raw: string): ParsedThemes {
  const text = cleanLlmOutput(raw);
  let parsed: unknown;
  let salvaged = false;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    salvaged = true;
    const position = /position (\d+)/.exec(err instanceof Error ? err.message : '')?.[1];
    const prefix = position === undefined ? text : text.slice(0, Number(position));
    parsed = parsePartialJson(prefix);
    if (!parsed) return { ok: false, error: 'Response was not valid JSON.' };
  }

  const themes = normalizeThemes(parsed, salvaged);
  if (themes.length === 0) {
    return { ok: false, error: 'Response contained no themes with usable evidence items.' };
  }
  // Belt and braces: the normalized shape must satisfy the real schema.
  StrictThemesSchema.parse({ themes });
  return { ok: true, themes, salvaged };
}

import { z } from 'zod';

/** Metadata for a HN story used as a source. */
export const SourceMetadataSchema = z.object({
  storyId: z.number(),
  title: z.string(),
  url: z.string(),
  author: z.string(),
  points: z.number(),
  commentCount: z.number(),
});
export type SourceMetadata = z.infer<typeof SourceMetadataSchema>;

/** A single piece of evidence extracted from HN data. */
export const EvidenceItemSchema = z.object({
  sourceId: z.number(),
  text: z.string(),
  type: z.enum(['evidence', 'anecdote', 'opinion', 'consensus']),
  relevance: z.number().min(0).max(1),
});
export type EvidenceItem = z.infer<typeof EvidenceItemSchema>;

/** A thematic grouping of evidence items. */
export const ThemeGroupSchema = z.object({
  label: z.string(),
  items: z.array(EvidenceItemSchema).min(1),
});
export type ThemeGroup = z.infer<typeof ThemeGroupSchema>;

/** Compacted evidence bundle produced by the Retriever. */
export const EvidenceBundleSchema = z.object({
  query: z.string(),
  themes: z.array(ThemeGroupSchema).min(1).max(6),
  allSources: z.array(SourceMetadataSchema),
  totalSourcesScanned: z.number(),
  tokenCount: z.number(),
});
export type EvidenceBundle = z.infer<typeof EvidenceBundleSchema>;

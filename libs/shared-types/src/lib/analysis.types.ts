import { z } from 'zod';

/** A single insight derived from evidence analysis. */
export const InsightSchema = z.object({
  claim: z.string(),
  reasoning: z.string(),
  evidenceStrength: z.enum(['strong', 'moderate', 'weak']),
  themeIndices: z.array(z.number()),
});
export type Insight = z.infer<typeof InsightSchema>;

/** A contradiction found between sources. */
export const ContradictionSchema = z.object({
  claim: z.string(),
  counterClaim: z.string(),
  sourceIds: z.array(z.number()),
});
export type Contradiction = z.infer<typeof ContradictionSchema>;

/** Structured analysis produced by the Synthesizer. */
export const AnalysisResultSchema = z.object({
  summary: z.string(),
  insights: z.array(InsightSchema).min(1).max(5),
  contradictions: z.array(ContradictionSchema),
  confidence: z.enum(['high', 'medium', 'low']),
  gaps: z.array(z.string()),
});
export type AnalysisResult = z.infer<typeof AnalysisResultSchema>;

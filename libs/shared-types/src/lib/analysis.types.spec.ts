import { InsightSchema, ContradictionSchema, AnalysisResultSchema } from './analysis.types';

describe('Analysis Types', () => {
  describe('InsightSchema', () => {
    it('should parse a valid insight', () => {
      const result = InsightSchema.safeParse({
        claim: 'React dominates in enterprise adoption',
        reasoning: 'Multiple HN threads cite Fortune 500 usage',
        evidenceStrength: 'strong',
        themeIndices: [0, 2],
      });
      expect(result.success).toBe(true);
    });

    it('should reject invalid evidenceStrength', () => {
      const result = InsightSchema.safeParse({
        claim: 'test',
        reasoning: 'test',
        evidenceStrength: 'very strong',
        themeIndices: [],
      });
      expect(result.success).toBe(false);
    });
  });

  describe('ContradictionSchema', () => {
    it('should parse a valid contradiction', () => {
      const result = ContradictionSchema.safeParse({
        claim: 'React is fastest',
        counterClaim: 'Svelte benchmarks higher',
        sourceIds: [123, 456],
      });
      expect(result.success).toBe(true);
    });
  });

  describe('AnalysisResultSchema', () => {
    it('should parse a complete analysis', () => {
      const result = AnalysisResultSchema.safeParse({
        summary: 'React leads in adoption, Vue in satisfaction',
        insights: [
          {
            claim: 'React leads adoption',
            reasoning: 'Most cited in job postings',
            evidenceStrength: 'strong',
            themeIndices: [0],
          },
        ],
        contradictions: [],
        confidence: 'medium',
        gaps: ['No data on Svelte adoption'],
      });
      expect(result.success).toBe(true);
    });

    it('should reject more than 5 insights', () => {
      const insights = Array.from({ length: 6 }, (_, i) => ({
        claim: `Claim ${i}`,
        reasoning: 'reason',
        evidenceStrength: 'moderate' as const,
        themeIndices: [0],
      }));
      const result = AnalysisResultSchema.safeParse({
        summary: 'test',
        insights,
        contradictions: [],
        confidence: 'high',
        gaps: [],
      });
      expect(result.success).toBe(false);
    });

    it('should reject invalid confidence level', () => {
      const result = AnalysisResultSchema.safeParse({
        summary: 'test',
        insights: [{ claim: 'x', reasoning: 'y', evidenceStrength: 'weak', themeIndices: [] }],
        contradictions: [],
        confidence: 'very high',
        gaps: [],
      });
      expect(result.success).toBe(false);
    });
  });
});

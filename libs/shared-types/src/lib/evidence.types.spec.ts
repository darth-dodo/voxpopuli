import {
  EvidenceItemSchema,
  ThemeGroupSchema,
  EvidenceBundleSchema,
  SourceMetadataSchema,
} from './evidence.types';

describe('Evidence Types', () => {
  describe('EvidenceItemSchema', () => {
    it('should parse a valid evidence item', () => {
      const result = EvidenceItemSchema.safeParse({
        sourceId: 12345,
        text: 'React Server Components improve TTFB by 40%',
        type: 'evidence',
        relevance: 0.85,
      });
      expect(result.success).toBe(true);
    });

    it('should reject invalid type', () => {
      const result = EvidenceItemSchema.safeParse({
        sourceId: 1,
        text: 'test',
        type: 'rumor',
        relevance: 0.5,
      });
      expect(result.success).toBe(false);
    });

    it('should reject relevance out of range', () => {
      const result = EvidenceItemSchema.safeParse({
        sourceId: 1,
        text: 'test',
        type: 'opinion',
        relevance: 1.5,
      });
      expect(result.success).toBe(false);
    });
  });

  describe('SourceMetadataSchema', () => {
    it('should parse a valid source', () => {
      const result = SourceMetadataSchema.safeParse({
        storyId: 12345,
        title: 'Show HN: My new project',
        url: 'https://example.com',
        author: 'pg',
        points: 250,
        commentCount: 45,
      });
      expect(result.success).toBe(true);
    });
  });

  describe('ThemeGroupSchema', () => {
    it('should require at least one item', () => {
      const result = ThemeGroupSchema.safeParse({
        label: 'Empty theme',
        items: [],
      });
      expect(result.success).toBe(false);
    });
  });

  describe('EvidenceBundleSchema', () => {
    it('should parse a complete bundle', () => {
      const result = EvidenceBundleSchema.safeParse({
        query: 'React vs Vue in 2026',
        themes: [
          {
            label: 'Performance',
            items: [{ sourceId: 1, text: 'React is faster', type: 'evidence', relevance: 0.9 }],
          },
        ],
        allSources: [
          { storyId: 1, title: 'Test', url: '', author: 'a', points: 10, commentCount: 0 },
        ],
        totalSourcesScanned: 15,
        tokenCount: 580,
      });
      expect(result.success).toBe(true);
    });

    it('should reject more than 6 themes', () => {
      const themes = Array.from({ length: 7 }, (_, i) => ({
        label: `Theme ${i}`,
        items: [{ sourceId: i, text: 'x', type: 'evidence' as const, relevance: 0.5 }],
      }));
      const result = EvidenceBundleSchema.safeParse({
        query: 'test',
        themes,
        allSources: [],
        totalSourcesScanned: 0,
        tokenCount: 0,
      });
      expect(result.success).toBe(false);
    });
  });
});

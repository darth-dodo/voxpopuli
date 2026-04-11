import { buildFallbackResponse } from './fallback-response';
import type { AnalysisResult, EvidenceBundle } from '@voxpopuli/shared-types';

const mockBundle: EvidenceBundle = {
  query: 'test query',
  themes: [
    {
      label: 'Theme A',
      items: [{ sourceId: 1, text: 'Some evidence', type: 'evidence', relevance: 0.8 }],
    },
  ],
  allSources: [
    {
      storyId: 1,
      title: 'Story 1',
      url: 'https://example.com',
      author: 'alice',
      points: 100,
      commentCount: 50,
    },
    {
      storyId: 2,
      title: 'Story 2',
      url: 'https://example.com/2',
      author: 'bob',
      points: 200,
      commentCount: 30,
    },
  ],
  totalSourcesScanned: 5,
  tokenCount: 1200,
};

const mockAnalysis: AnalysisResult = {
  summary: 'HN community is divided on testing frameworks',
  insights: [
    {
      claim: 'Jest is the most popular choice',
      reasoning: 'Multiple sources cite Jest adoption rates',
      evidenceStrength: 'strong',
      themeIndices: [0],
    },
    {
      claim: 'Vitest is gaining momentum',
      reasoning: 'Recent posts show growing interest',
      evidenceStrength: 'moderate',
      themeIndices: [0],
    },
  ],
  contradictions: [
    { claim: 'Jest is slow', counterClaim: 'Jest is fast enough', sourceIds: [1, 2] },
  ],
  confidence: 'medium',
  gaps: ['No data on enterprise adoption'],
};

const mockMeta = {
  provider: 'groq',
  durationMs: 5000,
  totalInputTokens: 800,
  totalOutputTokens: 400,
};

describe('buildFallbackResponse', () => {
  it('should produce a valid AgentResponse with answer containing summary as headline', () => {
    const result = buildFallbackResponse(mockAnalysis, mockBundle, mockMeta);
    expect(result.answer).toContain('HN community is divided on testing frameworks');
  });

  it('should create one section per insight', () => {
    const result = buildFallbackResponse(mockAnalysis, mockBundle, mockMeta);
    expect(result.answer).toContain('Jest is the most popular choice');
    expect(result.answer).toContain('Vitest is gaining momentum');
    expect(result.answer).toContain('Multiple sources cite Jest adoption rates');
    expect(result.answer).toContain('Recent posts show growing interest');
  });

  it('should include confidence and gaps in the bottom line', () => {
    const result = buildFallbackResponse(mockAnalysis, mockBundle, mockMeta);
    expect(result.answer).toContain('medium');
    expect(result.answer).toContain('No data on enterprise adoption');
  });

  it('should map bundle.allSources to AgentSource format', () => {
    const result = buildFallbackResponse(mockAnalysis, mockBundle, mockMeta);
    expect(result.sources).toHaveLength(2);
    expect(result.sources[0]).toEqual({
      storyId: 1,
      title: 'Story 1',
      url: 'https://example.com',
      author: 'alice',
      points: 100,
      commentCount: 50,
    });
  });

  it('should pass through meta with error flag', () => {
    const result = buildFallbackResponse(mockAnalysis, mockBundle, mockMeta);
    expect(result.meta).toMatchObject({
      provider: 'groq',
      durationMs: 5000,
      totalInputTokens: 800,
      totalOutputTokens: 400,
      cached: false,
      error: true,
    });
  });

  it('should include empty steps array', () => {
    const result = buildFallbackResponse(mockAnalysis, mockBundle, mockMeta);
    expect(result.steps).toEqual([]);
  });

  it('should include trust metadata', () => {
    const result = buildFallbackResponse(mockAnalysis, mockBundle, mockMeta);
    expect(result.trust).toBeDefined();
    expect(result.trust.sourcesTotal).toBe(2);
  });
});

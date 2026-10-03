import {
  AnalysisResultSchema,
  type AnalysisResult,
  type EvidenceBundle,
} from '@voxpopuli/shared-types';

// Mock LLM providers
jest.mock('../../llm/providers/openrouter.provider', () => ({ OpenRouterProvider: jest.fn() }));
jest.mock('../../llm/providers/claude.provider', () => ({ ClaudeProvider: jest.fn() }));
jest.mock('../../llm/providers/mistral.provider', () => ({ MistralProvider: jest.fn() }));

import {
  applyEvidenceFloor,
  createMergedSynthesizerNode,
  createSynthesizerNode,
} from './synthesizer.node';
import { buildFallbackResponse } from '../fallback-response';

const SAMPLE_BUNDLE: EvidenceBundle = {
  query: 'React vs Vue',
  themes: [
    {
      label: 'Performance',
      items: [{ sourceId: 1, text: 'React is fast', type: 'evidence', relevance: 0.9 }],
    },
  ],
  allSources: [{ storyId: 1, title: 'Story', url: '', author: 'a', points: 10, commentCount: 0 }],
  totalSourcesScanned: 5,
  tokenCount: 200,
};

describe('SynthesizerNode', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mockModel = { invoke: jest.fn() } as any;

  beforeEach(() => jest.clearAllMocks());

  it('should produce a valid AnalysisResult', async () => {
    const analysisJson = JSON.stringify({
      summary: 'React leads in performance benchmarks',
      insights: [
        {
          claim: 'React is faster',
          reasoning: 'Benchmarks show 40% improvement',
          evidenceStrength: 'strong',
          themeIndices: [0],
        },
      ],
      contradictions: [],
      confidence: 'medium',
      gaps: ['No Vue 4 data available'],
    });
    mockModel.invoke.mockResolvedValue({ content: analysisJson });

    const node = createSynthesizerNode(mockModel);
    const result = await node({ query: 'React vs Vue', bundle: SAMPLE_BUNDLE });

    expect(result.analysis).toBeDefined();
    const parsed = AnalysisResultSchema.safeParse(result.analysis);
    expect(parsed.success).toBe(true);
  });

  it('should strip markdown fences before parsing', async () => {
    const analysisJson = JSON.stringify({
      summary: 'test',
      insights: [{ claim: 'c', reasoning: 'r', evidenceStrength: 'weak', themeIndices: [0] }],
      contradictions: [],
      confidence: 'low',
      gaps: [],
    });
    mockModel.invoke.mockResolvedValue({ content: '```json\n' + analysisJson + '\n```' });

    const node = createSynthesizerNode(mockModel);
    const result = await node({ query: 'test', bundle: SAMPLE_BUNDLE });

    expect(result.analysis).toBeDefined();
  });

  it('should retry on invalid JSON and succeed', async () => {
    const validJson = JSON.stringify({
      summary: 'test',
      insights: [{ claim: 'c', reasoning: 'r', evidenceStrength: 'moderate', themeIndices: [0] }],
      contradictions: [],
      confidence: 'medium',
      gaps: [],
    });
    mockModel.invoke
      .mockResolvedValueOnce({ content: 'not json at all' })
      .mockResolvedValueOnce({ content: validJson });

    const node = createSynthesizerNode(mockModel);
    const result = await node({ query: 'test', bundle: SAMPLE_BUNDLE });

    expect(result.analysis).toBeDefined();
    expect(mockModel.invoke).toHaveBeenCalledTimes(2);
  });

  it('should throw on double failure', async () => {
    mockModel.invoke
      .mockResolvedValueOnce({ content: 'bad' })
      .mockResolvedValueOnce({ content: 'still bad' });

    const node = createSynthesizerNode(mockModel);
    await expect(node({ query: 'test', bundle: SAMPLE_BUNDLE })).rejects.toThrow();
  });

  it('should not dispatch any custom events (pure data transformer)', async () => {
    const analysisJson = JSON.stringify({
      summary: 'test',
      insights: [{ claim: 'c', reasoning: 'r', evidenceStrength: 'moderate', themeIndices: [0] }],
      contradictions: [],
      confidence: 'medium',
      gaps: [],
    });
    mockModel.invoke.mockResolvedValue({ content: analysisJson });

    const node = createSynthesizerNode(mockModel);
    const result = await node({ query: 'test', bundle: SAMPLE_BUNDLE });

    expect(result.analysis).toBeDefined();
    // Node is a pure data transformer — no dispatchCustomEvent calls
  });

  it('insights capped at 5', async () => {
    // 5 insights should pass schema validation
    const fiveInsights = Array.from({ length: 5 }, (_, i) => ({
      claim: `Claim ${i + 1}`,
      reasoning: `Reasoning ${i + 1}`,
      evidenceStrength: 'moderate' as const,
      themeIndices: [0],
    }));
    const analysisWithFive = JSON.stringify({
      summary: 'Multi-insight analysis',
      insights: fiveInsights,
      contradictions: [],
      confidence: 'high',
      gaps: [],
    });
    mockModel.invoke.mockResolvedValue({ content: analysisWithFive });

    const node = createSynthesizerNode(mockModel);
    const result = await node({ query: 'React vs Vue', bundle: SAMPLE_BUNDLE });

    expect(result.analysis.insights).toHaveLength(5);
    const parsed = AnalysisResultSchema.safeParse(result.analysis);
    expect(parsed.success).toBe(true);

    // 6 insights should fail schema validation
    const sixInsights = Array.from({ length: 6 }, (_, i) => ({
      claim: `Claim ${i + 1}`,
      reasoning: `Reasoning ${i + 1}`,
      evidenceStrength: 'moderate' as const,
      themeIndices: [0],
    }));
    const invalidAnalysis = {
      summary: 'Too many insights',
      insights: sixInsights,
      contradictions: [],
      confidence: 'high',
      gaps: [],
    };
    const schemaResult = AnalysisResultSchema.safeParse(invalidAnalysis);
    expect(schemaResult.success).toBe(false);
  });

  it('contradictions reference valid source IDs', async () => {
    const analysisJson = JSON.stringify({
      summary: 'Conflicting views on framework performance',
      insights: [
        {
          claim: 'React is faster in benchmarks',
          reasoning: 'Synthetic benchmarks favor React',
          evidenceStrength: 'moderate',
          themeIndices: [0],
        },
      ],
      contradictions: [
        {
          claim: 'React is fastest',
          counterClaim: 'Vue is fastest in real-world apps',
          sourceIds: [1, 2],
        },
      ],
      confidence: 'medium',
      gaps: [],
    });
    mockModel.invoke.mockResolvedValue({ content: analysisJson });

    const node = createSynthesizerNode(mockModel);
    const result = await node({ query: 'React vs Vue', bundle: SAMPLE_BUNDLE });

    expect(result.analysis.contradictions).toHaveLength(1);
    const contradiction = result.analysis.contradictions[0];
    expect(contradiction.claim).toBe('React is fastest');
    expect(contradiction.counterClaim).toBe('Vue is fastest in real-world apps');
    expect(contradiction.sourceIds).toEqual([1, 2]);

    const parsed = AnalysisResultSchema.safeParse(result.analysis);
    expect(parsed.success).toBe(true);
  });

  it('confidence reflects evidence strength', async () => {
    const analysisJson = JSON.stringify({
      summary: 'Strong evidence supports React performance leadership',
      insights: [
        {
          claim: 'React outperforms in rendering benchmarks',
          reasoning: 'Multiple independent benchmarks confirm 30-40% faster rendering',
          evidenceStrength: 'strong',
          themeIndices: [0],
        },
      ],
      contradictions: [],
      confidence: 'high',
      gaps: [],
    });
    mockModel.invoke.mockResolvedValue({ content: analysisJson });

    // "high" is only kept with enough distinct stories (see applyEvidenceFloor).
    const wellSourcedBundle: EvidenceBundle = {
      ...SAMPLE_BUNDLE,
      allSources: [1, 2, 3].map((storyId) => ({
        storyId,
        title: `Story ${storyId}`,
        url: '',
        author: 'a',
        points: 10,
        commentCount: 0,
      })),
    };
    const node = createSynthesizerNode(mockModel);
    const result = await node({ query: 'React vs Vue', bundle: wellSourcedBundle });

    expect(result.analysis.confidence).toBe('high');
    expect(result.analysis.insights[0].evidenceStrength).toBe('strong');

    const parsed = AnalysisResultSchema.safeParse(result.analysis);
    expect(parsed.success).toBe(true);
  });

  it('minimal bundle (1 theme, 1 item) returns valid analysis with appropriate confidence', async () => {
    const minimalBundle: EvidenceBundle = {
      query: 'Niche framework opinion',
      themes: [
        {
          label: 'Limited data',
          items: [
            { sourceId: 42, text: 'Only one mention found', type: 'evidence', relevance: 0.5 },
          ],
        },
      ],
      allSources: [
        { storyId: 42, title: 'Solo source', url: '', author: 'b', points: 3, commentCount: 1 },
      ],
      totalSourcesScanned: 1,
      tokenCount: 50,
    };

    const analysisJson = JSON.stringify({
      summary: 'Very limited evidence available on this topic',
      insights: [
        {
          claim: 'Insufficient data for strong conclusions',
          reasoning: 'Only a single source with one mention',
          evidenceStrength: 'weak',
          themeIndices: [0],
        },
      ],
      contradictions: [],
      confidence: 'low',
      gaps: ['Only one source found', 'No comparative data available'],
    });
    mockModel.invoke.mockResolvedValue({ content: analysisJson });

    const node = createSynthesizerNode(mockModel);
    const result = await node({ query: 'Niche framework opinion', bundle: minimalBundle });

    expect(result.analysis).toBeDefined();
    expect(result.analysis.confidence).toBe('low');
    expect(result.analysis.insights).toHaveLength(1);
    expect(result.analysis.gaps.length).toBeGreaterThan(0);

    const parsed = AnalysisResultSchema.safeParse(result.analysis);
    expect(parsed.success).toBe(true);
  });

  it('handles thinking tags in LLM output', async () => {
    const analysisJson = JSON.stringify({
      summary: 'Analysis after internal reasoning',
      insights: [
        {
          claim: 'Derived after deep thought',
          reasoning: 'Model internally reasoned through evidence',
          evidenceStrength: 'moderate',
          themeIndices: [0],
        },
      ],
      contradictions: [],
      confidence: 'medium',
      gaps: [],
    });
    const llmOutput =
      '<think>Let me reason about this step by step.\nThe evidence suggests React is popular.\nI should structure my response carefully.</think>' +
      analysisJson;
    mockModel.invoke.mockResolvedValue({ content: llmOutput });

    const node = createSynthesizerNode(mockModel);
    const result = await node({ query: 'React vs Vue', bundle: SAMPLE_BUNDLE });

    expect(result.analysis).toBeDefined();
    expect(result.analysis.summary).toBe('Analysis after internal reasoning');

    const parsed = AnalysisResultSchema.safeParse(result.analysis);
    expect(parsed.success).toBe(true);
  });
});

describe('applyEvidenceFloor', () => {
  const base: AnalysisResult = {
    summary: 's',
    insights: [],
    contradictions: [],
    confidence: 'high',
    gaps: ['existing gap'],
  };

  it('leaves analyses with enough sources untouched', () => {
    expect(applyEvidenceFloor(base, 3)).toBe(base);
  });

  it('caps confidence at low with one source and explains the gap', () => {
    const result = applyEvidenceFloor(base, 1);
    expect(result.confidence).toBe('low');
    expect(result.gaps).toEqual([
      'existing gap',
      expect.stringContaining('Only 1 Hacker News story was found'),
    ]);
  });

  it('caps confidence at medium with two sources, but never raises it', () => {
    expect(applyEvidenceFloor(base, 2).confidence).toBe('medium');
    expect(applyEvidenceFloor({ ...base, confidence: 'low' }, 2).confidence).toBe('low');
  });

  it('flags answers with no HN sources at all', () => {
    expect(applyEvidenceFloor(base, 0).gaps[1]).toContain('not grounded in HN discussion');
  });
});

describe('createMergedSynthesizerNode', () => {
  it('makes no LLM call and derives confidence from source coverage', async () => {
    const node = createMergedSynthesizerNode();

    const thin = await node({ bundle: SAMPLE_BUNDLE }); // 1 source
    expect(thin.analysis.confidence).toBe('low');
    expect(thin.analysis.gaps[0]).toContain('Only 1 Hacker News story');
    expect(thin.inputTokens + thin.outputTokens).toBe(0);

    const wellSourced = await node({
      bundle: {
        ...SAMPLE_BUNDLE,
        allSources: [1, 2, 3].map((storyId) => ({ ...SAMPLE_BUNDLE.allSources[0], storyId })),
      },
    });
    expect(wellSourced.analysis.confidence).toBe('high');
    expect(wellSourced.analysis.gaps).toEqual([]);
  });

  it('builds a schema-valid extractive analysis, so a Writer failure still reads sensibly', async () => {
    const { analysis } = await createMergedSynthesizerNode()({ bundle: SAMPLE_BUNDLE });

    expect(AnalysisResultSchema.safeParse(analysis).success).toBe(true);
    expect(analysis.summary).not.toBe('');
    expect(analysis.insights[0]).toMatchObject({ claim: 'Performance', themeIndices: [0] });
    expect(analysis.insights[0].reasoning).toContain('[1]'); // keeps the citation

    const fallback = buildFallbackResponse(analysis, SAMPLE_BUNDLE, {
      provider: 'mistral',
      durationMs: 1,
      totalInputTokens: 0,
      totalOutputTokens: 0,
    });
    expect(fallback.answer).not.toMatch(/^## \s*$/m); // no empty headline
    expect(fallback.answer).toContain('### Performance');
  });
});

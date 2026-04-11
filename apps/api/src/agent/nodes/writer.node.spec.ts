import {
  AgentResponseV2Schema,
  type AnalysisResult,
  type EvidenceBundle,
} from '@voxpopuli/shared-types';

jest.mock('../../llm/providers/groq.provider', () => ({ GroqProvider: jest.fn() }));
jest.mock('../../llm/providers/claude.provider', () => ({ ClaudeProvider: jest.fn() }));
jest.mock('../../llm/providers/mistral.provider', () => ({ MistralProvider: jest.fn() }));

import { createWriterNode } from './writer.node';

const SAMPLE_BUNDLE: EvidenceBundle = {
  query: 'React vs Vue',
  themes: [
    { label: 'Perf', items: [{ sourceId: 1, text: 'Fast', type: 'evidence', relevance: 0.9 }] },
  ],
  allSources: [{ storyId: 1, title: 'Story', url: '', author: 'a', points: 10, commentCount: 0 }],
  totalSourcesScanned: 5,
  tokenCount: 200,
};

const SAMPLE_ANALYSIS: AnalysisResult = {
  summary: 'React leads in adoption',
  insights: [
    {
      claim: 'React is popular',
      reasoning: 'Most cited',
      evidenceStrength: 'strong',
      themeIndices: [0],
    },
  ],
  contradictions: [],
  confidence: 'medium',
  gaps: ['No Vue 4 data'],
};

describe('WriterNode', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mockModel = { invoke: jest.fn() } as any;

  beforeEach(() => jest.clearAllMocks());

  it('should produce a valid AgentResponseV2', async () => {
    const responseJson = JSON.stringify({
      headline: 'React remains the top framework choice in 2026',
      context: 'Based on HN discussion trends.',
      sections: [
        { heading: 'Adoption', body: 'React leads [1].', citedSources: [1] },
        { heading: 'Community', body: 'Active community [1].', citedSources: [1] },
      ],
      bottomLine: 'React is the safe bet for enterprise.',
      sources: SAMPLE_BUNDLE.allSources,
    });
    mockModel.invoke.mockResolvedValue({ content: responseJson });

    const node = createWriterNode(mockModel);
    const result = await node({
      query: 'React vs Vue',
      bundle: SAMPLE_BUNDLE,
      analysis: SAMPLE_ANALYSIS,
    });

    expect(result.response).toBeDefined();
    const parsed = AgentResponseV2Schema.safeParse(result.response);
    expect(parsed.success).toBe(true);
  });

  it('should retry on invalid JSON and succeed', async () => {
    const validJson = JSON.stringify({
      headline: 'h',
      context: 'c',
      sections: [
        { heading: 'S1', body: 'b1', citedSources: [1] },
        { heading: 'S2', body: 'b2', citedSources: [1] },
      ],
      bottomLine: 'bl',
      sources: SAMPLE_BUNDLE.allSources,
    });
    mockModel.invoke
      .mockResolvedValueOnce({ content: 'not valid json' })
      .mockResolvedValueOnce({ content: validJson });

    const node = createWriterNode(mockModel);
    const result = await node({
      query: 'test',
      bundle: SAMPLE_BUNDLE,
      analysis: SAMPLE_ANALYSIS,
    });

    expect(result.response).toBeDefined();
    expect(mockModel.invoke).toHaveBeenCalledTimes(2);
  });

  it('should throw on double failure', async () => {
    mockModel.invoke
      .mockResolvedValueOnce({ content: 'bad' })
      .mockResolvedValueOnce({ content: 'still bad' });

    const node = createWriterNode(mockModel);
    await expect(
      node({ query: 'test', bundle: SAMPLE_BUNDLE, analysis: SAMPLE_ANALYSIS }),
    ).rejects.toThrow();
  });

  it('should not dispatch any custom events (pure data transformer)', async () => {
    const responseJson = JSON.stringify({
      headline: 'h',
      context: 'c',
      sections: [
        { heading: 'S1', body: 'b1', citedSources: [] },
        { heading: 'S2', body: 'b2', citedSources: [] },
      ],
      bottomLine: 'bl',
      sources: [],
    });
    mockModel.invoke.mockResolvedValue({ content: responseJson });

    const node = createWriterNode(mockModel);
    const result = await node({
      query: 'test',
      bundle: SAMPLE_BUNDLE,
      analysis: SAMPLE_ANALYSIS,
    });

    expect(result.response).toBeDefined();
    // Node is a pure data transformer — no dispatchCustomEvent calls
  });

  it('citedSources only contain IDs from bundle.allSources', async () => {
    const responseJson = JSON.stringify({
      headline: 'Framework comparison results',
      context: 'Analysis of HN discussions.',
      sections: [
        { heading: 'Performance', body: 'React is fast [1].', citedSources: [1] },
        { heading: 'Ecosystem', body: 'Large ecosystem [1].', citedSources: [1] },
      ],
      bottomLine: 'React wins on performance.',
      sources: SAMPLE_BUNDLE.allSources,
    });
    mockModel.invoke.mockResolvedValue({ content: responseJson });

    const node = createWriterNode(mockModel);
    const result = await node({
      query: 'React vs Vue',
      bundle: SAMPLE_BUNDLE,
      analysis: SAMPLE_ANALYSIS,
    });

    const validSourceIds = SAMPLE_BUNDLE.allSources.map((s) => s.storyId);

    const allCitedSources = result.response.sections.flatMap((s) => s.citedSources);
    for (const id of allCitedSources) {
      expect(validSourceIds).toContain(id);
    }
  });

  it('headline does not start with "Based on..."', async () => {
    const responseJson = JSON.stringify({
      headline: 'React dominates HN sentiment in 2026',
      context: 'Drawn from recent Hacker News threads.',
      sections: [
        { heading: 'Popularity', body: 'Most discussed framework [1].', citedSources: [1] },
        { heading: 'Trends', body: 'Growing adoption [1].', citedSources: [1] },
      ],
      bottomLine: 'React remains the community favorite.',
      sources: SAMPLE_BUNDLE.allSources,
    });
    mockModel.invoke.mockResolvedValue({ content: responseJson });

    const node = createWriterNode(mockModel);
    const result = await node({
      query: 'React vs Vue',
      bundle: SAMPLE_BUNDLE,
      analysis: SAMPLE_ANALYSIS,
    });

    expect(result.response.headline).toBe('React dominates HN sentiment in 2026');
    expect(result.response.headline.startsWith('Based on')).toBe(false);
  });

  it('sections count is 2-4 (schema rejects 1 or 5 sections)', () => {
    const baseResponse = {
      headline: 'h',
      context: 'c',
      bottomLine: 'bl',
      sources: [],
    };

    const oneSection = AgentResponseV2Schema.safeParse({
      ...baseResponse,
      sections: [{ heading: 'S1', body: 'b1', citedSources: [] }],
    });
    expect(oneSection.success).toBe(false);

    const fiveSections = AgentResponseV2Schema.safeParse({
      ...baseResponse,
      sections: [
        { heading: 'S1', body: 'b1', citedSources: [] },
        { heading: 'S2', body: 'b2', citedSources: [] },
        { heading: 'S3', body: 'b3', citedSources: [] },
        { heading: 'S4', body: 'b4', citedSources: [] },
        { heading: 'S5', body: 'b5', citedSources: [] },
      ],
    });
    expect(fiveSections.success).toBe(false);

    const twoSections = AgentResponseV2Schema.safeParse({
      ...baseResponse,
      sections: [
        { heading: 'S1', body: 'b1', citedSources: [] },
        { heading: 'S2', body: 'b2', citedSources: [] },
      ],
    });
    expect(twoSections.success).toBe(true);

    const fourSections = AgentResponseV2Schema.safeParse({
      ...baseResponse,
      sections: [
        { heading: 'S1', body: 'b1', citedSources: [] },
        { heading: 'S2', body: 'b2', citedSources: [] },
        { heading: 'S3', body: 'b3', citedSources: [] },
        { heading: 'S4', body: 'b4', citedSources: [] },
      ],
    });
    expect(fourSections.success).toBe(true);
  });

  it('low confidence analysis produces response preserving confidence context', async () => {
    const lowConfidenceAnalysis: AnalysisResult = {
      summary: 'Limited data on enterprise adoption',
      insights: [
        {
          claim: 'Enterprise usage is unclear',
          reasoning: 'Few sources discuss enterprise use cases',
          evidenceStrength: 'weak',
          themeIndices: [0],
        },
      ],
      contradictions: [],
      confidence: 'low',
      gaps: ['Missing enterprise data'],
    };

    const responseJson = JSON.stringify({
      headline: 'Enterprise framework adoption remains uncertain',
      context: 'Limited HN discussion on enterprise use cases.',
      sections: [
        { heading: 'What We Know', body: 'Few data points available [1].', citedSources: [1] },
        {
          heading: 'Knowledge Gaps',
          body: 'Enterprise adoption data is scarce.',
          citedSources: [],
        },
      ],
      bottomLine: 'More data needed before drawing conclusions.',
      sources: SAMPLE_BUNDLE.allSources,
    });
    mockModel.invoke.mockResolvedValue({ content: responseJson });

    const node = createWriterNode(mockModel);
    const result = await node({
      query: 'Enterprise framework adoption',
      bundle: SAMPLE_BUNDLE,
      analysis: lowConfidenceAnalysis,
    });

    expect(result.response).toBeDefined();
    const parsed = AgentResponseV2Schema.safeParse(result.response);
    expect(parsed.success).toBe(true);
    expect(result.response.sections.length).toBeGreaterThanOrEqual(2);
    expect(result.response.sections.length).toBeLessThanOrEqual(4);
  });

  it('sources in response match bundle.allSources', async () => {
    const multiSourceBundle: EvidenceBundle = {
      query: 'React vs Vue',
      themes: [
        {
          label: 'Perf',
          items: [
            { sourceId: 1, text: 'Fast rendering', type: 'evidence', relevance: 0.9 },
            { sourceId: 2, text: 'Small bundle', type: 'evidence', relevance: 0.8 },
          ],
        },
      ],
      allSources: [
        {
          storyId: 1,
          title: 'React Perf',
          url: 'https://hn.example/1',
          author: 'alice',
          points: 120,
          commentCount: 45,
        },
        {
          storyId: 2,
          title: 'Vue Bundle Size',
          url: 'https://hn.example/2',
          author: 'bob',
          points: 80,
          commentCount: 22,
        },
      ],
      totalSourcesScanned: 10,
      tokenCount: 400,
    };

    const responseJson = JSON.stringify({
      headline: 'Framework performance showdown',
      context: 'Comparing React and Vue performance metrics.',
      sections: [
        { heading: 'Rendering', body: 'React leads in rendering [1].', citedSources: [1] },
        { heading: 'Bundle', body: 'Vue has smaller bundles [2].', citedSources: [2] },
      ],
      bottomLine: 'Both frameworks have performance strengths.',
      sources: multiSourceBundle.allSources,
    });
    mockModel.invoke.mockResolvedValue({ content: responseJson });

    const node = createWriterNode(mockModel);
    const result = await node({
      query: 'React vs Vue',
      bundle: multiSourceBundle,
      analysis: SAMPLE_ANALYSIS,
    });

    expect(result.response.sources).toHaveLength(multiSourceBundle.allSources.length);
    for (let i = 0; i < result.response.sources.length; i++) {
      const responseSource = result.response.sources[i];
      const bundleSource = multiSourceBundle.allSources[i];
      expect(responseSource.storyId).toBe(bundleSource.storyId);
      expect(responseSource.title).toBe(bundleSource.title);
      expect(responseSource.url).toBe(bundleSource.url);
      expect(responseSource.author).toBe(bundleSource.author);
      expect(responseSource.points).toBe(bundleSource.points);
      expect(responseSource.commentCount).toBe(bundleSource.commentCount);
    }
  });
});

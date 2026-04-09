import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AgentResponse } from '@voxpopuli/shared-types';
import type { EvalQuery, EvalRunResult, EvalScore } from '../types';

vi.mock('../evaluators/source-accuracy', () => ({
  evaluateSourceAccuracy: vi.fn(),
}));
vi.mock('../evaluators/quality-judge', () => ({
  evaluateQualityChecklist: vi.fn(),
}));
vi.mock('../evaluators/efficiency', () => ({
  evaluateEfficiency: vi.fn(),
}));
vi.mock('../evaluators/latency', () => ({
  evaluateLatency: vi.fn(),
}));
vi.mock('../evaluators/cost', () => ({
  evaluateCost: vi.fn(),
}));

import { evaluateSourceAccuracy } from '../evaluators/source-accuracy';
import { evaluateQualityChecklist } from '../evaluators/quality-judge';
import { evaluateEfficiency } from '../evaluators/efficiency';
import { evaluateLatency } from '../evaluators/latency';
import { evaluateCost } from '../evaluators/cost';
import { scoreRun, buildReport } from '../score';

const mockedSourceAccuracy = vi.mocked(evaluateSourceAccuracy);
const mockedQualityChecklist = vi.mocked(evaluateQualityChecklist);
const mockedEfficiency = vi.mocked(evaluateEfficiency);
const mockedLatency = vi.mocked(evaluateLatency);
const mockedCost = vi.mocked(evaluateCost);

function makeQuery(overrides: Partial<EvalQuery> = {}): EvalQuery {
  return {
    id: 'q01',
    query: 'What is trending on HN?',
    category: 'trending',
    expectedQualities: ['mentions trends', 'cites sources'],
    expectedMinSources: 3,
    maxAcceptableSteps: 5,
    ...overrides,
  };
}

function makeResponse(overrides: Partial<AgentResponse> = {}): AgentResponse {
  return {
    answer: 'Here are the trends...',
    steps: [
      { type: 'thought', content: 'thinking', timestamp: Date.now() },
      { type: 'action', content: 'searching', toolName: 'search_hn', timestamp: Date.now() },
      { type: 'observation', content: 'results', timestamp: Date.now() },
    ],
    sources: [
      {
        storyId: 123,
        title: 'Story 1',
        url: 'https://hn.com/1',
        author: 'a',
        points: 100,
        commentCount: 10,
      },
    ],
    meta: {
      provider: 'groq',
      totalInputTokens: 5000,
      totalOutputTokens: 1000,
      durationMs: 4000,
      cached: false,
    },
    trust: {
      sourceCount: 1,
      avgSourceAge: 1,
      sourceDiversity: 0.5,
      hasMultiplePerspectives: false,
      claimDensity: 0.5,
      overallTrust: 0.7,
    } as AgentResponse['trust'],
    ...overrides,
  };
}

function makeRunResult(overrides: Partial<EvalRunResult> = {}): EvalRunResult {
  return {
    queryId: 'q01',
    query: 'What is trending on HN?',
    response: makeResponse(),
    durationMs: 4000,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('scoreRun', () => {
  it('returns all zeros when response is null', async () => {
    const result = await scoreRun(makeRunResult({ response: null }), makeQuery(), 'groq');

    expect(result.queryId).toBe('q01');
    expect(result.sourceAccuracy).toBe(0);
    expect(result.qualityChecklist).toBe(0);
    expect(result.efficiency).toBe(0);
    expect(result.latency).toBe(0);
    expect(result.cost).toBe(0);
    expect(result.weighted).toBe(0);

    // Evaluators should NOT be called for null response
    expect(mockedSourceAccuracy).not.toHaveBeenCalled();
    expect(mockedQualityChecklist).not.toHaveBeenCalled();
    expect(mockedEfficiency).not.toHaveBeenCalled();
    expect(mockedLatency).not.toHaveBeenCalled();
    expect(mockedCost).not.toHaveBeenCalled();
  });

  it('calls all evaluators and computes weighted score for valid response', async () => {
    mockedSourceAccuracy.mockResolvedValue({
      key: 'source_accuracy',
      score: 0.8,
      comment: '4/5 verified',
    });
    mockedQualityChecklist.mockResolvedValue({
      key: 'quality_checklist',
      score: 0.6,
      comment: '3/5 present',
    });
    mockedEfficiency.mockReturnValue({ key: 'efficiency', score: 1.0, comment: '3 steps' });
    mockedLatency.mockReturnValue({ key: 'latency', score: 0.7, comment: '4.0s' });
    mockedCost.mockReturnValue({ key: 'cost', score: 0.9, comment: '$0.002' });

    const query = makeQuery();
    const runResult = makeRunResult();
    const result = await scoreRun(runResult, query, 'groq');

    // Verify evaluators called with correct args
    expect(mockedSourceAccuracy).toHaveBeenCalledWith(runResult.response);
    expect(mockedQualityChecklist).toHaveBeenCalledWith(
      runResult.response,
      query.expectedQualities,
    );
    expect(mockedEfficiency).toHaveBeenCalledWith(3, query.maxAcceptableSteps);
    expect(mockedLatency).toHaveBeenCalledWith(runResult.durationMs, 'groq');
    expect(mockedCost).toHaveBeenCalledWith(5000, 1000, 'groq');

    // Verify individual scores
    expect(result.sourceAccuracy).toBe(0.8);
    expect(result.qualityChecklist).toBe(0.6);
    expect(result.efficiency).toBe(1.0);
    expect(result.latency).toBe(0.7);
    expect(result.cost).toBe(0.9);

    // Weighted = 0.8*0.30 + 0.6*0.30 + 1.0*0.15 + 0.7*0.15 + 0.9*0.10
    // = 0.24 + 0.18 + 0.15 + 0.105 + 0.09 = 0.765
    expect(result.weighted).toBeCloseTo(0.765, 3);
    expect(result.queryId).toBe('q01');
  });

  it('collects evaluator comments in details', async () => {
    mockedSourceAccuracy.mockResolvedValue({
      key: 'source_accuracy',
      score: 1.0,
      comment: '5/5 verified',
    });
    mockedQualityChecklist.mockResolvedValue({ key: 'quality_checklist', score: 1.0 });
    mockedEfficiency.mockReturnValue({ key: 'efficiency', score: 1.0, comment: '2 steps' });
    mockedLatency.mockReturnValue({ key: 'latency', score: 1.0 });
    mockedCost.mockReturnValue({ key: 'cost', score: 1.0, comment: '$0.001' });

    const result = await scoreRun(makeRunResult(), makeQuery(), 'groq');

    expect(result.details).toBeDefined();
    expect(result.details['source_accuracy']).toBe('5/5 verified');
    expect(result.details['efficiency']).toBe('2 steps');
    expect(result.details['cost']).toBe('$0.001');
  });
});

describe('buildReport', () => {
  function makeScore(overrides: Partial<EvalScore> = {}): EvalScore {
    return {
      queryId: 'q01',
      sourceAccuracy: 0.8,
      qualityChecklist: 0.7,
      efficiency: 0.9,
      latency: 0.6,
      cost: 0.85,
      weighted: 0.77,
      details: {},
      ...overrides,
    };
  }

  it('computes correct averages across all scores', () => {
    const scores: EvalScore[] = [
      makeScore({
        queryId: 'q01',
        sourceAccuracy: 0.9,
        qualityChecklist: 0.8,
        efficiency: 1.0,
        latency: 0.7,
        cost: 0.9,
        weighted: 0.86,
      }),
      makeScore({
        queryId: 'q02',
        sourceAccuracy: 0.6,
        qualityChecklist: 0.5,
        efficiency: 0.8,
        latency: 0.3,
        cost: 0.7,
        weighted: 0.57,
      }),
      makeScore({
        queryId: 'q03',
        sourceAccuracy: 0.3,
        qualityChecklist: 0.9,
        efficiency: 0.6,
        latency: 1.0,
        cost: 0.8,
        weighted: 0.63,
      }),
    ];

    const report = buildReport(scores, 'groq');

    expect(report.provider).toBe('groq');
    expect(report.queries).toBe(3);
    expect(report.scores).toBe(scores);
    expect(report.summary.avgSourceAccuracy).toBeCloseTo(0.6, 3);
    expect(report.summary.avgQualityChecklist).toBeCloseTo(0.7333, 3);
    expect(report.summary.avgEfficiency).toBeCloseTo(0.8, 3);
    expect(report.summary.avgLatency).toBeCloseTo(0.6667, 3);
    expect(report.summary.avgCost).toBeCloseTo(0.8, 3);
    expect(report.summary.avgWeighted).toBeCloseTo(0.6867, 3);
  });

  it('computes passRate correctly', () => {
    const scores: EvalScore[] = [
      makeScore({ queryId: 'q01', weighted: 0.8 }), // pass
      makeScore({ queryId: 'q02', weighted: 0.5 }), // fail
      makeScore({ queryId: 'q03', weighted: 0.65 }), // pass
    ];

    const report = buildReport(scores, 'groq');

    // 2 of 3 pass => 66.67%
    expect(report.summary.passRate).toBeCloseTo(66.67, 1);
  });

  it('handles empty scores array', () => {
    const report = buildReport([], 'groq');

    expect(report.queries).toBe(0);
    expect(report.summary.avgWeighted).toBe(0);
    expect(report.summary.passRate).toBe(0);
  });

  it('includes ISO timestamp', () => {
    const report = buildReport([makeScore()], 'claude');

    expect(report.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

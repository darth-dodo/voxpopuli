import type { AgentStep, AgentSource } from '@voxpopuli/shared-types';
import { computeTrustMetadata } from './trust';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStep(overrides: Partial<AgentStep> & { type: AgentStep['type'] }): AgentStep {
  return {
    content: '',
    timestamp: Date.now(),
    ...overrides,
  };
}

function makeSource(overrides: Partial<AgentSource> = {}): AgentSource {
  return {
    storyId: 1,
    title: 'Test Story',
    url: 'https://example.com',
    author: 'user',
    points: 100,
    commentCount: 10,
    ...overrides,
  };
}

/** Create a YYYY-MM-DD date string for N days ago. */
function daysAgoDateStr(days: number): string {
  const d = new Date(Date.now() - days * 86_400_000);
  return d.toISOString().split('T')[0];
}

/** Sources (distinct story IDs) posted the given numbers of days ago. */
function sourcesPostedDaysAgo(...days: number[]): AgentSource[] {
  return days.map((d, i) => makeSource({ storyId: i + 1, postedDate: daysAgoDateStr(d) }));
}

// ---------------------------------------------------------------------------
// Tests: Source verification
// ---------------------------------------------------------------------------

describe('computeTrustMetadata', () => {
  describe('source verification', () => {
    it('should verify sources from get_story action steps', () => {
      const steps: AgentStep[] = [
        makeStep({
          type: 'action',
          content: 'Getting story',
          toolName: 'get_story',
          toolInput: { story_id: 42 },
        }),
        makeStep({
          type: 'observation',
          content: 'Story details',
          toolName: 'get_story',
          toolOutput: `[42] "Test" by user (100 points)\nPosted: ${daysAgoDateStr(10)}`,
        }),
      ];
      const sources = [makeSource({ storyId: 42 }), makeSource({ storyId: 99 })];

      const result = computeTrustMetadata(steps, sources, 'Answer text');

      expect(result.sourcesVerified).toBe(1);
      expect(result.sourcesTotal).toBe(2);
    });

    it('should verify sources from get_comments action steps', () => {
      const steps: AgentStep[] = [
        makeStep({
          type: 'action',
          content: 'Getting comments',
          toolName: 'get_comments',
          toolInput: { story_id: 55 },
        }),
      ];
      const sources = [makeSource({ storyId: 55 })];

      const result = computeTrustMetadata(steps, sources, 'Answer');

      expect(result.sourcesVerified).toBe(1);
    });

    it('should extract story IDs from search_hn observation [12345] format', () => {
      const steps: AgentStep[] = [
        makeStep({
          type: 'observation',
          content: 'Search results',
          toolName: 'search_hn',
          toolOutput: '[100] "Story A" by user1\n[200] "Story B" by user2',
        }),
      ];
      const sources = [
        makeSource({ storyId: 100 }),
        makeSource({ storyId: 200 }),
        makeSource({ storyId: 300 }),
      ];

      const result = computeTrustMetadata(steps, sources, 'Answer');

      expect(result.sourcesVerified).toBe(2);
      expect(result.sourcesTotal).toBe(3);
    });
  });

  // -------------------------------------------------------------------------
  // Date extraction and recency
  // -------------------------------------------------------------------------

  describe('date extraction and recency', () => {
    it('should compute avgSourceAge from source postedDate', () => {
      const result = computeTrustMetadata([], sourcesPostedDaysAgo(30), 'Answer');

      // avgSourceAge should be approximately 30 days
      expect(result.avgSourceAge).toBeGreaterThanOrEqual(29);
      expect(result.avgSourceAge).toBeLessThanOrEqual(31);
    });

    it('should report recency for search-only runs (no get_story calls)', () => {
      const steps: AgentStep[] = [
        makeStep({ type: 'action', content: '', toolName: 'search_hn' }),
        makeStep({
          type: 'observation',
          content: '',
          toolName: 'search_hn',
          toolOutput: '[1] "Story A" by user1 (10 points)',
        }),
      ];

      const result = computeTrustMetadata(steps, sourcesPostedDaysAgo(40), 'Answer');

      expect(result.avgSourceAge).toBeGreaterThanOrEqual(39);
      expect(result.avgSourceAge).toBeLessThanOrEqual(41);
      expect(result.recentSourceRatio).toBe(1);
    });

    it('should compute avgSourceAge as average of all source dates', () => {
      const result = computeTrustMetadata([], sourcesPostedDaysAgo(100, 200), 'Answer');

      // Average should be ~150 days
      expect(result.avgSourceAge).toBeGreaterThanOrEqual(149);
      expect(result.avgSourceAge).toBeLessThanOrEqual(151);
    });

    it('should compute recentSourceRatio for sources within 365 days', () => {
      const result = computeTrustMetadata([], sourcesPostedDaysAgo(100, 500), 'Answer');

      // 1 out of 2 is recent
      expect(result.recentSourceRatio).toBe(0.5);
    });

    it('should skip sources without a postedDate or with an unparseable one', () => {
      const sources = [
        makeSource({ storyId: 1, postedDate: daysAgoDateStr(60) }),
        makeSource({ storyId: 2 }),
        makeSource({ storyId: 3, postedDate: 'not-a-date' }),
      ];

      const result = computeTrustMetadata([], sources, 'Answer');

      expect(result.avgSourceAge).toBeGreaterThanOrEqual(59);
      expect(result.avgSourceAge).toBeLessThanOrEqual(61);
      expect(result.recentSourceRatio).toBe(1);
    });

    it('should return 0 for avgSourceAge and recentSourceRatio when no dates found', () => {
      const steps: AgentStep[] = [makeStep({ type: 'thought', content: 'thinking' })];

      const result = computeTrustMetadata(steps, [makeSource()], 'Answer');

      expect(result.avgSourceAge).toBe(0);
      expect(result.recentSourceRatio).toBe(0);
    });

    it('should ignore "Posted:" lines in tool output (dates come from sources)', () => {
      const steps: AgentStep[] = [
        makeStep({
          type: 'observation',
          content: '',
          toolName: 'get_story',
          toolOutput: `[1] "Story" by user\nPosted: ${daysAgoDateStr(30)}`,
        }),
      ];

      const result = computeTrustMetadata(steps, [], 'Answer');

      expect(result.avgSourceAge).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // Viewpoint diversity
  // -------------------------------------------------------------------------

  describe('viewpoint diversity', () => {
    it('should return "contested" when answer contains contrasting phrases', () => {
      const result = computeTrustMetadata(
        [],
        [],
        'Some people love Rust, however others prefer Go.',
      );

      expect(result.viewpointDiversity).toBe('contested');
    });

    it('should detect contrasting phrases case-insensitively', () => {
      const result = computeTrustMetadata([], [], 'Critics Say that the framework is too complex.');

      expect(result.viewpointDiversity).toBe('contested');
    });

    it('should return "balanced" when multiple search_hn calls were made', () => {
      const steps: AgentStep[] = [
        makeStep({ type: 'action', content: '', toolName: 'search_hn' }),
        makeStep({ type: 'action', content: '', toolName: 'search_hn' }),
      ];

      const result = computeTrustMetadata(steps, [], 'Plain answer');

      expect(result.viewpointDiversity).toBe('balanced');
    });

    it('should return "balanced" when comments from 2+ distinct stories', () => {
      const steps: AgentStep[] = [
        makeStep({
          type: 'action',
          content: '',
          toolName: 'get_comments',
          toolInput: { story_id: 1 },
        }),
        makeStep({
          type: 'action',
          content: '',
          toolName: 'get_comments',
          toolInput: { story_id: 2 },
        }),
      ];

      const result = computeTrustMetadata(steps, [], 'Plain answer');

      expect(result.viewpointDiversity).toBe('balanced');
    });

    it('should return "one-sided" by default', () => {
      const result = computeTrustMetadata([], [], 'Simple answer');

      expect(result.viewpointDiversity).toBe('one-sided');
    });

    it('should return "one-sided" with single search and single comment story', () => {
      const steps: AgentStep[] = [
        makeStep({ type: 'action', content: '', toolName: 'search_hn' }),
        makeStep({
          type: 'action',
          content: '',
          toolName: 'get_comments',
          toolInput: { story_id: 1 },
        }),
      ];

      const result = computeTrustMetadata(steps, [], 'Simple answer');

      expect(result.viewpointDiversity).toBe('one-sided');
    });
  });

  // -------------------------------------------------------------------------
  // Show HN detection
  // -------------------------------------------------------------------------

  describe('Show HN count', () => {
    it('should count sources with "Show HN:" title prefix', () => {
      const sources = [
        makeSource({ title: 'Show HN: My Cool Project' }),
        makeSource({ title: 'Show HN: Another Project' }),
        makeSource({ title: 'Ask HN: Something else' }),
      ];

      const result = computeTrustMetadata([], sources, 'Answer');

      expect(result.showHnCount).toBe(2);
    });

    it('should return 0 when no Show HN sources', () => {
      const sources = [makeSource({ title: 'Regular Story' })];

      const result = computeTrustMetadata([], sources, 'Answer');

      expect(result.showHnCount).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // Honesty flags
  // -------------------------------------------------------------------------

  describe('honesty flags', () => {
    it('should add "no_results_found" when answer contains matching phrases', () => {
      const phrases = [
        "couldn't find any relevant discussions",
        'no relevant results were available',
        'no results matched the query',
        'nothing found on this topic',
        'could not find matching stories',
        'unable to find anything',
      ];

      for (const phrase of phrases) {
        const result = computeTrustMetadata([], [], `The agent ${phrase}.`);
        expect(result.honestyFlags).toContain('no_results_found');
      }
    });

    it('should not add "no_results_found" for normal answers', () => {
      const result = computeTrustMetadata([], [], 'Here are the results I found.');

      expect(result.honestyFlags).not.toContain('no_results_found');
    });

    it('should add "old_sources_noted" when all dates are > 2 years old', () => {
      const result = computeTrustMetadata([], sourcesPostedDaysAgo(800), 'Answer');

      expect(result.honestyFlags).toContain('old_sources_noted');
    });

    it('should not add "old_sources_noted" when at least one date is recent', () => {
      const result = computeTrustMetadata([], sourcesPostedDaysAgo(800, 100), 'Answer');

      expect(result.honestyFlags).not.toContain('old_sources_noted');
    });

    it('should not add "old_sources_noted" when no dates are found', () => {
      const result = computeTrustMetadata([], [], 'Answer');

      expect(result.honestyFlags).not.toContain('old_sources_noted');
    });
  });

  // -------------------------------------------------------------------------
  // Edge cases
  // -------------------------------------------------------------------------

  describe('edge cases', () => {
    it('should handle empty steps, sources, and answer', () => {
      const result = computeTrustMetadata([], [], '');

      expect(result.sourcesVerified).toBe(0);
      expect(result.sourcesTotal).toBe(0);
      expect(result.avgSourceAge).toBe(0);
      expect(result.recentSourceRatio).toBe(0);
      expect(result.viewpointDiversity).toBe('one-sided');
      expect(result.showHnCount).toBe(0);
      expect(result.honestyFlags).toEqual([]);
    });
  });
});

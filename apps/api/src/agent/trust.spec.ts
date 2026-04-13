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

/** Create a "Posted: YYYY-MM-DD" date string for N days ago. */
function daysAgoDateStr(days: number): string {
  const d = new Date(Date.now() - days * 86_400_000);
  return d.toISOString().split('T')[0];
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
    it('should extract dates from "Posted: YYYY-MM-DD" in observation toolOutput', () => {
      const recentDate = daysAgoDateStr(30);
      const steps: AgentStep[] = [
        makeStep({
          type: 'observation',
          content: '',
          toolName: 'get_story',
          toolOutput: `[1] "Story" by user\nPosted: ${recentDate}`,
        }),
      ];

      const result = computeTrustMetadata(steps, [], 'Answer');

      // avgSourceAge should be approximately 30 days
      expect(result.avgSourceAge).toBeGreaterThanOrEqual(29);
      expect(result.avgSourceAge).toBeLessThanOrEqual(31);
    });

    it('should compute avgSourceAge as average of all dates', () => {
      const date1 = daysAgoDateStr(100);
      const date2 = daysAgoDateStr(200);
      const steps: AgentStep[] = [
        makeStep({
          type: 'observation',
          content: '',
          toolName: 'get_story',
          toolOutput: `Posted: ${date1}`,
        }),
        makeStep({
          type: 'observation',
          content: '',
          toolName: 'get_story',
          toolOutput: `Posted: ${date2}`,
        }),
      ];

      const result = computeTrustMetadata(steps, [], 'Answer');

      // Average should be ~150 days
      expect(result.avgSourceAge).toBeGreaterThanOrEqual(149);
      expect(result.avgSourceAge).toBeLessThanOrEqual(151);
    });

    it('should compute recentSourceRatio for sources within 365 days', () => {
      const recentDate = daysAgoDateStr(100);
      const oldDate = daysAgoDateStr(500);
      const steps: AgentStep[] = [
        makeStep({
          type: 'observation',
          content: '',
          toolOutput: `Posted: ${recentDate}`,
        }),
        makeStep({
          type: 'observation',
          content: '',
          toolOutput: `Posted: ${oldDate}`,
        }),
      ];

      const result = computeTrustMetadata(steps, [], 'Answer');

      // 1 out of 2 is recent
      expect(result.recentSourceRatio).toBe(0.5);
    });

    it('should return 0 for avgSourceAge and recentSourceRatio when no dates found', () => {
      const steps: AgentStep[] = [makeStep({ type: 'thought', content: 'thinking' })];

      const result = computeTrustMetadata(steps, [], 'Answer');

      expect(result.avgSourceAge).toBe(0);
      expect(result.recentSourceRatio).toBe(0);
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
      const oldDate = daysAgoDateStr(800);
      const steps: AgentStep[] = [
        makeStep({
          type: 'observation',
          content: '',
          toolOutput: `Posted: ${oldDate}`,
        }),
      ];

      const result = computeTrustMetadata(steps, [], 'Answer');

      expect(result.honestyFlags).toContain('old_sources_noted');
    });

    it('should not add "old_sources_noted" when at least one date is recent', () => {
      const oldDate = daysAgoDateStr(800);
      const recentDate = daysAgoDateStr(100);
      const steps: AgentStep[] = [
        makeStep({
          type: 'observation',
          content: '',
          toolOutput: `Posted: ${oldDate}`,
        }),
        makeStep({
          type: 'observation',
          content: '',
          toolOutput: `Posted: ${recentDate}`,
        }),
      ];

      const result = computeTrustMetadata(steps, [], 'Answer');

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

    it('should ignore non-observation steps for date extraction', () => {
      const steps: AgentStep[] = [
        makeStep({
          type: 'thought',
          content: 'Posted: 2024-01-01',
        }),
        makeStep({
          type: 'action',
          content: 'Posted: 2024-01-01',
          toolName: 'get_story',
          toolInput: { story_id: 1 },
        }),
      ];

      const result = computeTrustMetadata(steps, [], 'Answer');

      expect(result.avgSourceAge).toBe(0);
    });

    it('should ignore observation steps without toolOutput for date extraction', () => {
      const steps: AgentStep[] = [
        makeStep({
          type: 'observation',
          content: 'Posted: 2024-01-01',
          // no toolOutput
        }),
      ];

      const result = computeTrustMetadata(steps, [], 'Answer');

      expect(result.avgSourceAge).toBe(0);
    });
  });
});

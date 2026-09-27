import { describe, it, expect } from 'vitest';
import { parseSseChunk, StreamAccumulator } from '../stream-client';

const ev = (type: string, data: unknown) => ({ type, data: JSON.stringify(data) });

describe('parseSseChunk', () => {
  it('parses complete events and keeps the partial remainder', () => {
    const { events, rest } = parseSseChunk(
      'event: pipeline\nid: 1\ndata: {"a":1}\n\nevent: ping\ndata: \n\nevent: answ',
    );
    expect(events).toEqual([
      { type: 'pipeline', data: '{"a":1}' },
      { type: 'ping', data: '' },
    ]);
    expect(rest).toBe('event: answ');
  });
});

describe('StreamAccumulator', () => {
  const answer = {
    answer: 'A',
    sources: [],
    trust: {},
    meta: { provider: 'mistral', totalInputTokens: 1, totalOutputTokens: 1, durationMs: 1 },
  };

  it('captures stage timings, steps and the final answer', () => {
    const acc = new StreamAccumulator();
    expect(acc.push({ type: 'ping', data: '' }, 1)).toBe(false);
    acc.push(ev('init', { queryId: 'x' }), 40);
    acc.push(ev('action', { type: 'action', content: 'search_hn()', timestamp: 1 }), 50);
    acc.push(
      ev('pipeline', { stage: 'retriever', status: 'done', detail: '', elapsed: 9000 }),
      9000,
    );
    acc.push(ev('pipeline', { stage: 'writer', status: 'done', detail: '', elapsed: 4000 }), 20000);
    expect(acc.push(ev('answer', answer), 20001)).toBe(true);

    const result = acc.result('q', 20001);
    expect(result.error).toBeUndefined();
    expect(result.response?.steps).toHaveLength(1);
    expect(result.timings).toEqual({
      firstEventMs: 40, // pings are ignored
      stages: { retriever: 9000, writer: 4000 },
      fallback: false,
    });
  });

  it('flags a fallback when any pipeline stage reports an error', () => {
    const acc = new StreamAccumulator();
    acc.push(ev('pipeline', { stage: 'retriever', status: 'error', detail: '', elapsed: 0 }), 10);
    acc.push(ev('answer', answer), 60000);
    expect(acc.result('q', 60000).timings?.fallback).toBe(true);
  });

  it('reports server errors and streams that end without an answer', () => {
    const errored = new StreamAccumulator();
    expect(errored.push(ev('error', { message: '401 Invalid API Key' }), 400)).toBe(true);
    expect(errored.result('q', 400)).toMatchObject({
      response: null,
      error: '401 Invalid API Key',
    });

    expect(new StreamAccumulator().result('q', 5).error).toBe('Stream ended without an answer');
  });
});

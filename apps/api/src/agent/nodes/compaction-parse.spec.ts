import { parseCompactedThemes } from './compaction-parse';

const item = (sourceId: number, text: string, extra: Record<string, unknown> = {}) => ({
  sourceId,
  text,
  type: 'evidence',
  relevance: 0.8,
  ...extra,
});

describe('parseCompactedThemes', () => {
  it('accepts valid output unchanged', () => {
    const raw = JSON.stringify({ themes: [{ label: 'Perf', items: [item(1, 'Fast')] }] });

    expect(parseCompactedThemes(raw)).toEqual({
      ok: true,
      salvaged: false,
      themes: [{ label: 'Perf', items: [item(1, 'Fast')] }],
    });
  });

  it('normalizes cosmetic labels instead of failing the whole query', () => {
    // Real failure: the model used types outside the enum and the query fell back to the legacy agent.
    const raw = JSON.stringify({
      themes: [
        {
          label: 'Criticism',
          items: [
            item(1, 'Too slow', { type: 'criticism', relevance: 1.7 }),
            item(2, 'Meh', { relevance: 'high' }),
          ],
        },
      ],
    });

    const result = parseCompactedThemes(raw);

    expect(result).toMatchObject({ ok: true, salvaged: false });
    if (!result.ok) throw new Error('expected ok');
    expect(result.themes[0].items).toEqual([
      { sourceId: 1, text: 'Too slow', type: 'opinion', relevance: 1 },
      { sourceId: 2, text: 'Meh', type: 'evidence', relevance: 0.5 },
    ]);
  });

  it('drops unusable items and themes and keeps at most 6 themes', () => {
    const themes = [
      { label: 'Empty', items: [] },
      { label: 'Bad items', items: [{ text: 'no id' }, item(Number.NaN, 'nan'), item(3, '   ')] },
      ...Array.from({ length: 8 }, (_, i) => ({ label: `T${i}`, items: [item(i + 10, `x${i}`)] })),
    ];

    const result = parseCompactedThemes(JSON.stringify({ themes }));

    if (!result.ok) throw new Error('expected ok');
    expect(result.themes.map((t) => t.label)).toEqual(['T0', 'T1', 'T2', 'T3', 'T4', 'T5']);
  });

  it('salvages the themes before a syntax error and drops the cut-off item', () => {
    // An unescaped quote mid-array is the real "Expected ',' or ']'" failure shape.
    const raw =
      '{"themes":[{"label":"Good","items":[{"sourceId":1,"text":"Solid","type":"evidence","relevance":0.9}]},' +
      '{"label":"Broken","items":[{"sourceId":2,"text":"He said "hello" loudly","type":"opinion","relevance":0.4}]}]}';

    const result = parseCompactedThemes(raw);

    expect(result).toMatchObject({ ok: true, salvaged: true });
    if (!result.ok) throw new Error('expected ok');
    expect(result.themes).toEqual([
      { label: 'Good', items: [{ sourceId: 1, text: 'Solid', type: 'evidence', relevance: 0.9 }] },
    ]);
  });

  it('reports failure when nothing usable is left', () => {
    expect(parseCompactedThemes('not json at all')).toMatchObject({ ok: false });
    expect(parseCompactedThemes('{"themes":[]}')).toMatchObject({
      ok: false,
      error: expect.stringContaining('no themes'),
    });
  });

  it('handles fenced output like the rest of the pipeline', () => {
    const raw =
      '```json\n' + JSON.stringify({ themes: [{ label: 'A', items: [item(1, 'a')] }] }) + '\n```';

    expect(parseCompactedThemes(raw)).toMatchObject({ ok: true, salvaged: false });
  });
});

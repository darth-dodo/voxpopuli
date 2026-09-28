import { endsMidEscape, renderAnswerMarkdown, WriterDraftStreamer } from './writer-draft';

// Quotes, a backslash and a non-ASCII character exercise every JSON escape form.
const RESPONSE = {
  headline: 'Rust is "production-ready" for web backends, café C:\\dev',
  context: 'HN discussion is broadly positive.\nSome caveats remain.',
  sections: [
    { heading: 'Performance', body: 'Axum and Actix are fast [101].', citedSources: [101] },
    { heading: 'Ecosystem', body: 'Crates are maturing [102].', citedSources: [102] },
  ],
  bottomLine: 'Use it where latency matters.',
};

const FINAL_MARKDOWN =
  '## Rust is "production-ready" for web backends, café C:\\dev\n\n' +
  'HN discussion is broadly positive.\nSome caveats remain.\n\n' +
  '### Performance\n\nAxum and Actix are fast [101].\n\n' +
  '### Ecosystem\n\nCrates are maturing [102].\n\n' +
  '**Bottom line:** Use it where latency matters.';

describe('renderAnswerMarkdown', () => {
  it('renders a complete response in the final answer format', () => {
    expect(renderAnswerMarkdown(RESPONSE)).toBe(FINAL_MARKDOWN);
  });

  it('renders only the fields that have started, in order', () => {
    expect(renderAnswerMarkdown({})).toBe('');
    expect(renderAnswerMarkdown({ headline: 'Rus' })).toBe('## Rus');
    expect(renderAnswerMarkdown({ headline: 'H', sections: [] })).toBe('## H');
    expect(
      renderAnswerMarkdown({ headline: 'H', context: 'C', sections: [{ heading: 'Sec' }] }),
    ).toBe('## H\n\nC\n\n### Sec');
  });
});

describe('WriterDraftStreamer', () => {
  /** Stream `raw` one character at a time and return the concatenated deltas. */
  const streamCharByChar = (raw: string): { draft: string; deltas: number } => {
    const streamer = new WriterDraftStreamer();
    let draft = '';
    let deltas = 0;
    for (let i = 1; i <= raw.length; i++) {
      const delta = streamer.push(raw.slice(0, i));
      if (delta) {
        draft += delta;
        deltas++;
      }
    }
    return { draft, deltas };
  };

  it('produces append-only deltas that add up to exactly the final answer', () => {
    const { draft, deltas } = streamCharByChar(JSON.stringify(RESPONSE));

    expect(draft).toBe(FINAL_MARKDOWN);
    expect(deltas).toBeGreaterThan(20); // it actually streams, not one final dump
  });

  it('ignores a markdown fence and a leading <think> block', () => {
    const raw = '<think>Plan {the} answer</think>\n```json\n' + JSON.stringify(RESPONSE) + '\n```';

    expect(streamCharByChar(raw).draft).toBe(FINAL_MARKDOWN);
  });

  it('handles \\u escapes (models that emit ASCII-only JSON) without garbling text', () => {
    const asciiJson = JSON.stringify(RESPONSE).replace(
      /[^\x20-\x7e]/g,
      (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'),
    );
    expect(asciiJson).toContain('caf\\u00e9');

    expect(streamCharByChar(asciiJson).draft).toBe(FINAL_MARKDOWN);
  });

  it('emits nothing while the model is still thinking', () => {
    const streamer = new WriterDraftStreamer();
    expect(streamer.push('<think>{"headline": "not yet"')).toBe('');
  });
});

describe('endsMidEscape', () => {
  it.each([
    ['a lone backslash', '"C:\\', true],
    ['a partial unicode escape', '"caf\\u00', true],
    ['a complete escaped backslash', '"C:\\\\', false],
    ['a complete unicode escape', '"caf\\u00e9', false],
    ['plain text', '"plain', false],
  ])('%s', (_label, json, expected) => {
    expect(endsMidEscape(json)).toBe(expected);
  });
});

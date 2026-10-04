import { ConfigService } from '@nestjs/config';
import { MistralProvider, withJsonMode, JSON_OBJECT_FORMAT } from './mistral.provider';

// Jest can't load the ESM @langchain/mistralai build (CLAUDE.md pitfall 9). This stand-in
// mirrors upstream's invocationParams(), which maps `response_format` → `responseFormat`.
jest.mock('@langchain/mistralai', () => ({
  ChatMistralAI: class {
    constructor(readonly fields: unknown) {}
    invocationParams(options?: { response_format?: unknown }) {
      return { responseFormat: options?.response_format };
    }
  },
}));

function provider(): MistralProvider {
  return new MistralProvider({
    get: jest.fn((key: string) => (key === 'MISTRAL_API_KEY' ? 'test-key' : undefined)),
  } as unknown as ConfigService);
}

type WithParams = { invocationParams(options?: unknown): { responseFormat?: unknown } };

describe('MistralProvider JSON mode', () => {
  it('sends response_format json_object on every call when json is requested', () => {
    const model = provider().getModel({ json: true }) as unknown as WithParams;
    expect(model.invocationParams({}).responseFormat).toEqual(JSON_OBJECT_FORMAT);
    expect(model.invocationParams(undefined).responseFormat).toEqual(JSON_OBJECT_FORMAT);
  });

  it('leaves the response format unset for free-form models', () => {
    const model = provider().getModel() as unknown as WithParams;
    expect(model.invocationParams({}).responseFormat).toBeUndefined();
  });

  it('caches JSON and free-form models separately', () => {
    const p = provider();
    expect(p.getModel({ json: true })).toBe(p.getModel({ json: true }));
    expect(p.getModel({ json: true })).not.toBe(p.getModel());
  });
});

describe('withJsonMode', () => {
  it('adds json_object without dropping other call options', () => {
    expect(withJsonMode({ tool_choice: 'auto' })).toEqual({
      tool_choice: 'auto',
      response_format: JSON_OBJECT_FORMAT,
    });
  });

  it('keeps a response_format the call chose explicitly', () => {
    const options = { response_format: { type: 'text' as const } };
    expect(withJsonMode(options)).toBe(options);
  });
});

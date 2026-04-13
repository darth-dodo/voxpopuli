import { HumanMessage, SystemMessage, AIMessage } from '@langchain/core/messages';
import type { BaseMessage } from '@langchain/core/messages';
import { invokeWithRetry, isTpmError } from './invoke-with-retry';

// ---------------------------------------------------------------------------
// Mock model
// ---------------------------------------------------------------------------

function mockModel(responses: Array<AIMessage | Error>) {
  let callIdx = 0;
  const calls: BaseMessage[][] = [];

  const model = {
    invoke: jest.fn(async (messages: BaseMessage[]) => {
      calls.push([...messages]);
      const response = responses[callIdx++];
      if (response instanceof Error) throw response;
      return response;
    }),
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { model: model as any, calls };
}

// ---------------------------------------------------------------------------
// isTpmError
// ---------------------------------------------------------------------------

describe('isTpmError', () => {
  it('should detect Groq TPM rate-limit error message', () => {
    const err = new Error(
      'Request too large for model `qwen/qwen3-32b` in organization `org_01` ' +
        'service tier `on_demand` on tokens per minute (TPM): Limit 6000, Requested 7656',
    );
    expect(isTpmError(err)).toBe(true);
  });

  it('should detect rate_limit_exceeded with TPM context', () => {
    const err = new Error(
      '413 {"error":{"message":"rate_limit_exceeded on tokens per minute (TPM)","type":"tokens","code":"rate_limit_exceeded"}}',
    );
    expect(isTpmError(err)).toBe(true);
  });

  it('should not match generic errors', () => {
    expect(isTpmError(new Error('Network timeout'))).toBe(false);
  });

  it('should not match non-Error values', () => {
    expect(isTpmError('rate_limit_exceeded tokens per minute')).toBe(false);
    expect(isTpmError(null)).toBe(false);
  });

  it('should not match request-per-minute rate limits', () => {
    const err = new Error('rate_limit_exceeded on requests per minute');
    expect(isTpmError(err)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// invokeWithRetry
// ---------------------------------------------------------------------------

describe('invokeWithRetry', () => {
  const systemMsg = new SystemMessage('You are a helpful assistant.');
  const longContent = 'x'.repeat(10_000);
  const humanMsg = new HumanMessage(longContent);

  it('should return the response on success without retrying', async () => {
    const expected = new AIMessage('ok');
    const { model, calls } = mockModel([expected]);

    const result = await invokeWithRetry(model, [systemMsg, humanMsg]);

    expect(result).toBe(expected);
    expect(calls).toHaveLength(1);
  });

  it('should rethrow non-TPM errors without retrying', async () => {
    const { model } = mockModel([new Error('Something else broke')]);

    await expect(invokeWithRetry(model, [systemMsg, humanMsg])).rejects.toThrow(
      'Something else broke',
    );
    expect(model.invoke).toHaveBeenCalledTimes(1);
  });

  it('should retry with truncated content on TPM error', async () => {
    const tpmError = new Error(
      'Request too large for model `qwen/qwen3-32b` on tokens per minute (TPM): Limit 6000',
    );
    const expected = new AIMessage('ok after truncation');
    const { model, calls } = mockModel([tpmError, expected]);

    const result = await invokeWithRetry(model, [systemMsg, humanMsg]);

    expect(result).toBe(expected);
    expect(calls).toHaveLength(2);

    // The second call should have a truncated human message (50% of 10k = 5k)
    const retryHuman = calls[1][1];
    expect(typeof retryHuman.content).toBe('string');
    expect((retryHuman.content as string).length).toBe(5_000);
  });

  it('should truncate the longest message, not the system prompt', async () => {
    const shortHuman = new HumanMessage('short query');
    const longHuman = new HumanMessage('y'.repeat(20_000));
    const messages = [systemMsg, shortHuman, longHuman];

    const tpmError = new Error(
      'Request too large for model on tokens per minute (TPM): Limit 6000',
    );
    const expected = new AIMessage('ok');
    const { model, calls } = mockModel([tpmError, expected]);

    await invokeWithRetry(model, messages);

    // The third message (index 2) should be truncated, not the first or second
    const retryMessages = calls[1];
    expect((retryMessages[1].content as string).length).toBe('short query'.length);
    expect((retryMessages[2].content as string).length).toBe(10_000);
  });

  it('should propagate the error if retry also fails', async () => {
    const tpmError1 = new Error(
      'Request too large on tokens per minute (TPM): Limit 6000, Requested 7656',
    );
    const tpmError2 = new Error(
      'Request too large on tokens per minute (TPM): Limit 6000, Requested 6500',
    );
    const { model } = mockModel([tpmError1, tpmError2]);

    await expect(invokeWithRetry(model, [systemMsg, humanMsg])).rejects.toThrow(
      'Limit 6000, Requested 6500',
    );
    expect(model.invoke).toHaveBeenCalledTimes(2);
  });

  it('should pass options through to both invoke calls', async () => {
    const tpmError = new Error('Request too large on tokens per minute (TPM): Limit 6000');
    const expected = new AIMessage('ok');
    const { model } = mockModel([tpmError, expected]);

    const options = { metadata: { stage: 'test' }, tags: ['test'] };
    await invokeWithRetry(model, [systemMsg, humanMsg], options);

    expect(model.invoke).toHaveBeenNthCalledWith(1, expect.any(Array), options);
    expect(model.invoke).toHaveBeenNthCalledWith(2, expect.any(Array), options);
  });
});

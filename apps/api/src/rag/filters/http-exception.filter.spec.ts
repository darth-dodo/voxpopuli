import { ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';
import { HttpExceptionFilter } from './http-exception.filter';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Creates a mock ArgumentsHost that captures the response sent by the filter. */
function mockHost(method = 'GET', url = '/api/test') {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const response = { status, json };
  const request = { method, url };

  const host = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ArgumentsHost;

  return { host, status, json, request };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('HttpExceptionFilter', () => {
  let filter: HttpExceptionFilter;

  beforeEach(() => {
    filter = new HttpExceptionFilter();
  });

  it('should return the status and message from an HttpException', () => {
    const { host, status, json } = mockHost();
    const exception = new HttpException('Not Found', HttpStatus.NOT_FOUND);

    filter.catch(exception, host);

    expect(status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: HttpStatus.NOT_FOUND,
        message: 'Not Found',
        error: 'Not Found',
      }),
    );
  });

  it('should return 400 for a BadRequestException-style HttpException', () => {
    const { host, status, json } = mockHost();
    const exception = new HttpException('Validation failed', HttpStatus.BAD_REQUEST);

    filter.catch(exception, host);

    expect(status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: HttpStatus.BAD_REQUEST,
        message: 'Validation failed',
        error: 'Bad Request',
      }),
    );
  });

  it('should return 500 for unknown errors', () => {
    const { host, status, json } = mockHost();
    const exception = new Error('Something broke');

    filter.catch(exception, host);

    expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Something broke',
        error: 'Internal Server Error',
      }),
    );
  });

  it('should return 500 for non-Error thrown values', () => {
    const { host, status, json } = mockHost();

    filter.catch('string exception', host);

    expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Internal Server Error',
      }),
    );
  });

  it('should include a timestamp in ISO format', () => {
    const { host, json } = mockHost();
    const exception = new HttpException('test', HttpStatus.BAD_REQUEST);

    filter.catch(exception, host);

    const body = json.mock.calls[0][0] as Record<string, unknown>;
    expect(body.timestamp).toBeDefined();
    expect(typeof body.timestamp).toBe('string');
    // Verify it parses as a valid ISO date
    expect(new Date(body.timestamp as string).toISOString()).toBe(body.timestamp);
  });

  it('should have the correct error body structure', () => {
    const { host, json } = mockHost();
    const exception = new HttpException('test', HttpStatus.FORBIDDEN);

    filter.catch(exception, host);

    const body = json.mock.calls[0][0] as Record<string, unknown>;
    expect(body).toHaveProperty('statusCode');
    expect(body).toHaveProperty('message');
    expect(body).toHaveProperty('error');
    expect(body).toHaveProperty('timestamp');
    // No extra keys
    expect(Object.keys(body).sort()).toEqual(
      ['error', 'message', 'statusCode', 'timestamp'].sort(),
    );
  });

  it('should return 429 for ThrottlerException-like errors', () => {
    const { host, status, json } = mockHost();
    const exception = new Error('Too Many Requests');
    (exception as Error & { name: string }).name = 'ThrottlerException';

    filter.catch(exception, host);

    expect(status).toHaveBeenCalledWith(HttpStatus.TOO_MANY_REQUESTS);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        error: 'Too Many Requests',
      }),
    );
  });

  it('should return 429 for rate limit errors by message', () => {
    const { host, status } = mockHost();
    const exception = new Error('rate limit exceeded');

    filter.catch(exception, host);

    expect(status).toHaveBeenCalledWith(HttpStatus.TOO_MANY_REQUESTS);
  });

  it('should return 502 for upstream API errors', () => {
    const { host, status, json } = mockHost();
    const exception = new Error('upstream service timeout');

    filter.catch(exception, host);

    expect(status).toHaveBeenCalledWith(HttpStatus.BAD_GATEWAY);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: HttpStatus.BAD_GATEWAY,
        error: 'Bad Gateway',
      }),
    );
  });

  it('should return 502 for errors mentioning API failures', () => {
    const { host, status } = mockHost();
    const exception = new Error('External API returned 503');

    filter.catch(exception, host);

    expect(status).toHaveBeenCalledWith(HttpStatus.BAD_GATEWAY);
  });
});

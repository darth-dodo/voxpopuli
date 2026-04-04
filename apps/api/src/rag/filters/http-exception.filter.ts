import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

/**
 * Global exception filter that catches all exceptions and returns a
 * structured JSON error response. Maps known exception types to
 * appropriate HTTP status codes and logs errors with request context.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  /**
   * Handles an exception thrown during request processing.
   *
   * Status code mapping:
   * - `HttpException` subclasses → their own status code
   * - `ThrottlerException` / rate-limit errors → 429
   * - Messages containing "upstream" or "API" → 502
   * - Everything else → 500
   *
   * @param exception - The thrown exception
   * @param host - NestJS arguments host providing access to request/response
   */
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();

    const { status, message } = this.resolveStatusAndMessage(exception);
    const errorLabel = this.getErrorLabel(status);

    const body = {
      statusCode: status,
      message,
      error: errorLabel,
      timestamp: new Date().toISOString(),
    };

    const logContext = `${request.method} ${request.url} ${status}`;

    if (status >= 500) {
      this.logger.error(
        `${logContext} — ${message}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    } else {
      this.logger.warn(`${logContext} — ${message}`);
    }

    response.status(status).json(body);
  }

  /**
   * Resolves the HTTP status code and human-readable message from an exception.
   */
  private resolveStatusAndMessage(exception: unknown): {
    status: number;
    message: string;
  } {
    // Known NestJS HttpException (includes BadRequestException, etc.)
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const exceptionResponse = exception.getResponse();
      const message =
        typeof exceptionResponse === 'string'
          ? exceptionResponse
          : (exceptionResponse as Record<string, unknown>)['message']?.toString() ??
            exception.message;
      return { status, message };
    }

    // ThrottlerException or rate-limit errors (may come from @nestjs/throttler
    // which throws a plain Error in some configurations)
    if (this.isRateLimitError(exception)) {
      return {
        status: HttpStatus.TOO_MANY_REQUESTS,
        message: exception instanceof Error ? exception.message : 'Too Many Requests',
      };
    }

    // Upstream / external API failures
    if (exception instanceof Error && this.isUpstreamError(exception.message)) {
      return {
        status: HttpStatus.BAD_GATEWAY,
        message: exception.message,
      };
    }

    // Fallback: generic internal server error
    const message = exception instanceof Error ? exception.message : 'Internal Server Error';
    return { status: HttpStatus.INTERNAL_SERVER_ERROR, message };
  }

  /**
   * Checks whether the exception originates from a rate limiter.
   */
  private isRateLimitError(exception: unknown): boolean {
    if (!exception || typeof exception !== 'object') return false;
    const name = (exception as Record<string, unknown>)['name'];
    const message = (exception as Record<string, unknown>)['message'];
    return (
      name === 'ThrottlerException' ||
      (typeof message === 'string' && message.toLowerCase().includes('rate limit'))
    );
  }

  /**
   * Checks whether an error message indicates an upstream API failure.
   */
  private isUpstreamError(message: string): boolean {
    const lower = message.toLowerCase();
    return lower.includes('upstream') || lower.includes('api');
  }

  /**
   * Returns a standard error label for a given HTTP status code.
   */
  private getErrorLabel(status: number): string {
    const labels: Record<number, string> = {
      [HttpStatus.BAD_REQUEST]: 'Bad Request',
      [HttpStatus.UNAUTHORIZED]: 'Unauthorized',
      [HttpStatus.FORBIDDEN]: 'Forbidden',
      [HttpStatus.NOT_FOUND]: 'Not Found',
      [HttpStatus.TOO_MANY_REQUESTS]: 'Too Many Requests',
      [HttpStatus.BAD_GATEWAY]: 'Bad Gateway',
      [HttpStatus.INTERNAL_SERVER_ERROR]: 'Internal Server Error',
    };
    return labels[status] ?? 'Error';
  }
}

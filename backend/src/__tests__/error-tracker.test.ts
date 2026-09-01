import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';

const mockLogger = {
  info: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  warn: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  debug: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  error: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
};

jest.mock('../lib/logger.js', () => ({ logger: mockLogger }));
jest.mock('../config/env.js', () => ({
  getEnv: () => ({ SENTRY_DSN: undefined }),
  loadEnv: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
}));

import { captureException, setErrorSink } from '../lib/error-tracker.js';

describe('Error-tracking seam (S0-3 observability baseline)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setErrorSink(null);
  });

  afterEach(() => {
    setErrorSink(null);
  });

  it('routes a captured error to the default logger sink on the error_tracking channel', () => {
    captureException(new Error('boom'), { request_id: 'req_1', source: 'error_handler' });

    expect(mockLogger.error).toHaveBeenCalledTimes(1);
    const [, meta] = mockLogger.error.mock.calls[0] as [string, Record<string, unknown>];
    expect(meta.channel).toBe('error_tracking');
    expect(meta.message).toBe('boom');
    expect(meta.request_id).toBe('req_1');
    expect(meta.source).toBe('error_handler');
  });

  it('normalizes non-Error values into an Error', () => {
    captureException('string failure');

    const [, meta] = mockLogger.error.mock.calls[0] as [string, Record<string, unknown>];
    expect(meta.message).toBe('string failure');
  });

  it('forwards to a custom sink instead of the logger when one is installed', () => {
    const sink = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;
    setErrorSink(sink);

    captureException(new Error('routed'), { source: 'test' });

    expect(sink).toHaveBeenCalledTimes(1);
    expect(mockLogger.error).not.toHaveBeenCalled();
    const errArg = sink.mock.calls[0][0] as Error;
    const ctxArg = sink.mock.calls[0][1] as Record<string, unknown>;
    expect(errArg.message).toBe('routed');
    expect(ctxArg.source).toBe('test');
  });

  it('never throws even when the sink throws', () => {
    setErrorSink(() => {
      throw new Error('sink failure');
    });

    expect(() => captureException(new Error('original'))).not.toThrow();
  });
});

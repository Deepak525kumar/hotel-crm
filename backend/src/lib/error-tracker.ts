import { getEnv } from '../config/env.js';
import { logger } from './logger.js';

/**
 * Error-tracking seam for the observability baseline (EPIC-PLATFORM, S0-3).
 *
 * This is a dependency-free capture point for unexpected/unhandled errors.
 * It normalizes an error into a structured event and emits it on a dedicated
 * `error_tracking` channel so a log drain — or a future Sentry transport wired
 * via SENTRY_DSN — can surface it without the rest of the codebase knowing how
 * errors are shipped. Application (expected) errors are NOT captured here; only
 * unexpected failures (uncaught exceptions, unhandled rejections, and 5xx-class
 * server faults) are, to keep the signal actionable.
 */

export interface ErrorContext {
  request_id?: string;
  source?: string;
  [key: string]: unknown;
}

export type ErrorSink = (event: {
  name: string;
  message: string;
  stack?: string;
  context: ErrorContext;
}) => void;

let sink: ErrorSink | null = null;

/**
 * Install a custom transport (e.g. a Sentry client) for captured errors.
 * Replaces any previously installed sink. Passing null restores the default
 * logger-based behavior.
 */
export function setErrorSink(customSink: ErrorSink | null): void {
  sink = customSink;
}

/**
 * Capture an unexpected error. Never throws: a failure inside the tracker must
 * not mask the original error or take down the caller (error handler, process
 * hook). Falls back to the structured logger when no external sink is installed.
 */
export function captureException(error: unknown, context: ErrorContext = {}): void {
  try {
    const err = error instanceof Error ? error : new Error(String(error));
    const event = {
      name: err.name,
      message: err.message,
      stack: err.stack,
      context,
    };

    if (sink) {
      sink(event);
      return;
    }

    // Default sink: emit on a dedicated structured channel. When SENTRY_DSN is
    // configured but no transport has been installed, flag it once per event so
    // the wiring gap is visible in logs rather than silently dropping reports.
    let sentryConfigured = false;
    try {
      sentryConfigured = Boolean(getEnv().SENTRY_DSN);
    } catch {
      // Environment not loaded (e.g. very early startup) — treat as unconfigured.
    }

    logger.error('Captured exception', {
      channel: 'error_tracking',
      name: event.name,
      message: event.message,
      stack: event.stack,
      sentry_configured: sentryConfigured,
      ...context,
    });
  } catch {
    // Last-resort: the tracker itself failed. Do nothing further — swallowing is
    // deliberate so observability never becomes a source of outages.
  }
}

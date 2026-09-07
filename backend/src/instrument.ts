import { loadEnv, getEnv } from './config/env.js';
import * as Sentry from '@sentry/node';
import { setErrorSink } from './lib/error-tracker.js';

// Load environment first so SENTRY_DSN is available
loadEnv();
const env = getEnv();

if (env.SENTRY_DSN) {
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    tracesSampleRate: env.NODE_ENV === 'production' ? 0.1 : 1.0,
  });

  // Wire up the custom error tracker sink directly to Sentry
  setErrorSink((error, context) => {
    Sentry.withScope((scope) => {
      scope.setExtras(context);
      // Pass the raw error object so Sentry preserves its stack trace!
      Sentry.captureException(error);
    });
  });
}

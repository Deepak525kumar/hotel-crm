import express, { Express } from 'express';
import cookieParser from 'cookie-parser';
import { getEnv } from './config/env.js';
import { requestLoggerMiddleware } from './middleware/requestLogger.js';
// import { authMiddleware } from './middleware/auth.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { logger } from './lib/logger.js';
import * as Sentry from '@sentry/node';
import v1Router from './routes/v1/index.js';

export function createApp(): Express {
  const app = express();
  const env = getEnv();

  // Middleware
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  // Security #4 (2026-08-09): parses the httpOnly auth cookies the web
  // frontend now sends (lib/cookies.ts) -- must run before any route that
  // calls authMiddleware/optionalAuthMiddleware, both of which read
  // req.cookies as a fallback to the Authorization header.
  app.use(cookieParser());

  // Request logging
  app.use(requestLoggerMiddleware);

  // CORS (basic setup)
  //
  // Access-Control-Allow-Credentials stays required even with the frontend's
  // same-origin Next.js rewrite proxy in front (2026-08-09): the proxy makes
  // the BROWSER same-origin, but the actual HTTP request Express sees still
  // arrives cross-origin (proxy host -> this host) with cookies attached, and
  // both mobile apps' direct (non-proxied) calls need these headers too.
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', env.CORS_ORIGIN);
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Request-Id');
    res.header('Access-Control-Allow-Credentials', 'true');

    if (req.method === 'OPTIONS') {
      res.sendStatus(200);
      return;
    }

    next();
  });

  // Health check endpoint (public)
  app.get('/health', (req, res) => {
    res.json({
      status: 'success',
      data: {
        message: 'Server is healthy',
        timestamp: new Date().toISOString(),
      },
      meta: {
        timestamp: new Date().toISOString(),
        request_id: req.requestId,
      },
    });
  });

  // API routes
  app.use(`/api/${env.API_VERSION}`, v1Router);

  // 404 handler
  app.use(notFoundHandler);

  // Sentry error handler MUST be before any other error middleware
  // and after all controllers/routes
  Sentry.setupExpressErrorHandler(app);

  // Error handler (must be last)
  app.use(errorHandler);

  logger.info('Express app created', {
    NODE_ENV: env.NODE_ENV,
    PORT: env.PORT,
    API_VERSION: env.API_VERSION,
  });

  return app;
}

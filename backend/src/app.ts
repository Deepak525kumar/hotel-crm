import express, { Express } from 'express';
import { getEnv } from './config/env.js';
import { requestLoggerMiddleware } from './middleware/requestLogger.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { logger } from './lib/logger.js';
import v1Router from './routes/v1/index.js';

export function createApp(): Express {
  const app = express();
  const env = getEnv();

  // Middleware
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Request logging
  app.use(requestLoggerMiddleware);

  // CORS (basic setup)
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

  // Error handler (must be last)
  app.use(errorHandler);

  logger.info('Express app created', {
    NODE_ENV: env.NODE_ENV,
    PORT: env.PORT,
    API_VERSION: env.API_VERSION,
  });

  return app;
}

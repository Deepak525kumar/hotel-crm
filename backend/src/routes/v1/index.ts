import { Router } from 'express';
import { optionalAuthMiddleware } from '../../middleware/auth.js';
import { checkReadiness } from '../../lib/health.js';
import { HTTP_STATUS } from '../../config/constants.js';
import { isEmploymentRecordEnabled } from '../../config/feature-flags.js';

import authRoutes from '../../modules/auth/routes.js';
import userRoutes from '../../modules/users/routes.js';
import crmRoutes from '../../modules/crm/routes.js';
import workRequestRoutes from '../../modules/job-requests/routes.js';
import assignmentRoutes from '../../modules/assignments/routes.js';
import attendanceRoutes from '../../modules/attendance/routes.js';
import qualityRoutes from '../../modules/quality/routes.js';
import hrRoutes from '../../modules/hr/routes.js';
import notificationRoutes from '../../modules/notifications/routes.js';
import analyticsRoutes from '../../modules/analytics/routes.js';
import calendarRoutes from '../../modules/calendar/routes.js';
import documentRoutes from '../../modules/documents/routes.js';
import geoRoutes from '../../modules/geo/routes.js';
import employeeManagementRoutes from '../../modules/employee-management/routes.js';

const router = Router();

router.use(optionalAuthMiddleware);

router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/crm', crmRoutes);
router.use('/work-requests', workRequestRoutes);
router.use('/assignments', assignmentRoutes);
router.use('/attendance', attendanceRoutes);
router.use('/quality', qualityRoutes);
router.use('/hr', hrRoutes);
router.use('/notifications', notificationRoutes);
router.use('/analytics', analyticsRoutes);
router.use('/calendar', calendarRoutes);
router.use('/documents', documentRoutes);
router.use('/geo', geoRoutes);

// Employee-management routes (Epic 5 PR 5.6, SPEC-EMP-001) — gated by
// FEATURE_EMPLOYMENT_RECORD (default OFF). While disabled, requests fall
// through to the 404 handler at the bottom of the middleware chain, matching
// the "both-off = current behavior" posture (ADR-024 D3).
router.use('/employees', (req, res, next) => {
  if (!isEmploymentRecordEnabled()) {
    next();
    return;
  }
  employeeManagementRoutes(req, res, next);
});

// Liveness endpoint used by deploy scripts and GitHub Actions health checks:
// answers "is the process up" without touching dependencies.
router.get('/health', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() });
});

// Readiness endpoint: verifies critical dependencies (database) are reachable so
// an orchestrator can withhold traffic from a running-but-not-serving process.
// Returns 503 when any dependency is down.
router.get('/health/ready', async (_req, res, next) => {
  try {
    const report = await checkReadiness();
    const statusCode =
      report.status === 'ready' ? HTTP_STATUS.OK : HTTP_STATUS.SERVICE_UNAVAILABLE;
    res.status(statusCode).json({ ...report, timestamp: new Date().toISOString() });
  } catch (error) {
    next(error);
  }
});

router.get('/status', (req, res) => {
  res.json({
    status: 'success',
    data: {
      message: 'Hotel CRM API v1 is running',
      version: '0.1.0',
      modules: ['auth', 'users', 'crm', 'work-requests', 'assignments', 'attendance', 'hr', 'calendar', 'documents', 'geo', 'notifications', 'analytics', 'quality', 'employee-management'],
      environment: process.env.NODE_ENV || 'development',
    },
    meta: {
      timestamp: new Date().toISOString(),
      request_id: req.requestId || 'unknown',
    },
  });
});

export default router;

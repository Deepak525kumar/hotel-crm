import { Router } from 'express';
import { optionalAuthMiddleware } from '../../middleware/auth.js';
import { consentGateMiddleware } from '../../middleware/consentGate.js';
import { checkReadiness } from '../../lib/health.js';
import { HTTP_STATUS } from '../../config/constants.js';
import { isChatbotEnabled, isEmploymentRecordEnabled } from '../../config/feature-flags.js';

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
import roomRoutes from '../../modules/rooms/routes.js';
import geoRoutes from '../../modules/geo/routes.js';
import consentRoutes from '../../modules/consent/routes.js';
import retentionRoutes from '../../modules/retention/routes.js';
import complianceRoutes from '../../modules/compliance/routes.js';
import employeeManagementRoutes from '../../modules/employee-management/routes.js';
import chatbotRoutes from '../../modules/chatbot/routes.js';

const router = Router();

router.use(optionalAuthMiddleware);

// RULE-CONSENT-01 daily access gate. Mounted here, before every module, so a
// newly added module is gated by default rather than by remembering to opt
// in. No-op unless FEATURE_CONSENT_GATE is on. Runs before each module's own
// authMiddleware, and passes through when identity is unresolved, so a 401
// still wins over a 403 for a revoked or expired token.
router.use(consentGateMiddleware);

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
// Worker room logging + the checker's room picker (2026-09-01). Mounted
// unconditionally: additive, and the worker's room tab is the only way rooms
// get logged at all.
router.use('/rooms', roomRoutes);
router.use('/geo', geoRoutes);
router.use('/consent', consentRoutes);
router.use('/retention', retentionRoutes);
router.use('/compliance', complianceRoutes);

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

// Chatbot routes (SPEC-CHATBOT-001, ADR-013/ADR-053) — gated by
// FEATURE_CHATBOT (default OFF), same shape as the employment-record gate
// above. While disabled, requests fall through to the 404 handler
// ("both-off = current behavior").
//
// Scaffold stage: no LLM provider is wired. What is mounted here is the tool
// executor's authorization boundary plus one self-scoped read-only tool,
// exercisable with zero AI calls.
router.use('/chatbot', (req, res, next) => {
  if (!isChatbotEnabled()) {
    next();
    return;
  }
  chatbotRoutes(req, res, next);
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
      modules: ['auth', 'users', 'crm', 'work-requests', 'assignments', 'attendance', 'hr', 'calendar', 'documents', 'geo', 'consent', 'retention', 'compliance', 'notifications', 'analytics', 'quality', 'employee-management'],
      // Document Templates / Document Instances module removed 2026-08-13:
      // superseded by the HR Contract feature's mandatory
      // full-time/part-time employment type and its own default-contract
      // download flow (hr/service.ts createContract()).
      environment: process.env.NODE_ENV || 'development',
    },
    meta: {
      timestamp: new Date().toISOString(),
      request_id: req.requestId || 'unknown',
    },
  });
});

export default router;

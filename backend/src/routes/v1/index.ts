import { Router } from 'express';
import { optionalAuthMiddleware } from '../../middleware/auth.js';

import authRoutes from '../../modules/auth/routes.js';
import userRoutes from '../../modules/users/routes.js';
import crmRoutes from '../../modules/crm/routes.js';
import hotelWorkerRoutes from '../../modules/hotel-workers/routes.js';
import workRequestRoutes from '../../modules/work-requests/routes.js';
import workApplicationRoutes from '../../modules/work-applications/routes.js';
import assignmentRoutes from '../../modules/assignments/routes.js';
import attendanceRoutes from '../../modules/attendance/routes.js';
import qualityVerificationRoutes from '../../modules/quality-verifications/routes.js';
import ratingRoutes from '../../modules/ratings/routes.js';
import leaderboardRoutes from '../../modules/leaderboard/routes.js';
import hrRoutes from '../../modules/hr/routes.js';
import notificationRoutes from '../../modules/notifications/routes.js';
import analyticsRoutes from '../../modules/analytics/routes.js';
import calendarRoutes from '../../modules/calendar/routes.js';

const router = Router();

router.use(optionalAuthMiddleware);

router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/crm', crmRoutes);
router.use('/crm/hotels/:hotel_id/workers', hotelWorkerRoutes);
router.use('/work-requests', workRequestRoutes);
router.use('/work-requests/:id/applications', workApplicationRoutes);
router.use('/assignments', assignmentRoutes);
router.use('/attendance', attendanceRoutes);
router.use('/quality-verifications', qualityVerificationRoutes);
router.use('/ratings', ratingRoutes);
router.use('/leaderboard', leaderboardRoutes);
router.use('/hr', hrRoutes);
router.use('/notifications', notificationRoutes);
router.use('/analytics', analyticsRoutes);
router.use('/calendar', calendarRoutes);

router.get('/status', (req, res) => {
  res.json({
    status: 'success',
    data: {
      message: 'Hotel CRM API v1 is running',
      version: '0.1.0',
      modules: ['auth', 'users', 'crm', 'hotel-workers', 'work-requests', 'work-applications', 'assignments', 'attendance', 'quality-verifications', 'ratings', 'leaderboard', 'hr', 'calendar', 'notifications', 'analytics'],
      environment: process.env.NODE_ENV || 'development',
    },
    meta: {
      timestamp: new Date().toISOString(),
      request_id: req.requestId || 'unknown',
    },
  });
});

export default router;

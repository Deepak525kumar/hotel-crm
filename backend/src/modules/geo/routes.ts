// SPEC-GEO-001 @0.1.2 FROZEN (GD-14 Decided 2026-07-27).
// GD-14: self-checkin (worker) only for writes; admin sees everything;
// manager sees only hotels within their own scope claim (mirrors
// AttendanceService's identical manager-scope pattern). No new permission
// tokens are introduced -- role gating alone matches GD-14's confirmed
// actor model, the same choice already made for GD-16/Documents.

import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.js';
import { geoController } from './controller.js';

const router = Router();
router.use(authMiddleware);

// REQ-CAL-T02/T03-equivalent: self-scoped, any authenticated role -- a
// worker checks themself in; self-scope is itself the authorization
// (actor_id is always req.auth.userId, never a client-supplied field,
// enforced in controller.ts/service.ts).
router.post('/checkins', (req, res, next) => geoController.checkIn(req, res, next));

// OD-GEO-005: admin/manager list/view -- distance/pass-fail only, never raw
// coordinates (enforced in service.ts's DTO mapping). A worker's own
// checkins are also reachable through the same routes (self-scoped in
// service.ts), matching AttendanceService.list()/getById()'s identical
// any-authenticated-role-but-self-scoped-unless-admin/manager pattern.
router.get('/checkins', (req, res, next) => geoController.listCheckins(req, res, next));
router.get('/checkins/:checkin_id', (req, res, next) => geoController.getCheckin(req, res, next));

export default router;

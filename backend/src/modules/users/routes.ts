import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { userController } from './controller.js';
import { authController } from '../auth/controller.js';
import { authMiddleware } from '../../middleware/auth.js';
import { requireRole, requirePermission } from '../../middleware/permissions.js';
import { ALLOWED_PHOTO_MIME_TYPES, MAX_PHOTO_SIZE_BYTES } from './photo.js';
import { ValidationError } from '../../lib/errors.js';

// Mirrors documents/routes.ts's own upload wiring: memory storage only (the
// buffer goes straight to StorageClient.upload(), never to local disk),
// fileFilter rejects a disallowed MIME type before the upload completes.
const uploadPhoto = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_PHOTO_SIZE_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!(ALLOWED_PHOTO_MIME_TYPES as readonly string[]).includes(file.mimetype)) {
      cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', 'photo'));
      return;
    }
    cb(null, true);
  },
});

// Same translation documents/routes.ts's handleUploadErrors() performs: a
// rejected upload (oversize, wrong MIME type, wrong field name) reaches the
// client as a 422 ValidationError, not the generic handler's 500 fallback.
function handleUploadErrors() {
  return (err: unknown, _req: Request, _res: Response, next: NextFunction) => {
    if (err instanceof multer.MulterError) {
      const message =
        err.code === 'LIMIT_FILE_SIZE'
          ? `Photo exceeds the maximum size of ${MAX_PHOTO_SIZE_BYTES} bytes`
          : err.code === 'LIMIT_UNEXPECTED_FILE'
            ? 'Unsupported photo type or unexpected field'
            : err.message;
      next(new ValidationError(message));
      return;
    }
    next(err);
  };
}

const router = Router();

router.use(authMiddleware);

router.get('/', requirePermission('users:read'), ...userController.listUsers);
// D-4's `users:write` grant to MANAGER/REGIONAL_MANAGER covers the *profile*
// route below only — D-4 explicitly carves account creation out as
// Admin-only, permanently, not just "until M-2 runs." This role gate is
// deliberately NOT flag-gated (security review SEC-01): flag-gating it like
// D-3's hotel-writes narrowing would make the Admin-only invariant depend on
// FEATURE_GD02_MATRIX staying on forever. Since M-2's backfill (a DB write)
// is not undone by flipping the flag back off, a manager whose stored
// permissions already include `users:write` would regain account-creation
// access the moment an operator disabled the flag as a rollback — the exact
// privilege-escalation-on-rollback path this hard-coded `requireRole('admin')`
// closes. `requirePermission('users:write')` below is defense-in-depth only,
// not the actual boundary.
// RULE A (project-owner decision, 2026-08-12): account creation is now
// 1-level-down for three roles rather than Admin-only, so the gate admits
// admin/manager/regional_manager and `userService.createUser` decides WHICH
// role each may mint (lib/role-hierarchy.ts, canCreateRole).
//
// This narrows more than it widens. Previously admin could create ANY role
// including another admin; now `admin` is creatable by nobody. What it does
// widen is who may reach the route at all — and the SEC-01 concern the
// previous comment recorded (a manager holding `users:write` regaining account
// creation if FEATURE_GD02_MATRIX were rolled back) is now handled by
// canCreateRole rather than by the role literal: that check is NOT
// flag-gated, so a manager reaching this route can only ever mint
// worker/checker regardless of flag state, and can never reach admin or
// regional_manager. Rolling the flag back can no longer produce escalation
// here, which is what made the hard-coded `requireRole('admin')` necessary.
//
// Conflicts with ADR-030 D-4's "account creation is Admin-only, permanently"
// (tracked in SIR-USERS-002). The owner ratified RULE A knowing an amendment
// is owed; see lib/role-hierarchy.ts's governance note.
router.post(
  '/',
  requireRole(['admin', 'manager', 'regional_manager']),
  requirePermission('users:write'),
  uploadPhoto.single('photo'),
  handleUploadErrors(),
  ...userController.createUser
);
router.get('/:user_id', requirePermission('users:read'), (req, res, next) => userController.getUser(req, res, next));
// Stable, user-id-keyed URL (never a presigned one) so the browser and
// expo-image can cache the photo by URL -- see controller.ts's
// getUserPhoto for why. Same `users:read` gate as the profile route above:
// visibility is identical by design (if you can view the profile, you can
// view its photo), enforced inside userService.getUserPhoto by delegating
// to getUser()'s own scope check rather than a second one here.
router.get('/:user_id/photo', requirePermission('users:read'), (req, res, next) => userController.getUserPhoto(req, res, next));
// ADR-030 D-4/D-4a: the profile-only route. 'regional_manager' added per D-5
// parity with manager — unreachable today (FEATURE_RM_ROLE is off, no live
// RM user exists), harmless to include now.
router.put('/:user_id', requireRole(['admin', 'manager', 'regional_manager']), requirePermission('users:write'), ...userController.updateUser);
// ADR-030 D-4a: the dedicated, Admin-only role-assignment endpoint. Mounted
// unconditionally — see controller.ts's updateUserRole for why this is safe
// before FEATURE_GD02_MATRIX flips (no legacy caller exists for this route).
router.put('/:user_id/role', requireRole(['admin', 'regional_manager']), ...userController.updateUserRole);
// Email is the login identifier, so changing it is a separate, more tightly
// scoped operation than the rest of the profile: Admin and Regional Manager
// only, never a hotel-scoped manager. Kept off PUT /users/:id for the same
// reason as /role -- see UpdateUserEmailSchema.
router.put('/:user_id/email', requireRole(['admin', 'regional_manager']), requirePermission('users:write'), ...userController.updateUserEmail);
// ADR-031 D-4 (PR-4): Admin-only "revoke all sessions" incident-response
// action — bumps token_generation without touching Session rows (logout's
// job, deliberately unchanged). Delegates to authController since
// token_generation is backend-auth-owned state (ADR-017).
router.post('/:user_id/revoke-sessions', requireRole('admin'), (req, res, next) => authController.revokeAllSessions(req, res, next));
router.delete('/:user_id', requireRole('admin'), (req, res, next) => userController.deleteUser(req, res, next));

export default router;

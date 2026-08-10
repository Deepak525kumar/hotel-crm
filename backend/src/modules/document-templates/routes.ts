import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { authMiddleware } from '../../middleware/auth.js';
import { requirePermission, requireRole } from '../../middleware/permissions.js';
import { documentTemplatesController } from './controller.js';
import { ValidationError } from '../../lib/errors.js';

// Signature images are always small drawn PNGs (canvas .toDataURL()) --
// reuses the documents module's existing MIME/size policy (10 MB, includes
// image/png) rather than declaring a second one for what is structurally
// the same "upload a file" concern.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype !== 'image/png') {
      cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', 'file'));
      return;
    }
    cb(null, true);
  },
});

function handleUploadErrors() {
  return (err: unknown, _req: Request, _res: Response, next: NextFunction) => {
    if (err instanceof multer.MulterError) {
      const message =
        err.code === 'LIMIT_FILE_SIZE'
          ? 'Signature image exceeds the maximum size of 10 MB'
          : err.code === 'LIMIT_UNEXPECTED_FILE'
            ? 'Signature image must be image/png'
            : err.message;
      next(new ValidationError(message));
      return;
    }
    next(err);
  };
}

// Document Templates module (2026-08-09). Role-conditional wrappers below
// (requireInstanceReadAccess, requireInstanceFillAccess,
// requireInstanceSignAccess) exist because requirePermission()'s array form
// is an AND check (middleware/permissions.ts) -- it cannot express "token A
// for role X, token B for role Y" on one route. Same reference pattern as
// hr/routes.ts's requireContractReadAccess()/requirePayslipReadAccess().
//
// No proxy-fill (product decision, 2026-08-09): a worker fills/signs only
// their own (SUBJECT-role) fields/signatures; a manager/admin fills/signs
// only their own COUNTERSIGNER-role blocks. Neither acts on the other's
// behalf. This split is enforced in the SERVICE layer (per-block
// signer_role check), not by these route-level tokens alone -- the tokens
// gate "may this actor reach this class of route at all," the service
// enforces "may THIS actor touch THIS specific field/block."

// @requiresPermission document_instance:read document_instance:read-own
function requireInstanceReadAccess() {
  return (req: Request, res: Response, next: NextFunction) => {
    const requiredToken = req.auth?.role === 'worker' ? 'document_instance:read-own' : 'document_instance:read';
    requirePermission(requiredToken)(req, res, next);
  };
}

// @requiresPermission document_templates:read (or document_instance:read-own for workers)
function requireTemplateReadAccess() {
  return (req: Request, res: Response, next: NextFunction) => {
    const requiredToken = req.auth?.role === 'worker' ? 'document_instance:read-own' : 'document_templates:read';
    requirePermission(requiredToken)(req, res, next);
  };
}

// @requiresPermission document_instance:write document_instance:fill-own
function requireInstanceFillAccess() {
  return (req: Request, res: Response, next: NextFunction) => {
    const requiredToken = req.auth?.role === 'worker' ? 'document_instance:fill-own' : 'document_instance:write';
    requirePermission(requiredToken)(req, res, next);
  };
}

// @requiresPermission document_instance:write document_instance:sign-own
function requireInstanceSignAccess() {
  return (req: Request, res: Response, next: NextFunction) => {
    const requiredToken = req.auth?.role === 'worker' ? 'document_instance:sign-own' : 'document_instance:write';
    requirePermission(requiredToken)(req, res, next);
  };
}

const documentTemplateRoutes = Router();
const documentInstanceRoutes = Router();

documentTemplateRoutes.use(authMiddleware);
documentInstanceRoutes.use(authMiddleware);

// -- Templates (admin-authored; manager/RM read-only) -----------------------

documentTemplateRoutes.post(
  '/',
  requireRole('admin'),
  requirePermission('document_templates:write'),
  (req, res, next) => documentTemplatesController.createTemplate(req, res, next)
);
documentTemplateRoutes.get(
  '/',
  requireRole(['admin', 'manager', 'regional_manager']),
  requirePermission('document_templates:read'),
  (req, res, next) => documentTemplatesController.listTemplates(req, res, next)
);
documentTemplateRoutes.get(
  '/:id',
  requireRole(['admin', 'manager', 'regional_manager', 'worker']),
  requireTemplateReadAccess(),
  (req, res, next) => documentTemplatesController.getTemplate(req, res, next)
);
documentTemplateRoutes.patch(
  '/:id',
  requireRole('admin'),
  requirePermission('document_templates:write'),
  (req, res, next) => documentTemplatesController.updateTemplate(req, res, next)
);
documentTemplateRoutes.post(
  '/:id/sections',
  requireRole('admin'),
  requirePermission('document_templates:write'),
  (req, res, next) => documentTemplatesController.addSection(req, res, next)
);
documentTemplateRoutes.patch(
  '/:id/sections/:sid',
  requireRole('admin'),
  requirePermission('document_templates:write'),
  (req, res, next) => documentTemplatesController.updateSection(req, res, next)
);
documentTemplateRoutes.post(
  '/:id/sections/:sid/fields',
  requireRole('admin'),
  requirePermission('document_templates:write'),
  (req, res, next) => documentTemplatesController.addField(req, res, next)
);
documentTemplateRoutes.patch(
  '/:id/sections/:sid/fields/:fid',
  requireRole('admin'),
  requirePermission('document_templates:write'),
  (req, res, next) => documentTemplatesController.updateField(req, res, next)
);
documentTemplateRoutes.post(
  '/:id/sections/:sid/signature-blocks',
  requireRole('admin'),
  requirePermission('document_templates:write'),
  (req, res, next) => documentTemplatesController.addSignatureBlock(req, res, next)
);
documentTemplateRoutes.post(
  '/:id/publish',
  requireRole('admin'),
  requirePermission('document_templates:write'),
  (req, res, next) => documentTemplatesController.publishTemplate(req, res, next)
);
documentTemplateRoutes.post(
  '/:id/archive',
  requireRole('admin'),
  requirePermission('document_templates:write'),
  (req, res, next) => documentTemplatesController.archiveTemplate(req, res, next)
);

// -- Instances (fill / sign) -------------------------------------------------
// Every route is keyed by instance_id, not worker_id -- ownership/scope
// enforcement happens in the SERVICE layer (isWorkerInGroupScope /
// self-scope checks against the loaded instance's worker_id), not via
// checkWorkerScope() (which only reads a worker_id path/body param, which
// none of these routes carry).

documentInstanceRoutes.post(
  '/',
  requireRole(['admin', 'manager', 'regional_manager', 'worker']),
  requireInstanceFillAccess(),
  (req, res, next) => documentTemplatesController.createInstance(req, res, next)
);
documentInstanceRoutes.get(
  '',
  requireRole(['admin', 'manager', 'regional_manager', 'worker']),
  requireInstanceReadAccess(),
  (req, res, next) => documentTemplatesController.listInstances(req, res, next)
);
documentInstanceRoutes.get(
  '/:id',
  requireRole(['admin', 'manager', 'regional_manager', 'worker']),
  requireInstanceReadAccess(),
  (req, res, next) => documentTemplatesController.getInstance(req, res, next)
);
documentInstanceRoutes.patch(
  '/:id/fields',
  requireRole(['admin', 'manager', 'regional_manager', 'worker']),
  requireInstanceFillAccess(),
  (req, res, next) => documentTemplatesController.upsertFieldValues(req, res, next)
);
documentInstanceRoutes.get(
  '/:id/preview',
  requireRole(['admin', 'manager', 'regional_manager', 'worker']),
  requireInstanceReadAccess(),
  (req, res, next) => documentTemplatesController.previewInstance(req, res, next)
);
documentInstanceRoutes.post(
  '/:id/signature-blocks/:blockId/sign',
  requireRole(['admin', 'manager', 'regional_manager', 'worker']),
  requireInstanceSignAccess(),
  upload.single('file'),
  handleUploadErrors(),
  (req: Request, res: Response, next: NextFunction) => documentTemplatesController.signBlock(req, res, next)
);
documentInstanceRoutes.get(
  '/:id/signatures',
  requireRole(['admin', 'manager', 'regional_manager', 'worker']),
  requireInstanceReadAccess(),
  (req, res, next) => documentTemplatesController.listSignatures(req, res, next)
);
documentInstanceRoutes.post(
  '/:id/finalize',
  requireRole(['admin', 'manager', 'regional_manager', 'worker']),
  requireInstanceFillAccess(),
  (req, res, next) => documentTemplatesController.finalize(req, res, next)
);
documentInstanceRoutes.get(
  '/:id/document',
  requireRole(['admin', 'manager', 'regional_manager', 'worker']),
  requireInstanceReadAccess(),
  (req, res, next) => documentTemplatesController.getFinalDocument(req, res, next)
);

export { documentTemplateRoutes, documentInstanceRoutes };

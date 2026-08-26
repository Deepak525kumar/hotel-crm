// SPEC-DOCUMENTS-001: storage abstraction layer.
//
// OD-DOC-018: presigned URL vs. app-proxied byte stream is an open decision.
// This module uses presigned URLs (the lower-latency, lower-memory option)
// as the implementation-time default (OD-DOC-018: deferred, not silent).
//
// OD-DOC-016: malware/content scanning is explicitly deferred. This layer
// does NOT perform scanning; the deferred position is recorded, not silent.
//
// OD-DOC-017: S3 server-side encryption at rest and bucket exposure posture
// are assumed-private / SSE-S3 at minimum (the AWS S3 default for new buckets
// as of 2023). These are explicitly stated assumptions, not silent gaps.
//
// RULE-DOC-09: storage keys are generated server-side, never from client input,
// and MUST include a cryptographically-random UUIDv4 component.

import crypto from 'node:crypto';
import { logger } from '../../lib/logger.js';

// RULE-DOC-09: server-generated key with a UUIDv4 segment for unpredictability.
// Pattern: documents/{workerId}/{category}/{uuid4}/{sanitised-filename}
// The workerId prefix is for S3 "folder" organisation only — the UUID segment
// is what provides guessing-resistance (a UUID alone suffices; the prefix is
// convenience for ops, not security).
export function generateStorageKey(
  workerId: string,
  category: string,
  originalFilename: string
): string {
  const uuid = crypto.randomUUID(); // cryptographically random (UUIDv4)
  // Strip any path traversal characters from the filename (defence-in-depth).
  const safeName = originalFilename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100);
  return `documents/${workerId}/${category.toLowerCase()}/${uuid}/${safeName}`;
}

/**
 * Storage key for quality-inspection evidence (ADR-069, CRR §14/§15).
 *
 * A sibling of generateStorageKey rather than a parameter on it: the
 * `documents/` prefix is part of the Documents module's contract
 * (RULE-DOC-09), and quality photos are a different retention and access
 * class -- room evidence, not worker identity documents.
 *
 * Pattern: quality/{assignmentId}/{kind}/{uuid4}/{sanitised-filename}
 */
export function generateQualityPhotoKey(
  assignmentId: string,
  // 'rating' added 2026-08-24: the checklist-based Rating model's own CRR §15
  // photo evidence, distinct from 'inspection' (QualityVerification) and
  // 'rework' (the worker's rework-completion photo).
  kind: 'inspection' | 'rework' | 'rating',
  originalFilename: string
): string {
  const uuid = crypto.randomUUID();
  const safeName = originalFilename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100);
  return `quality/${assignmentId}/${kind}/${uuid}/${safeName}`;
}

// Presigned URL TTL: 15 minutes. Documents are retrieved on-demand; a short
// TTL limits the exposure window if a URL leaks from a trusted caller.
const PRESIGNED_URL_TTL_SECONDS = 15 * 60;

// OD-DOC-010: S3 failure/retry policy is deferred (no retry backoff here).
// A thrown StorageError surfaces as a 500 to the caller.
export class StorageError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'StorageError';
  }
}

export interface StorageClient {
  /**
   * Upload a file to S3 (EU) and return the storage key.
   * RULE-DOC-05: storage is EU-region only.
   */
  upload(key: string, body: Buffer, mimeType: string): Promise<void>;

  /**
   * Generate a short-lived presigned GET URL for a stored object.
   * OD-DOC-018: presigned-URL retrieval mechanism (implementation-time default).
   * Returns null when no bucket is configured (test/CI environments).
   */
  getPresignedUrl(key: string): Promise<string | null>;

  /**
   * Delete a stored object (used by rollback/cleanup paths).
   */
  delete(key: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Concrete AWS S3 client (wired when S3_BUCKET is configured in env).
// Uses the AWS SDK v3 (modular): @aws-sdk/client-s3 + @aws-sdk/s3-request-presigner
// (real package.json dependencies as of PR #248).
// OD-DOC-017: bucket is assumed private, no-public-ACL.
// REQ-DOC-007/REQ-DOC-008: AWS_REGION defaults to eu-central-1 (env.ts:42).
// Credentials: AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY are read implicitly by
// the SDK's default credential provider chain when set (env.ts:47-48); when
// unset, the SDK falls back to the EC2 instance role, per that same comment.
// ---------------------------------------------------------------------------

// Lazy import: only resolved when getStorageClient() is called and a bucket
// is configured, so test environments (no real S3_BUCKET) never touch the SDK.
let _s3ClientPromise: Promise<StorageClient> | null = null;

async function buildS3Client(bucket: string, region: string): Promise<StorageClient> {
  // Dynamic import keeps the cold-start cost on the module-evaluation path zero
  // for envs that don't use S3 (unit tests, CI without a real bucket).
  const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = await import(
    '@aws-sdk/client-s3'
  );
  const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');

  const client = new S3Client({ region });

  return {
    async upload(key: string, body: Buffer, mimeType: string): Promise<void> {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: body,
          ContentType: mimeType,
          // OD-DOC-017: SSE-S3 encryption at rest (AWS S3 default since 2023;
          // explicitly set here so the intent is machine-readable).
          ServerSideEncryption: 'AES256',
        })
      );
    },

    async getPresignedUrl(key: string): Promise<string | null> {
      const command = new GetObjectCommand({ Bucket: bucket, Key: key });
      return getSignedUrl(client, command, { expiresIn: PRESIGNED_URL_TTL_SECONDS });
    },

    async delete(key: string): Promise<void> {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
  };
}

// Stub client used when S3_BUCKET is not configured (test / local-only envs).
// OD-DOC-016: malware scanning position — explicitly deferred, recorded here.
const stubStorageClient: StorageClient = {
  async upload(_key, _body, _mimeType): Promise<void> {
    logger.warn('documents_storage_stub: S3_BUCKET not configured; upload is a no-op', { _key });
  },
  async getPresignedUrl(_key): Promise<string | null> {
    logger.warn('documents_storage_stub: S3_BUCKET not configured; presigned URL unavailable');
    return null;
  },
  async delete(_key): Promise<void> {
    logger.warn('documents_storage_stub: S3_BUCKET not configured; delete is a no-op');
  },
};

/**
 * Whether the active client is the no-op stub.
 *
 * Exported for the readiness probe: a stub in a deployed environment means
 * every document upload silently stores nothing while answering 200, and the
 * probe is the only place that can say so out loud. Identity comparison rather
 * than a flag on the interface, so the real client cannot accidentally claim
 * to be a stub or vice versa.
 */
export function isStubStorage(client: StorageClient): boolean {
  return client === stubStorageClient;
}

/**
 * Returns the active StorageClient for this process.
 * Uses the real S3 client when S3_BUCKET is set; falls back to the stub.
 * Lazy-initialises once per process to amortise SDK load cost.
 */
export async function getStorageClient(): Promise<StorageClient> {
  const bucket = process.env['S3_BUCKET'];
  const region = process.env['AWS_REGION'] ?? 'eu-central-1';

  if (!bucket) {
    // Development/test only. config/env.ts already refuses to START when
    // NODE_ENV is production or staging and S3_BUCKET is unset, precisely
    // because this stub's upload() logs a warning and returns -- the caller
    // would still commit storage keys and still answer 200 while the bytes
    // were never written. That guard is the real protection; this branch is
    // only reached in environments where stub storage is intended.
    return stubStorageClient;
  }

  if (!_s3ClientPromise) {
    _s3ClientPromise = buildS3Client(bucket, region).catch((err) => {
      _s3ClientPromise = null; // reset so next call retries
      throw err;
    });
  }

  return _s3ClientPromise;
}

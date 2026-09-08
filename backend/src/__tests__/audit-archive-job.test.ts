import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { gzipSync, gunzipSync } from 'node:zlib';

/**
 * Archiving the audit log.
 *
 * `ADR-033` requires `AuditLog` retained INDEFINITELY — it is the platform's
 * accountability record, and deleting it on the same clock as the data it
 * describes would defeat its purpose. The table therefore only grows, which
 * `platform-table-sweep-job.ts` records as a real and unsolved problem whose
 * solution "must not destroy the record".
 *
 * Every test here is about the one way this job could destroy the record: by
 * deleting rows that were not actually archived. Getting that wrong is
 * unrecoverable and silent, so it is tested from every direction that could
 * produce it.
 */

const findMany = jest.fn() as jest.MockedFunction<(...a: any[]) => any>;
const deleteMany = jest.fn() as jest.MockedFunction<(...a: any[]) => any>;
const upload = jest.fn() as jest.MockedFunction<(...a: any[]) => any>;
const download = jest.fn() as jest.MockedFunction<(...a: any[]) => any>;
const del = jest.fn() as jest.MockedFunction<(...a: any[]) => any>;

jest.mock('../modules/documents/storage.js', () => ({
  getStorageClient: async () => ({ upload, download, delete: del }),
}));
jest.mock('../lib/logger.js', () => ({
  logger: {
    info: jest.fn() as jest.MockedFunction<(...a: unknown[]) => unknown>,
    warn: jest.fn() as jest.MockedFunction<(...a: unknown[]) => unknown>,
    debug: jest.fn() as jest.MockedFunction<(...a: unknown[]) => unknown>,
    error: jest.fn() as jest.MockedFunction<(...a: unknown[]) => unknown>,
  },
}));

import { AuditArchiveJob, archiveKey } from '../modules/retention/audit-archive-job.js';

const CONFIG = {
  intervalMs: 86_400_000,
  archiveAfterDays: 730,
  batchSize: 2,
  maxBatchesPerRun: 3,
};

const prisma = () => ({ auditLog: { findMany, deleteMany } }) as never;

const row = (id: string) => ({
  id,
  actor_id: 'u1',
  action: 'UPDATE',
  resource_type: 'ASSIGNMENT',
  resource_id: 'a1',
  timestamp: new Date('2024-01-15T10:00:00.000Z'),
});

/** Storage that actually stores, so the probe round-trips. */
function workingStorage() {
  const store = new Map<string, Buffer>();
  upload.mockImplementation(async (key: string, body: Buffer) => {
    store.set(key, body);
  });
  download.mockImplementation(async (key: string) => {
    const found = store.get(key);
    if (!found) throw new Error('not found');
    return found;
  });
  del.mockImplementation(async (key: string) => {
    store.delete(key);
  });
  return store;
}

beforeEach(() => {
  jest.clearAllMocks();
  workingStorage();
  findMany.mockResolvedValue([]);
  deleteMany.mockResolvedValue({ count: 0 });
});

/**
 * THE MOST IMPORTANT TEST IN THE FILE.
 *
 * With `S3_BUCKET` unset the storage client is a documented no-op: uploads
 * resolve and store nothing. Archiving into it and then deleting would erase
 * audit history while reporting success — the exact outcome ADR-033 exists to
 * prevent, arrived at through a job written to honour it.
 */
describe('when storage is not real', () => {
  it('refuses to archive at all rather than deleting after a no-op upload', async () => {
    // The stub's shape: upload resolves, download yields nothing useful.
    upload.mockResolvedValue(undefined);
    download.mockRejectedValue(new Error('storage is stubbed'));
    findMany.mockResolvedValue([row('a1')]);

    await new AuditArchiveJob(prisma(), CONFIG).run();

    expect(deleteMany).not.toHaveBeenCalled();
    // It does not even read the audit table -- there is nowhere safe to put it.
    expect(findMany).not.toHaveBeenCalled();
  });

  it('detects a stub that returns the wrong bytes, not just one that throws', async () => {
    upload.mockResolvedValue(undefined);
    download.mockResolvedValue(Buffer.from('something else'));
    findMany.mockResolvedValue([row('a1')]);

    await new AuditArchiveJob(prisma(), CONFIG).run();
    expect(deleteMany).not.toHaveBeenCalled();
  });
});

describe('archiving', () => {
  it('writes the rows, verifies them, and only then deletes', async () => {
    findMany.mockResolvedValueOnce([row('a1'), row('a2')]).mockResolvedValue([]);
    deleteMany.mockResolvedValue({ count: 2 });

    await new AuditArchiveJob(prisma(), CONFIG).run();

    // Order is the guarantee: the object exists and has been read back before
    // a single row leaves Postgres.
    const uploadOrder = upload.mock.invocationCallOrder[1]; // [0] is the probe
    const deleteOrder = deleteMany.mock.invocationCallOrder[0];
    expect(uploadOrder).toBeLessThan(deleteOrder);

    expect(deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['a1', 'a2'] } } });
  });

  it('stores the rows as readable gzipped JSONL', async () => {
    findMany.mockResolvedValueOnce([row('a1'), row('a2')]).mockResolvedValue([]);
    deleteMany.mockResolvedValue({ count: 2 });

    await new AuditArchiveJob(prisma(), CONFIG).run();

    const [, body] = upload.mock.calls[1] as [string, Buffer];
    const lines = gunzipSync(body).toString('utf8').split('\n');

    expect(lines).toHaveLength(2);
    // The record must still be a record: readable, and carrying what it did.
    const first = JSON.parse(lines[0]);
    expect({ id: first.id, action: first.action, resource: first.resource_type }).toEqual({
      id: 'a1',
      action: 'UPDATE',
      resource: 'ASSIGNMENT',
    });
  });

  it('deletes by explicit id, never by the date predicate', async () => {
    findMany.mockResolvedValueOnce([row('a1')]).mockResolvedValue([]);
    deleteMany.mockResolvedValue({ count: 1 });

    await new AuditArchiveJob(prisma(), CONFIG).run();

    // Deleting by the predicate would race the read and remove rows that
    // became eligible in between -- rows that were never archived.
    const where = (deleteMany.mock.calls[0][0] as { where: Record<string, unknown> }).where;
    expect(where).toEqual({ id: { in: ['a1'] } });
    expect(where).not.toHaveProperty('timestamp');
  });

  it('selects on the configured age, oldest first', async () => {
    await new AuditArchiveJob(prisma(), CONFIG).run();

    const query = findMany.mock.calls[0][0] as {
      where: { timestamp: { lt: Date } };
      orderBy: { timestamp: string };
    };
    const days = (Date.now() - query.where.timestamp.lt.getTime()) / 86_400_000;
    expect(Math.round(days)).toBe(730);
    // Oldest first: the point is to drain the tail, not skim the head.
    expect(query.orderBy).toEqual({ timestamp: 'asc' });
  });

  it('does nothing when nothing is old enough', async () => {
    findMany.mockResolvedValue([]);
    await new AuditArchiveJob(prisma(), CONFIG).run();

    // The probe upload happens; no archive object, and no deletion.
    expect(deleteMany).not.toHaveBeenCalled();
    expect(upload).toHaveBeenCalledTimes(1);
  });

  it('stops at maxBatchesPerRun rather than draining the table in one pass', async () => {
    findMany.mockResolvedValue([row('a1'), row('a2')]); // always a full page
    deleteMany.mockResolvedValue({ count: 2 });

    await new AuditArchiveJob(prisma(), CONFIG).run();
    expect(deleteMany).toHaveBeenCalledTimes(3);
  });
});

/**
 * Verification failures must leave the rows in Postgres. The safe direction
 * is always "archived twice" rather than "archived never" — a re-run costs
 * storage and loses nothing.
 */
describe('when verification fails', () => {
  it('deletes nothing when the object cannot be read back', async () => {
    findMany.mockResolvedValueOnce([row('a1')]).mockResolvedValue([]);
    // Probe succeeds, the archive object does not come back.
    let call = 0;
    download.mockImplementation(async () => {
      call += 1;
      if (call === 1) return Buffer.from('probe'); // the probe
      throw new Error('object missing');
    });

    await new AuditArchiveJob(prisma(), CONFIG).run();
    expect(deleteMany).not.toHaveBeenCalled();
  });

  it('deletes nothing when the archive holds the wrong number of rows', async () => {
    findMany.mockResolvedValueOnce([row('a1'), row('a2')]).mockResolvedValue([]);
    let call = 0;
    download.mockImplementation(async () => {
      call += 1;
      if (call === 1) return Buffer.from('probe');
      // Truncated: one row where two were written.
      return gzipSync(Buffer.from(JSON.stringify(row('a1'))));
    });

    await new AuditArchiveJob(prisma(), CONFIG).run();
    expect(deleteMany).not.toHaveBeenCalled();
  });

  it('deletes nothing when the archive is corrupt but the right length', async () => {
    findMany.mockResolvedValueOnce([row('a1')]).mockResolvedValue([]);
    let call = 0;
    download.mockImplementation(async () => {
      call += 1;
      if (call === 1) return Buffer.from('probe');
      // Right line count, unparseable content.
      return gzipSync(Buffer.from('not json at all'));
    });

    await new AuditArchiveJob(prisma(), CONFIG).run();
    expect(deleteMany).not.toHaveBeenCalled();
  });

  it('stops the run rather than continuing to the next batch', async () => {
    findMany.mockResolvedValue([row('a1'), row('a2')]);
    let call = 0;
    download.mockImplementation(async () => {
      call += 1;
      if (call === 1) return Buffer.from('probe');
      throw new Error('object missing');
    });

    await new AuditArchiveJob(prisma(), CONFIG).run();
    // One attempt, then stop. Grinding through further batches against
    // broken storage writes objects nobody can read.
    expect(upload).toHaveBeenCalledTimes(2); // probe + one archive attempt
  });
});

describe('archiveKey', () => {
  it('partitions by month, so an investigation can fetch a bounded slice', () => {
    expect(archiveKey(new Date('2024-03-15T10:20:30.000Z'), 'row1')).toMatch(
      /^audit-archive\/2024-03\//
    );
  });

  it('includes the first row id, so two batches in one second cannot collide', () => {
    const at = new Date('2024-03-15T10:20:30.000Z');
    expect(archiveKey(at, 'row1')).not.toBe(archiveKey(at, 'row2'));
  });

  it('produces a key with no characters that need escaping', () => {
    const key = archiveKey(new Date('2024-03-15T10:20:30.123Z'), 'row1');
    expect(key).not.toMatch(/[:\s]/);
    expect(key).toMatch(/\.jsonl\.gz$/);
  });
});

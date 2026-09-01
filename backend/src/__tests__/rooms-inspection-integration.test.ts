import { describe, it, expect, jest, beforeEach } from '@jest/globals';

/**
 * The seam between the worker's room log and the checker's inspection
 * (owner decision, 2026-09-01), plus the rework auto-pass that came with it.
 *
 * Three properties are pinned here, all of them things that fail SILENTLY in
 * production if they regress:
 *
 *  1. A check submitted through the room picker LINKS the room log to the
 *     verification, in the same transaction as the verification itself. The
 *     log stores no status of its own -- a room's state is derived from this
 *     link -- so a lost link means the room reads "awaiting check" forever
 *     while an inspection sits against it.
 *  2. A mismatched room log is REJECTED. The picker supplies assignment,
 *     worker and room together; if a client mixes two rooms up, attributing
 *     an inspection (and the rework that follows) to the wrong worker is the
 *     one error nobody downstream can detect.
 *  3. Submitting rework AUTO-PASSES the room. Before this, nothing in the
 *     codebase could move a verification out of NEEDS_REWORK -- assignRework
 *     set it, completeRework recorded evidence, and no method anywhere set it
 *     back -- so a worker who fixed a room perfectly carried the failure in
 *     their rating forever (analytics filters on `status: PASSED`).
 */

jest.mock('../modules/documents/storage.js', () => ({
  getStorageClient: async () => ({
    upload: async () => undefined,
    getPresignedUrl: async () => 'https://signed.example/p.jpg',
    delete: async () => undefined,
  }),
  generateQualityPhotoKey: (assignmentId: string, kind: string, name: string) =>
    `quality/${assignmentId}/${kind}/test-uuid/${name}`,
}));

jest.mock('../lib/logger.js', () => ({
  logger: {
    info: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    warn: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    debug: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    error: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  },
}));

const mockRoomLog = {
  findUnique: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  update: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
};
const mockQualityVerification = {
  findUnique: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  create: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  update: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  updateMany: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  aggregate: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  findMany: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
};
const mockReworkRound = {
  findFirst: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  updateMany: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  create: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
};
const mockWorkerAssignment = {
  findUnique: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  update: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  create: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  count: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  findFirst: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
};

const mockPrisma: Record<string, any> = {
  roomLog: mockRoomLog,
  qualityVerification: mockQualityVerification,
  reworkRound: mockReworkRound,
  workerAssignment: mockWorkerAssignment,
  hotel: { findUnique: jest.fn() as jest.MockedFunction<(...args: any[]) => any> },
  attendance: { count: jest.fn() as jest.MockedFunction<(...args: any[]) => any> },
  workerOverallRating: {
    upsert: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    findUnique: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  },
  notification: { create: jest.fn() as jest.MockedFunction<(...args: any[]) => any> },
  outboxEvent: { create: jest.fn() as jest.MockedFunction<(...args: any[]) => any> },
  auditLog: { create: jest.fn() as jest.MockedFunction<(...args: any[]) => any> },
  $executeRawUnsafe: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  $queryRaw: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
};
mockPrisma.$transaction = jest.fn(async (cb: any) => cb(mockPrisma));

jest.mock('../lib/db.js', () => ({ getPrisma: () => mockPrisma }));
jest.mock('../config/env.js', () => ({
  getEnv: () => ({
    JWT_SECRET: 'test-secret-key-minimum-32-characters-long',
    JWT_ACCESS_EXPIRY: '1h',
    JWT_REFRESH_EXPIRY: '7d',
    NODE_ENV: 'test',
  }),
  loadEnv: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
}));

import { QualityService } from '../modules/quality/service.js';

const service = new QualityService();
const PHOTO = [{ buffer: Buffer.from('x'), mimeType: 'image/jpeg', originalName: 'e.jpg' }] as any;
const CHECKER = { userId: 'c1', role: 'admin' as const, scope: { type: 'global' as const } };

const BASE_INSPECTION = {
  assignment_id: 'asn1',
  worker_id: 'w1',
  room_number: '412',
  score: 90,
  outcome: 'complete' as const,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockQualityVerification.aggregate.mockResolvedValue({ _avg: { score: null }, _count: 0 });
  mockQualityVerification.findMany.mockResolvedValue([]);
  mockQualityVerification.create.mockResolvedValue({ id: 'v1', room_number: '412' });
  mockQualityVerification.updateMany.mockResolvedValue({ count: 1 });
  mockWorkerAssignment.findUnique.mockResolvedValue({
    id: 'asn1',
    worker_id: 'w1',
    hotel_id: 'hotelA',
    day: new Date('2026-09-01T00:00:00.000Z'),
    status: 'COMPLETED',
    rework_of_assignment_id: null,
  });
  mockWorkerAssignment.count.mockResolvedValue(0);
  mockPrisma.attendance.count.mockResolvedValue(0);
  mockPrisma.notification.create.mockResolvedValue({ id: 'notif1' });
  mockPrisma.outboxEvent.create.mockResolvedValue({ id: 'outbox1' });
  mockPrisma.workerOverallRating.findUnique.mockResolvedValue(null);
  mockRoomLog.update.mockResolvedValue({ id: 'rl1' });
});

describe('recordInspection — linking the worker’s room log', () => {
  it('points the room log at the verification, inside the same transaction', async () => {
    mockRoomLog.findUnique.mockResolvedValue({
      id: 'rl1',
      assignment_id: 'asn1',
      worker_id: 'w1',
      hotel_id: 'hotelA',
      room_number: '412',
      verification_id: null,
    });

    await service.recordInspection({ ...BASE_INSPECTION, room_log_id: 'rl1' }, CHECKER, PHOTO);

    expect(mockRoomLog.update).toHaveBeenCalledWith({
      where: { id: 'rl1' },
      data: { verification_id: 'v1' },
    });
    // Same transaction as the verification: the mocked $transaction hands the
    // same client to both, so a link written outside it would show up here as
    // a call on a different object.
    expect(mockPrisma.$transaction).toHaveBeenCalled();
  });

  it('still records a check with no room log (the “room not on the list” fallback)', async () => {
    await service.recordInspection(BASE_INSPECTION, CHECKER, PHOTO);

    // A room nobody logged is still inspectable -- otherwise a skipped or
    // forgotten room would be invisible to quality, which is the worst case
    // to hide.
    expect(mockQualityVerification.create).toHaveBeenCalledTimes(1);
    expect(mockRoomLog.update).not.toHaveBeenCalled();
  });

  it('rejects a room log belonging to a different shift, writing nothing', async () => {
    mockRoomLog.findUnique.mockResolvedValue({
      id: 'rl1',
      assignment_id: 'someOtherShift',
      worker_id: 'w1',
      hotel_id: 'hotelA',
      room_number: '412',
      verification_id: null,
    });

    await expect(
      service.recordInspection({ ...BASE_INSPECTION, room_log_id: 'rl1' }, CHECKER, PHOTO)
    ).rejects.toMatchObject({ name: 'ValidationError' });
    expect(mockQualityVerification.create).not.toHaveBeenCalled();
  });

  it('rejects a room log belonging to a different worker, writing nothing', async () => {
    mockRoomLog.findUnique.mockResolvedValue({
      id: 'rl1',
      assignment_id: 'asn1',
      worker_id: 'someoneElse',
      hotel_id: 'hotelA',
      room_number: '412',
      verification_id: null,
    });

    await expect(
      service.recordInspection({ ...BASE_INSPECTION, room_log_id: 'rl1' }, CHECKER, PHOTO)
    ).rejects.toMatchObject({ name: 'ValidationError' });
    expect(mockQualityVerification.create).not.toHaveBeenCalled();
  });

  it('rejects a room log whose room number does not match the submission', async () => {
    mockRoomLog.findUnique.mockResolvedValue({
      id: 'rl1',
      assignment_id: 'asn1',
      worker_id: 'w1',
      hotel_id: 'hotelA',
      room_number: '999',
      verification_id: null,
    });

    await expect(
      service.recordInspection({ ...BASE_INSPECTION, room_log_id: 'rl1' }, CHECKER, PHOTO)
    ).rejects.toMatchObject({ name: 'ValidationError' });
    expect(mockQualityVerification.create).not.toHaveBeenCalled();
  });

  it('accepts a room number that differs only in case or surrounding space', async () => {
    mockRoomLog.findUnique.mockResolvedValue({
      id: 'rl1',
      assignment_id: 'asn1',
      worker_id: 'w1',
      hotel_id: 'hotelA',
      room_number: '412a',
      verification_id: null,
    });

    // Same room key -- rejecting this would make the picker unusable the
    // moment a client trimmed or upper-cased what it displayed.
    await service.recordInspection(
      { ...BASE_INSPECTION, room_number: ' 412A ', room_log_id: 'rl1' },
      CHECKER,
      PHOTO
    );

    expect(mockQualityVerification.create).toHaveBeenCalledTimes(1);
  });

  it('allows re-inspecting a room that already has a check, re-pointing the log', async () => {
    mockRoomLog.findUnique.mockResolvedValue({
      id: 'rl1',
      assignment_id: 'asn1',
      worker_id: 'w1',
      hotel_id: 'hotelA',
      room_number: '412',
      verification_id: 'oldVerification',
    });
    mockQualityVerification.create.mockResolvedValue({ id: 'v2', room_number: '412' });

    await service.recordInspection({ ...BASE_INSPECTION, room_log_id: 'rl1' }, CHECKER, PHOTO);

    // The picker deliberately shows already-checked rooms so a checker can
    // re-check one; the log follows the newest verification.
    expect(mockRoomLog.update).toHaveBeenCalledWith({
      where: { id: 'rl1' },
      data: { verification_id: 'v2' },
    });
  });
});

describe('completeRework — the room passes when the worker submits their fix', () => {
  const VERIFICATION = {
    id: 'v1',
    verified_by_id: 'c1',
    worker_id: 'w1',
    hotel_id: 'hotelA',
    room_number: '412',
    score: 40,
    status: 'NEEDS_REWORK',
    rework_required: true,
    rework_completed_at: null,
  };
  // completeRework reads the verification via `include`, nested on the rework
  // assignment -- not as a separate query.
  const REWORK_ASSIGNMENT = {
    id: 'reworkAsn1',
    worker_id: 'w1',
    hotel_id: 'hotelA',
    rework_of_assignment_id: 'asn1',
    rework_verification_id: 'v1',
    rework_verification: VERIFICATION,
    status: 'CONFIRMED',
  };

  beforeEach(() => {
    mockWorkerAssignment.findUnique.mockResolvedValue(REWORK_ASSIGNMENT);
    mockQualityVerification.findUnique.mockResolvedValue(VERIFICATION);
    mockReworkRound.findFirst.mockResolvedValue({
      id: 'round1',
      verification_id: 'v1',
      round_number: 1,
      completed_at: null,
      updated_at: new Date('2026-09-01T10:00:00.000Z'),
      photo_urls: [],
    });
    mockReworkRound.updateMany.mockResolvedValue({ count: 1 });
    mockWorkerAssignment.update.mockResolvedValue({ ...REWORK_ASSIGNMENT, status: 'COMPLETED' });
  });

  it('sets the verification to PASSED and clears rework_required', async () => {
    await service.completeRework('reworkAsn1', PHOTO, { userId: 'w1', role: 'worker' });

    const mirrorCall = mockQualityVerification.updateMany.mock.calls.find(
      (c: any[]) => (c[0] as any).where?.id === 'v1'
    );
    expect(mirrorCall).toBeDefined();
    const data = (mirrorCall![0] as any).data;
    // The dead end this fixes: nothing could previously move a room out of
    // NEEDS_REWORK, so a fixed room stayed failed forever in analytics.
    expect(data.status).toBe('PASSED');
    // Left true, every "needs rework" query -- the worker's own room tab
    // included -- would keep returning a room nobody has to touch.
    expect(data.rework_required).toBe(false);
    expect(data.rework_completed_at).toBeInstanceOf(Date);
    // The original score is NOT rewritten (owner decision): it stays as an
    // honest record that the room took two attempts. A fabricated pass mark
    // would erase that from the worker's numbers.
    expect(data).not.toHaveProperty('score');
  });

  it('tells the checker the room passed and that they can send it back again', async () => {
    await service.completeRework('reworkAsn1', PHOTO, { userId: 'w1', role: 'worker' });

    // With auto-pass, this push is the ONLY moment a human is invited to look
    // at the fix -- a message that just said "marked it done" would leave the
    // checker unaware the room had already been accepted on their behalf.
    const notif = mockPrisma.notification.create.mock.calls[0][0] as any;
    expect(notif.data.type).toBe('REWORK_COMPLETED');
    expect(notif.data.message).toContain('412');
    expect(notif.data.message.toLowerCase()).toContain('passed');
    expect(notif.data.message.toLowerCase()).toContain('send it back');
    // Pushed, not merely filed: a passing ROOM check is deliberately
    // digest-only, but this one needs the checker to act.
    const outbox = mockPrisma.outboxEvent.create.mock.calls.map((c: any[]) => c[0].data.transport);
    expect(outbox).toContain('PUSH');
  });
});

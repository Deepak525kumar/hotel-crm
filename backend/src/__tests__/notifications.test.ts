import { describe, it, expect, jest, beforeEach } from '@jest/globals';

const mockNotification = {
  findUnique: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  findMany: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  update: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  create: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
};

const mockOutboxEvent = {
  create: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
};

const mockPrisma = {
  notification: mockNotification,
  outboxEvent: mockOutboxEvent,
  auditLog: { create: jest.fn() as jest.MockedFunction<(...args: any[]) => any> },
  $transaction: jest.fn(async (cb: any) => cb(mockPrisma)) as jest.MockedFunction<(...args: any[]) => any>,
};

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

import { OutboxSourceModule, OutboxTransport } from '@prisma/client';
import { NotificationService } from '../modules/notifications/service.js';

const makeNotification = (overrides: Record<string, unknown> = {}) => ({
  id: 'notif1',
  user_id: 'u1',
  type: 'QUALITY_VERIFICATION_SUBMITTED',
  title: 'Test Notification',
  message: 'Test message',
  data: {},
  is_read: false,
  read_at: null,
  created_at: new Date('2026-01-01T00:00:00Z'),
  updated_at: new Date('2026-01-01T00:00:00Z'),
  ...overrides,
});

describe('NotificationService', () => {
  let service: NotificationService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new NotificationService();
  });

  describe('markAsRead', () => {
    it('throws NotFoundError when notification does not exist', async () => {
      mockNotification.findUnique.mockResolvedValue(null);
      await expect(service.markAsRead('notif1', 'u1')).rejects.toMatchObject({
        name: 'NotFoundError',
      });
    });

    it('throws ForbiddenError when caller is not the notification owner (B2)', async () => {
      mockNotification.findUnique.mockResolvedValue(makeNotification({ user_id: 'u1' }));
      await expect(service.markAsRead('notif1', 'u2')).rejects.toMatchObject({
        name: 'ForbiddenError',
      });
    });

    it('marks notification as read and returns updated record when caller is owner (B2)', async () => {
      mockNotification.findUnique.mockResolvedValue(makeNotification({ user_id: 'u1' }));
      const updated = makeNotification({ user_id: 'u1', is_read: true, read_at: new Date() });
      mockNotification.update.mockResolvedValue(updated);

      const result = await service.markAsRead('notif1', 'u1');

      expect(result.is_read).toBe(true);
      const updateArgs = mockNotification.update.mock.calls[0][0] as any;
      expect(updateArgs.where).toEqual({ id: 'notif1' });
      expect(updateArgs.data.is_read).toBe(true);
      expect(updateArgs.data.read_at).toBeInstanceOf(Date);
    });
  });

  describe('enqueue (ADR-029 GD-01: Transactional Outbox)', () => {
    const baseInput = {
      recipientId: 'u1',
      type: 'ATTENDANCE_VERIFIED',
      title: 'Attendance verified',
      message: 'Your attendance was verified',
      sourceModule: OutboxSourceModule.ATTENDANCE,
      producerService: 'AttendanceService',
    };

    beforeEach(() => {
      mockNotification.create.mockResolvedValue(makeNotification({ id: 'notif-outbox-1' }));
      mockOutboxEvent.create.mockImplementation(async (args: any) => ({
        id: 'outbox-row',
        event_id: 'generated-event-id',
        ...args.data,
      }));
    });

    it('persists the Notification and every requested OutboxEvent inside one transaction when no tx is supplied', async () => {
      await service.enqueue({ ...baseInput, transports: [OutboxTransport.EMAIL, OutboxTransport.PUSH] });

      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
      expect(mockNotification.create).toHaveBeenCalledTimes(1);
      expect(mockOutboxEvent.create).toHaveBeenCalledTimes(2);
    });

    it('creates only the Notification row (no OutboxEvent) when transports is omitted', async () => {
      const result = await service.enqueue(baseInput);

      expect(mockNotification.create).toHaveBeenCalledTimes(1);
      expect(mockOutboxEvent.create).not.toHaveBeenCalled();
      expect(result.outboxEvents).toEqual([]);
    });

    it('creates only the Notification row when transports is an empty array', async () => {
      await service.enqueue({ ...baseInput, transports: [] });

      expect(mockOutboxEvent.create).not.toHaveBeenCalled();
    });

    it('sets aggregate_id to the created Notification id and aggregate_type/event_type per ADR-029', async () => {
      await service.enqueue({ ...baseInput, transports: [OutboxTransport.EMAIL] });

      const data = mockOutboxEvent.create.mock.calls[0][0].data;
      expect(data.aggregate_id).toBe('notif-outbox-1');
      expect(data.aggregate_type).toBe('NOTIFICATION');
      expect(data.event_type).toBe('NOTIFICATION_CREATED');
    });

    it('stores an empty payload — aggregate_id is the canonical reference, not payload.notificationId', async () => {
      await service.enqueue({ ...baseInput, transports: [OutboxTransport.PUSH] });

      const data = mockOutboxEvent.create.mock.calls[0][0].data;
      expect(data.payload).toEqual({});
      expect(data.payload_version).toBe(1);
    });

    it('shares one correlation_id across every OutboxEvent row from the same enqueue() call, with distinct transports', async () => {
      await service.enqueue({ ...baseInput, transports: [OutboxTransport.EMAIL, OutboxTransport.PUSH] });

      const [emailCall, pushCall] = mockOutboxEvent.create.mock.calls as any[];
      expect(emailCall[0].data.correlation_id).toEqual(pushCall[0].data.correlation_id);
      expect(emailCall[0].data.transport).toBe('EMAIL');
      expect(pushCall[0].data.transport).toBe('PUSH');
    });

    it('persists source_module and producer_service from the input', async () => {
      await service.enqueue({ ...baseInput, transports: [OutboxTransport.EMAIL] });

      const data = mockOutboxEvent.create.mock.calls[0][0].data;
      expect(data.source_module).toBe('ATTENDANCE');
      expect(data.producer_service).toBe('AttendanceService');
    });

    it('defaults scheduled_for to now and initializes next_attempt_at to the same value', async () => {
      const before = Date.now();
      await service.enqueue({ ...baseInput, transports: [OutboxTransport.EMAIL] });
      const after = Date.now();

      const data = mockOutboxEvent.create.mock.calls[0][0].data;
      expect(data.scheduled_for).toEqual(data.next_attempt_at);
      expect(data.scheduled_for.getTime()).toBeGreaterThanOrEqual(before);
      expect(data.scheduled_for.getTime()).toBeLessThanOrEqual(after);
    });

    it('honors a caller-supplied scheduledFor for both scheduled_for and next_attempt_at', async () => {
      const scheduledFor = new Date('2026-08-01T00:00:00Z');
      await service.enqueue({ ...baseInput, transports: [OutboxTransport.EMAIL], scheduledFor });

      const data = mockOutboxEvent.create.mock.calls[0][0].data;
      expect(data.scheduled_for).toEqual(scheduledFor);
      expect(data.next_attempt_at).toEqual(scheduledFor);
    });

    it('passes hotel_id through when supplied, and null when omitted', async () => {
      await service.enqueue({ ...baseInput, hotelId: 'hotel-1' });
      expect(mockNotification.create.mock.calls[0][0].data.hotel_id).toBe('hotel-1');

      mockNotification.create.mockClear();
      await service.enqueue(baseInput);
      expect(mockNotification.create.mock.calls[0][0].data.hotel_id).toBeNull();
    });

    it('joins a caller-supplied transaction instead of opening its own', async () => {
      const mockTxNotification = {
        create: jest.fn(async () => makeNotification({ id: 'tx-notif' })) as jest.MockedFunction<
          (...args: any[]) => any
        >,
      };
      const mockTxOutboxEvent = {
        create: jest.fn(async (args: any) => ({ id: 'tx-outbox', ...args.data })) as jest.MockedFunction<
          (...args: any[]) => any
        >,
      };
      const mockTx = { notification: mockTxNotification, outboxEvent: mockTxOutboxEvent } as any;

      const result = await service.enqueue({ ...baseInput, transports: [OutboxTransport.EMAIL] }, mockTx);

      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
      expect(mockNotification.create).not.toHaveBeenCalled();
      expect(mockOutboxEvent.create).not.toHaveBeenCalled();
      expect(mockTxNotification.create).toHaveBeenCalledTimes(1);
      expect(mockTxOutboxEvent.create).toHaveBeenCalledTimes(1);
      expect(result.notification.id).toBe('tx-notif');
      expect(result.outboxEvents[0].aggregate_id).toBe('tx-notif');
    });
  });
});

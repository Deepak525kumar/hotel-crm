import { describe, it, expect, jest, beforeEach } from '@jest/globals';

const mockLogger = { warn: jest.fn(), info: jest.fn(), error: jest.fn() };
jest.mock('../lib/logger.js', () => ({ logger: mockLogger }));

import { OutboxTransport } from '@prisma/client';
import {
  EmailTransportHandler,
  LoggingNoopTransportHandler,
  resolveEmailTransportHandler,
  TransportRegistry,
} from '../modules/notifications/outbox-transport.js';

const makeEvent = (transport: OutboxTransport) =>
  ({
    id: 'row1',
    event_id: 'evt1',
    correlation_id: 'corr1',
    transport,
    aggregate_type: 'NOTIFICATION',
    aggregate_id: 'notif1',
  }) as any;

describe('TransportRegistry (ADR-029 §4)', () => {
  let registry: TransportRegistry;

  beforeEach(() => {
    jest.clearAllMocks();
    registry = new TransportRegistry();
  });

  it('registers and resolves handlers by transport', () => {
    const handler = new LoggingNoopTransportHandler(OutboxTransport.EMAIL);
    registry.register(handler);
    expect(registry.get(OutboxTransport.EMAIL)).toBe(handler);
  });

  it('returns undefined for an unregistered (reserved) transport', () => {
    registry.register(new LoggingNoopTransportHandler(OutboxTransport.EMAIL));
    expect(registry.get(OutboxTransport.WEBHOOK)).toBeUndefined();
    expect(registry.get(OutboxTransport.SMS)).toBeUndefined();
  });

  it('reports exactly the registered transports (drives the claim filter)', () => {
    registry
      .register(new LoggingNoopTransportHandler(OutboxTransport.EMAIL))
      .register(new LoggingNoopTransportHandler(OutboxTransport.PUSH));
    expect(registry.registeredTransports().sort()).toEqual(['EMAIL', 'PUSH']);
  });
});

describe('LoggingNoopTransportHandler (PR 7.2 placeholder)', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('resolves without contacting a provider and logs at WARN', async () => {
    const handler = new LoggingNoopTransportHandler(OutboxTransport.PUSH);
    await expect(handler.deliver(makeEvent(OutboxTransport.PUSH))).resolves.toBeUndefined();
    expect(mockLogger.warn).toHaveBeenCalledTimes(1);
    const meta = mockLogger.warn.mock.calls[0][1] as any;
    expect(meta.transport).toBe('PUSH');
    expect(meta.event_id).toBe('evt1');
  });
});

describe('EmailTransportHandler (Epic 7 PR 7.4, ADR-029 §4)', () => {
  const mockNotificationFindUnique = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;
  const mockPrisma = { notification: { findUnique: mockNotificationFindUnique } } as any;
  const mockProviderClient = { send: jest.fn() as jest.MockedFunction<(...args: any[]) => any> };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('is registered under the EMAIL transport', () => {
    const handler = new EmailTransportHandler(mockPrisma, mockProviderClient, 'no-reply@hotelcrm.app');
    expect(handler.transport).toBe('EMAIL');
  });

  it('resolves the Notification via aggregate_id and sends through the provider client', async () => {
    mockNotificationFindUnique.mockResolvedValue({
      id: 'notif1',
      title: 'Attendance Verified',
      message: 'Your attendance has been verified.',
      user: { email: 'worker@example.com' },
    });
    const handler = new EmailTransportHandler(mockPrisma, mockProviderClient, 'no-reply@hotelcrm.app');

    await handler.deliver(makeEvent(OutboxTransport.EMAIL));

    expect(mockNotificationFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'notif1' } })
    );
    expect(mockProviderClient.send).toHaveBeenCalledWith({
      to: 'worker@example.com',
      from: 'no-reply@hotelcrm.app',
      subject: 'Attendance Verified',
      text: 'Your attendance has been verified.',
    });
  });

  it('is a benign no-op when the referenced Notification no longer exists', async () => {
    mockNotificationFindUnique.mockResolvedValue(null);
    const handler = new EmailTransportHandler(mockPrisma, mockProviderClient, 'no-reply@hotelcrm.app');

    await expect(handler.deliver(makeEvent(OutboxTransport.EMAIL))).resolves.toBeUndefined();
    expect(mockProviderClient.send).not.toHaveBeenCalled();
  });

  it('is a benign no-op when the recipient has no email on file', async () => {
    mockNotificationFindUnique.mockResolvedValue({
      id: 'notif1',
      title: 't',
      message: 'm',
      user: { email: null },
    });
    const handler = new EmailTransportHandler(mockPrisma, mockProviderClient, 'no-reply@hotelcrm.app');

    await expect(handler.deliver(makeEvent(OutboxTransport.EMAIL))).resolves.toBeUndefined();
    expect(mockProviderClient.send).not.toHaveBeenCalled();
  });

  it('skips (does not query) an unsupported aggregate_type', async () => {
    const handler = new EmailTransportHandler(mockPrisma, mockProviderClient, 'no-reply@hotelcrm.app');
    const event = { ...makeEvent(OutboxTransport.EMAIL), aggregate_type: 'SOME_FUTURE_TYPE' };

    await expect(handler.deliver(event)).resolves.toBeUndefined();
    expect(mockNotificationFindUnique).not.toHaveBeenCalled();
    expect(mockProviderClient.send).not.toHaveBeenCalled();
  });

  it('propagates a provider send failure uncaught (so the worker records it as a delivery failure)', async () => {
    mockNotificationFindUnique.mockResolvedValue({
      id: 'notif1',
      title: 't',
      message: 'm',
      user: { email: 'worker@example.com' },
    });
    mockProviderClient.send.mockRejectedValue(new Error('provider down'));
    const handler = new EmailTransportHandler(mockPrisma, mockProviderClient, 'no-reply@hotelcrm.app');

    await expect(handler.deliver(makeEvent(OutboxTransport.EMAIL))).rejects.toThrow('provider down');
  });
});

describe('resolveEmailTransportHandler (Epic 7 PR 7.4)', () => {
  const mockPrisma = {} as any;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns a real EmailTransportHandler when EMAIL_SERVICE=sendgrid is fully configured', () => {
    const handler = resolveEmailTransportHandler(mockPrisma, {
      emailService: 'sendgrid',
      sendgridApiKey: 'sg-key',
      fromAddress: 'no-reply@hotelcrm.app',
    });
    expect(handler).toBeInstanceOf(EmailTransportHandler);
    expect(handler.transport).toBe('EMAIL');
  });

  it('returns a real EmailTransportHandler when EMAIL_SERVICE=resend is fully configured', () => {
    const handler = resolveEmailTransportHandler(mockPrisma, {
      emailService: 'resend',
      resendApiKey: 're-key',
      fromAddress: 'no-reply@hotelcrm.app',
    });
    expect(handler).toBeInstanceOf(EmailTransportHandler);
  });

  it('falls back to the no-op handler when EMAIL_SERVICE is unset', () => {
    const handler = resolveEmailTransportHandler(mockPrisma, {});
    expect(handler).toBeInstanceOf(LoggingNoopTransportHandler);
    expect(handler.transport).toBe('EMAIL');
    expect(mockLogger.warn).toHaveBeenCalled();
  });

  it('falls back to the no-op handler when the matching API key is missing', () => {
    const handler = resolveEmailTransportHandler(mockPrisma, {
      emailService: 'sendgrid',
      fromAddress: 'no-reply@hotelcrm.app',
    });
    expect(handler).toBeInstanceOf(LoggingNoopTransportHandler);
  });

  it('falls back to the no-op handler when EMAIL_FROM_ADDRESS is missing', () => {
    const handler = resolveEmailTransportHandler(mockPrisma, {
      emailService: 'sendgrid',
      sendgridApiKey: 'sg-key',
    });
    expect(handler).toBeInstanceOf(LoggingNoopTransportHandler);
  });
});

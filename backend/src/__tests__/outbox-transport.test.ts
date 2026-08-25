import { describe, it, expect, jest, beforeEach } from '@jest/globals';

const mockLogger = { warn: jest.fn(), info: jest.fn(), error: jest.fn() };
jest.mock('../lib/logger.js', () => ({ logger: mockLogger }));

import { OutboxTransport } from '@prisma/client';
import {
  EmailTransportHandler,
  LoggingNoopTransportHandler,
  PushTransportHandler,
  resolveEmailTransportHandler,
  resolvePushTransportHandler,
  TransportRegistry,
} from '../modules/notifications/outbox-transport.js';
import { InvalidTokenError } from '../modules/notifications/push-provider.js';

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

  // Review finding (2026-08-22, corrected twice): createUser()'s welcome
  // email needed the emailed text to differ from what GET /notifications and
  // the notification-detail page return to the recipient forever. The first
  // fix put the override on Notification.data -- which turned out to be
  // EQUALLY exposed (both endpoints return `data` too). The actual fix reads
  // event.payload instead: OutboxEvent is never returned by any self-service
  // endpoint, so this is genuinely private. Reads `event`, this method's own
  // argument -- no schema change, no extra query.
  it('prefers event.payload.email_text over message when present', async () => {
    mockNotificationFindUnique.mockResolvedValue({
      id: 'notif1',
      title: 'Your account has been created',
      message: 'An account has been created for you. Check your email for your login password.',
      user: { email: 'worker@example.com' },
    });
    const handler = new EmailTransportHandler(mockPrisma, mockProviderClient, 'no-reply@hotelcrm.app');
    const event = {
      ...makeEvent(OutboxTransport.EMAIL),
      payload: { email_text: 'Temporary password: hunter2\n\nLog in at https://app.test/login' },
    };

    await handler.deliver(event);

    expect(mockProviderClient.send).toHaveBeenCalledWith({
      to: 'worker@example.com',
      from: 'no-reply@hotelcrm.app',
      subject: 'Your account has been created',
      text: 'Temporary password: hunter2\n\nLog in at https://app.test/login',
    });
  });

  // Every existing producer leaves payload as `{}` (service.ts's
  // enqueueWithin default) -- this must stay purely additive, so every
  // notification type that predates emailText keeps emailing `.message`
  // unchanged.
  it('still falls back to message when payload has no email_text key', async () => {
    mockNotificationFindUnique.mockResolvedValue({
      id: 'notif1',
      title: 'Rating received',
      message: 'You received a rating of 90 out of 100.',
      user: { email: 'worker@example.com' },
    });
    const handler = new EmailTransportHandler(mockPrisma, mockProviderClient, 'no-reply@hotelcrm.app');
    const event = { ...makeEvent(OutboxTransport.EMAIL), payload: {} };

    await handler.deliver(event);

    expect(mockProviderClient.send).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'You received a rating of 90 out of 100.' })
    );
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

describe('PushTransportHandler (Epic 7 PR 7.5, ADR-029 §4)', () => {
  const mockNotificationFindUnique = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;
  const mockPushTokenFindMany = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;
  const mockPushTokenDelete = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;
  const mockPrisma = {
    notification: { findUnique: mockNotificationFindUnique },
    pushToken: { findMany: mockPushTokenFindMany, delete: mockPushTokenDelete },
  } as any;
  const mockApnsClient = { send: jest.fn() as jest.MockedFunction<(...args: any[]) => any> };
  const mockFcmClient = { send: jest.fn() as jest.MockedFunction<(...args: any[]) => any> };

  const notification = {
    id: 'notif1',
    user_id: 'user1',
    title: 'New Shift',
    message: 'You have a new shift',
    type: 'ASSIGNMENT_CONFIRMED',
  };

  // Epic 7 PR 7.8: both apps configured, matching a deployment with both bundle IDs set.
  const BOTH_TOPICS = { WORKER: 'com.hotelcrm.workerapp', CHECKER: 'com.hotelcrm.checkerapp' };

  beforeEach(() => {
    jest.clearAllMocks();
    mockNotificationFindUnique.mockResolvedValue(notification);
  });

  it('is registered under the PUSH transport', () => {
    const handler = new PushTransportHandler(mockPrisma, mockApnsClient, mockFcmClient, BOTH_TOPICS as any);
    expect(handler.transport).toBe('PUSH');
  });

  it('skips (does not query) an unsupported aggregate_type', async () => {
    const handler = new PushTransportHandler(mockPrisma, mockApnsClient, mockFcmClient, BOTH_TOPICS as any);
    const event = { ...makeEvent(OutboxTransport.PUSH), aggregate_type: 'SOME_FUTURE_TYPE' };

    await expect(handler.deliver(event)).resolves.toBeUndefined();
    expect(mockNotificationFindUnique).not.toHaveBeenCalled();
  });

  it('is a benign no-op when the referenced Notification no longer exists', async () => {
    mockNotificationFindUnique.mockResolvedValue(null);
    const handler = new PushTransportHandler(mockPrisma, mockApnsClient, mockFcmClient, BOTH_TOPICS as any);

    await expect(handler.deliver(makeEvent(OutboxTransport.PUSH))).resolves.toBeUndefined();
    expect(mockPushTokenFindMany).not.toHaveBeenCalled();
  });

  it('is a benign no-op when the recipient has no registered devices', async () => {
    mockPushTokenFindMany.mockResolvedValue([]);
    const handler = new PushTransportHandler(mockPrisma, mockApnsClient, mockFcmClient, BOTH_TOPICS as any);

    await expect(handler.deliver(makeEvent(OutboxTransport.PUSH))).resolves.toBeUndefined();
    expect(mockApnsClient.send).not.toHaveBeenCalled();
    expect(mockFcmClient.send).not.toHaveBeenCalled();
  });

  it('fans out to every registered device, routed to the platform-correct client, iOS carrying its app topic', async () => {
    mockPushTokenFindMany.mockResolvedValue([
      { id: 'pt1', token: 'ios-token', platform: 'IOS', app: 'WORKER', user_id: 'user1' },
      { id: 'pt2', token: 'android-token', platform: 'ANDROID', app: 'WORKER', user_id: 'user1' },
    ]);
    mockApnsClient.send.mockResolvedValue(undefined);
    mockFcmClient.send.mockResolvedValue(undefined);
    const handler = new PushTransportHandler(mockPrisma, mockApnsClient, mockFcmClient, BOTH_TOPICS as any);

    await handler.deliver(makeEvent(OutboxTransport.PUSH));

    expect(mockPushTokenFindMany).toHaveBeenCalledWith({ where: { user_id: 'user1' } });
    expect(mockApnsClient.send).toHaveBeenCalledWith({
      token: 'ios-token',
      title: 'New Shift',
      body: 'You have a new shift',
      topic: 'com.hotelcrm.workerapp',
      data: { type: 'ASSIGNMENT_CONFIRMED' },
    });
    // Android is untouched by PR 7.8: no topic field reaches the FCM client at all.
    expect(mockFcmClient.send).toHaveBeenCalledWith({
      token: 'android-token',
      title: 'New Shift',
      body: 'You have a new shift',
      data: { type: 'ASSIGNMENT_CONFIRMED' },
    });
  });

  describe('notification.data forwarding', () => {
    it('forwards notification.data, stringified, to both providers', async () => {
      mockNotificationFindUnique.mockResolvedValue({
        ...notification,
        data: { work_request_id: 'jr1', hotel_id: 'h1', skill: 'CLEANER' },
      });
      mockPushTokenFindMany.mockResolvedValue([
        { id: 'pt1', token: 'ios-token', platform: 'IOS', app: 'WORKER', user_id: 'user1' },
        { id: 'pt2', token: 'android-token', platform: 'ANDROID', app: 'WORKER', user_id: 'user1' },
      ]);
      mockApnsClient.send.mockResolvedValue(undefined);
      mockFcmClient.send.mockResolvedValue(undefined);
      const handler = new PushTransportHandler(mockPrisma, mockApnsClient, mockFcmClient, BOTH_TOPICS as any);

      await handler.deliver(makeEvent(OutboxTransport.PUSH));

      expect(mockApnsClient.send).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { type: 'ASSIGNMENT_CONFIRMED', work_request_id: 'jr1', hotel_id: 'h1', skill: 'CLEANER' },
        })
      );
      expect(mockFcmClient.send).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { type: 'ASSIGNMENT_CONFIRMED', work_request_id: 'jr1', hotel_id: 'h1', skill: 'CLEANER' },
        })
      );
    });

    it('stringifies a non-string primitive value (number/boolean) rather than dropping it', async () => {
      mockNotificationFindUnique.mockResolvedValue({
        ...notification,
        data: { headcount: 2, urgent: true },
      });
      mockPushTokenFindMany.mockResolvedValue([{ id: 'pt1', token: 'ios-token', platform: 'IOS', app: 'WORKER', user_id: 'user1' }]);
      mockApnsClient.send.mockResolvedValue(undefined);
      const handler = new PushTransportHandler(mockPrisma, mockApnsClient, mockFcmClient, BOTH_TOPICS as any);

      await handler.deliver(makeEvent(OutboxTransport.PUSH));

      expect(mockApnsClient.send).toHaveBeenCalledWith(
        expect.objectContaining({ data: { type: 'ASSIGNMENT_CONFIRMED', headcount: '2', urgent: 'true' } })
      );
    });

    // notification.type is always present (a required column, unlike the
    // optional Json? data column) — so `data` on the wire is never fully
    // absent even when there's nothing else to send; it degrades to
    // {type} only, not undefined.
    it('sends data: {type} only (not undefined) when notification.data is null', async () => {
      mockNotificationFindUnique.mockResolvedValue({ ...notification, data: null });
      mockPushTokenFindMany.mockResolvedValue([{ id: 'pt1', token: 'ios-token', platform: 'IOS', app: 'WORKER', user_id: 'user1' }]);
      mockApnsClient.send.mockResolvedValue(undefined);
      const handler = new PushTransportHandler(mockPrisma, mockApnsClient, mockFcmClient, BOTH_TOPICS as any);

      await handler.deliver(makeEvent(OutboxTransport.PUSH));

      const call = mockApnsClient.send.mock.calls[0][0];
      expect(call.data).toEqual({ type: 'ASSIGNMENT_CONFIRMED' });
    });

    it('sends data: {type} only when notification.data is an empty object', async () => {
      mockNotificationFindUnique.mockResolvedValue({ ...notification, data: {} });
      mockPushTokenFindMany.mockResolvedValue([{ id: 'pt1', token: 'ios-token', platform: 'IOS', app: 'WORKER', user_id: 'user1' }]);
      mockApnsClient.send.mockResolvedValue(undefined);
      const handler = new PushTransportHandler(mockPrisma, mockApnsClient, mockFcmClient, BOTH_TOPICS as any);

      await handler.deliver(makeEvent(OutboxTransport.PUSH));

      const call = mockApnsClient.send.mock.calls[0][0];
      expect(call.data).toEqual({ type: 'ASSIGNMENT_CONFIRMED' });
    });

    it('drops a nested object/array value rather than passing a non-string through', async () => {
      mockNotificationFindUnique.mockResolvedValue({
        ...notification,
        data: { work_request_id: 'jr1', nested: { oops: true }, list: [1, 2, 3] },
      });
      mockPushTokenFindMany.mockResolvedValue([{ id: 'pt1', token: 'ios-token', platform: 'IOS', app: 'WORKER', user_id: 'user1' }]);
      mockApnsClient.send.mockResolvedValue(undefined);
      const handler = new PushTransportHandler(mockPrisma, mockApnsClient, mockFcmClient, BOTH_TOPICS as any);

      await handler.deliver(makeEvent(OutboxTransport.PUSH));

      expect(mockApnsClient.send).toHaveBeenCalledWith(
        expect.objectContaining({ data: { type: 'ASSIGNMENT_CONFIRMED', work_request_id: 'jr1' } })
      );
    });
  });

  // Epic 7 PR 7.8: the core scenario this PR exists for — one user, two apps, two iOS tokens.
  it('sends the correct distinct APNs topic for each app when one user holds tokens for both', async () => {
    mockPushTokenFindMany.mockResolvedValue([
      { id: 'pt1', token: 'worker-ios-token', platform: 'IOS', app: 'WORKER', user_id: 'user1' },
      { id: 'pt2', token: 'checker-ios-token', platform: 'IOS', app: 'CHECKER', user_id: 'user1' },
    ]);
    mockApnsClient.send.mockResolvedValue(undefined);
    const handler = new PushTransportHandler(mockPrisma, mockApnsClient, mockFcmClient, BOTH_TOPICS as any);

    await handler.deliver(makeEvent(OutboxTransport.PUSH));

    expect(mockApnsClient.send).toHaveBeenCalledWith(
      expect.objectContaining({ token: 'worker-ios-token', topic: 'com.hotelcrm.workerapp' })
    );
    expect(mockApnsClient.send).toHaveBeenCalledWith(
      expect.objectContaining({ token: 'checker-ios-token', topic: 'com.hotelcrm.checkerapp' })
    );
    // Same client instance for both — one JWT cache, not one client per app.
    expect(mockApnsClient.send).toHaveBeenCalledTimes(2);
  });

  it('skips an iOS device whose app has no configured topic — not a transient failure', async () => {
    mockPushTokenFindMany.mockResolvedValue([{ id: 'pt1', token: 'ios-token', platform: 'IOS', app: 'CHECKER', user_id: 'user1' }]);
    // Only WORKER configured — mirrors a deployment missing APNS_BUNDLE_ID_CHECKER.
    const handler = new PushTransportHandler(mockPrisma, mockApnsClient, mockFcmClient, { WORKER: 'com.hotelcrm.workerapp' } as any);

    await expect(handler.deliver(makeEvent(OutboxTransport.PUSH))).resolves.toBeUndefined();
    expect(mockApnsClient.send).not.toHaveBeenCalled();
  });

  it('is considered delivered as soon as at least one device accepts, even if another fails transiently', async () => {
    mockPushTokenFindMany.mockResolvedValue([
      { id: 'pt1', token: 'ios-token', platform: 'IOS', app: 'WORKER', user_id: 'user1' },
      { id: 'pt2', token: 'android-token', platform: 'ANDROID', app: 'WORKER', user_id: 'user1' },
    ]);
    mockApnsClient.send.mockResolvedValue(undefined);
    mockFcmClient.send.mockRejectedValue(new Error('FCM outage'));
    const handler = new PushTransportHandler(mockPrisma, mockApnsClient, mockFcmClient, BOTH_TOPICS as any);

    await expect(handler.deliver(makeEvent(OutboxTransport.PUSH))).resolves.toBeUndefined();
  });

  it('throws (so the worker retries) when every device fails transiently', async () => {
    mockPushTokenFindMany.mockResolvedValue([{ id: 'pt1', token: 'ios-token', platform: 'IOS', app: 'WORKER', user_id: 'user1' }]);
    mockApnsClient.send.mockRejectedValue(new Error('APNs outage'));
    const handler = new PushTransportHandler(mockPrisma, mockApnsClient, mockFcmClient, BOTH_TOPICS as any);

    await expect(handler.deliver(makeEvent(OutboxTransport.PUSH))).rejects.toThrow(
      'PushTransportHandler: delivery failed on every registered device'
    );
  });

  it('deletes a token on InvalidTokenError and does not treat it as a transient failure', async () => {
    mockPushTokenFindMany.mockResolvedValue([{ id: 'pt1', token: 'ios-token', platform: 'IOS', app: 'WORKER', user_id: 'user1' }]);
    mockApnsClient.send.mockRejectedValue(new InvalidTokenError('APNs reported the token invalid: 410 Unregistered'));
    mockPushTokenDelete.mockResolvedValue(undefined);
    const handler = new PushTransportHandler(mockPrisma, mockApnsClient, mockFcmClient, BOTH_TOPICS as any);

    // No successes, but the only failure was permanent invalidity — nothing to retry.
    await expect(handler.deliver(makeEvent(OutboxTransport.PUSH))).resolves.toBeUndefined();
    expect(mockPushTokenDelete).toHaveBeenCalledWith({ where: { id: 'pt1' } });
  });

  it('does not let a failed token-delete block delivery or bubble up', async () => {
    mockPushTokenFindMany.mockResolvedValue([{ id: 'pt1', token: 'ios-token', platform: 'IOS', app: 'WORKER', user_id: 'user1' }]);
    mockApnsClient.send.mockRejectedValue(new InvalidTokenError('invalid'));
    mockPushTokenDelete.mockRejectedValue(new Error('row already gone'));
    const handler = new PushTransportHandler(mockPrisma, mockApnsClient, mockFcmClient, BOTH_TOPICS as any);

    await expect(handler.deliver(makeEvent(OutboxTransport.PUSH))).resolves.toBeUndefined();
  });

  it('skips (and does not fail on) a device whose platform has no configured client', async () => {
    mockPushTokenFindMany.mockResolvedValue([{ id: 'pt1', token: 'android-token', platform: 'ANDROID', app: 'WORKER', user_id: 'user1' }]);
    const handler = new PushTransportHandler(mockPrisma, mockApnsClient, undefined, BOTH_TOPICS as any);

    await expect(handler.deliver(makeEvent(OutboxTransport.PUSH))).resolves.toBeUndefined();
    expect(mockApnsClient.send).not.toHaveBeenCalled();
  });

  // Epic 7 PR 7.8: topicFor() switches on PushApp exhaustively rather than
  // doing a bare map lookup, specifically so an app value TypeScript didn't
  // anticipate is a hard failure, not a silent skip indistinguishable from
  // "deployment just isn't configured for this app yet". `as any` bypasses
  // the compile-time guard the switch normally provides, to prove the runtime
  // fallback (assertNever) actually throws rather than only being a type-level
  // promise.
  it('throws (does not silently skip) an iOS token whose app is not a recognized PushApp value', async () => {
    mockPushTokenFindMany.mockResolvedValue([
      { id: 'pt1', token: 'ios-token', platform: 'IOS', app: 'KIOSK', user_id: 'user1' },
    ]);
    const handler = new PushTransportHandler(mockPrisma, mockApnsClient, mockFcmClient, BOTH_TOPICS as any);

    await expect(handler.deliver(makeEvent(OutboxTransport.PUSH))).rejects.toThrow(/Unhandled PushApp/);
    expect(mockApnsClient.send).not.toHaveBeenCalled();
  });

  // The handler defaults to the PushToken table (every test above), but a
  // deployment with Firebase configured is handed a Firestore-backed store
  // instead (resolvePushTransportHandler). These two prove the handler reads
  // and prunes through whatever store it was given, and never reaches past it
  // into Prisma — a regression there would silently fail push for every
  // Firestore deployment while the whole suite above stayed green.
  describe('with an injected token store', () => {
    function makeStore(tokens: any[]) {
      return {
        upsert: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
        listForUser: (jest.fn() as jest.MockedFunction<(...args: any[]) => any>).mockResolvedValue(tokens),
        delete: (jest.fn() as jest.MockedFunction<(...args: any[]) => any>).mockResolvedValue(undefined),
      };
    }

    it('reads the recipient devices from the store, not from Prisma', async () => {
      const store = makeStore([{ id: 'doc1', token: 'ios-token', platform: 'IOS', app: 'WORKER' }]);
      mockApnsClient.send.mockResolvedValue(undefined);
      const handler = new PushTransportHandler(
        mockPrisma, mockApnsClient, mockFcmClient, BOTH_TOPICS as any, store as any
      );

      await expect(handler.deliver(makeEvent(OutboxTransport.PUSH))).resolves.toBeUndefined();
      expect(store.listForUser).toHaveBeenCalledWith('user1');
      expect(mockPushTokenFindMany).not.toHaveBeenCalled();
      expect(mockApnsClient.send).toHaveBeenCalledWith(expect.objectContaining({ token: 'ios-token' }));
    });

    it('prunes an invalidated token through the store, scoped to its owner', async () => {
      const store = makeStore([{ id: 'doc1', token: 'ios-token', platform: 'IOS', app: 'WORKER' }]);
      mockApnsClient.send.mockRejectedValue(new InvalidTokenError('410 Unregistered'));
      const handler = new PushTransportHandler(
        mockPrisma, mockApnsClient, mockFcmClient, BOTH_TOPICS as any, store as any
      );

      await expect(handler.deliver(makeEvent(OutboxTransport.PUSH))).resolves.toBeUndefined();
      // Owner-scoped: a Firestore token lives under users/{userId}, so a
      // delete that forgot the user id would silently prune nothing.
      expect(store.delete).toHaveBeenCalledWith('user1', 'doc1');
      expect(mockPushTokenDelete).not.toHaveBeenCalled();
    });
  });
});

describe('resolvePushTransportHandler (Epic 7 PR 7.5)', () => {
  const mockPrisma = {} as any;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns a real PushTransportHandler when APNs alone is fully configured (one app)', () => {
    const handler = resolvePushTransportHandler(mockPrisma, {
      apnsPrivateKeyBase64: 'key',
      apnsKeyId: 'kid',
      apnsTeamId: 'team',
      apnsBundleIdWorker: 'com.hotelcrm.workerapp',
    });
    expect(handler).toBeInstanceOf(PushTransportHandler);
    expect(handler.transport).toBe('PUSH');
    expect(mockLogger.warn).toHaveBeenCalled();
  });

  it('returns a real PushTransportHandler when FCM alone is fully configured', () => {
    const handler = resolvePushTransportHandler(mockPrisma, {
      firebaseProjectId: 'hotelcrm-app',
      firebaseServiceAccountKeyBase64: 'svc-key',
    });
    expect(handler).toBeInstanceOf(PushTransportHandler);
  });

  it('returns a real PushTransportHandler when both platforms are fully configured', () => {
    const handler = resolvePushTransportHandler(mockPrisma, {
      apnsPrivateKeyBase64: 'key',
      apnsKeyId: 'kid',
      apnsTeamId: 'team',
      apnsBundleIdWorker: 'com.hotelcrm.workerapp',
      apnsBundleIdChecker: 'com.hotelcrm.checkerapp',
      firebaseProjectId: 'hotelcrm-app',
      firebaseServiceAccountKeyBase64: 'svc-key',
    });
    expect(handler).toBeInstanceOf(PushTransportHandler);
  });

  it('falls back to the no-op handler when neither platform is configured', () => {
    const handler = resolvePushTransportHandler(mockPrisma, {});
    expect(handler).toBeInstanceOf(LoggingNoopTransportHandler);
    expect(handler.transport).toBe('PUSH');
  });

  it('falls back to the no-op handler when APNs key material is set but no app bundle ID is', () => {
    const handler = resolvePushTransportHandler(mockPrisma, { apnsPrivateKeyBase64: 'key', apnsKeyId: 'kid', apnsTeamId: 'team' });
    expect(handler).toBeInstanceOf(LoggingNoopTransportHandler);
  });

  it('falls back to the no-op handler when APNs is only partially configured (missing team id) and FCM is unset', () => {
    const handler = resolvePushTransportHandler(mockPrisma, {
      apnsPrivateKeyBase64: 'key',
      apnsKeyId: 'kid',
      apnsBundleIdWorker: 'com.hotelcrm.workerapp',
    });
    expect(handler).toBeInstanceOf(LoggingNoopTransportHandler);
  });

  // Epic 7 PR 7.8: per-app configuration, not all-or-nothing across the two apps.
  it('configures only the worker-app topic when only APNS_BUNDLE_ID_WORKER is set, and constructs one APNs client', () => {
    const handler = resolvePushTransportHandler(mockPrisma, {
      apnsPrivateKeyBase64: 'key',
      apnsKeyId: 'kid',
      apnsTeamId: 'team',
      apnsBundleIdWorker: 'com.hotelcrm.workerapp',
      // apnsBundleIdChecker intentionally unset
    }) as any;
    expect(handler).toBeInstanceOf(PushTransportHandler);
    expect(handler['apnsTopics']).toEqual({ WORKER: 'com.hotelcrm.workerapp' });
    // One client instance for the whole handler, not one per app.
    expect(handler['apnsClient']).toBeDefined();
  });

  it('configures both app topics on one shared APNs client when both bundle IDs are set', () => {
    const handler = resolvePushTransportHandler(mockPrisma, {
      apnsPrivateKeyBase64: 'key',
      apnsKeyId: 'kid',
      apnsTeamId: 'team',
      apnsBundleIdWorker: 'com.hotelcrm.workerapp',
      apnsBundleIdChecker: 'com.hotelcrm.checkerapp',
    }) as any;
    expect(handler['apnsTopics']).toEqual({
      WORKER: 'com.hotelcrm.workerapp',
      CHECKER: 'com.hotelcrm.checkerapp',
    });
  });
});

import { describe, it, expect, jest, beforeEach } from '@jest/globals';

const mockLogger = { warn: jest.fn(), info: jest.fn(), error: jest.fn() };
jest.mock('../lib/logger.js', () => ({ logger: mockLogger }));

import { OutboxTransport } from '@prisma/client';
import {
  LoggingNoopTransportHandler,
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

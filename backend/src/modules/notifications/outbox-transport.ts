import { OutboxEvent, OutboxTransport } from '@prisma/client';
import { logger } from '../../lib/logger.js';

/**
 * A transport handler delivers one claimed OutboxEvent over a specific medium
 * (EMAIL, PUSH, ...). ADR-029 §7: handlers MUST be idempotent — the worker
 * guarantees at-least-once, so a handler may be invoked more than once for the
 * same `event_id` (after a crash mid-delivery, or a reclaimed stale row). Use
 * `event.event_id` as the provider-side idempotency key where the provider
 * supports one.
 *
 * A handler signals success by returning normally and failure by throwing. The
 * worker owns all status/retry bookkeeping; a handler never touches the row.
 */
export interface TransportHandler {
  readonly transport: OutboxTransport;
  deliver(event: OutboxEvent): Promise<void>;
}

/**
 * Registry mapping a transport to its handler. A transport with no registered
 * handler is left unclaimed and its rows rest untouched (ADR-029 §4: reserved
 * transports are not an error) — the worker only claims rows whose transport is
 * registered here.
 */
export class TransportRegistry {
  private readonly handlers = new Map<OutboxTransport, TransportHandler>();

  register(handler: TransportHandler): this {
    this.handlers.set(handler.transport, handler);
    return this;
  }

  get(transport: OutboxTransport): TransportHandler | undefined {
    return this.handlers.get(transport);
  }

  registeredTransports(): OutboxTransport[] {
    return [...this.handlers.keys()];
  }
}

/**
 * PR 7.2 placeholder handler: logs the intended delivery and returns success,
 * without contacting any provider. It stands in for the real EMAIL/PUSH handlers
 * that land in PR 7.4/7.5, letting the full claim → dispatch → DELIVERED
 * lifecycle be exercised now. It is idempotent by construction (it does nothing
 * external). Logged at WARN so its placeholder nature is unmistakable — a row it
 * "delivers" is marked DELIVERED without anything actually being sent, which is
 * only acceptable until a real handler replaces it for that transport.
 */
export class LoggingNoopTransportHandler implements TransportHandler {
  constructor(public readonly transport: OutboxTransport) {}

  async deliver(event: OutboxEvent): Promise<void> {
    logger.warn('Platform Worker: no-op transport handler (no real delivery performed)', {
      transport: this.transport,
      event_id: event.event_id,
      correlation_id: event.correlation_id,
      aggregate_type: event.aggregate_type,
      aggregate_id: event.aggregate_id,
    });
  }
}

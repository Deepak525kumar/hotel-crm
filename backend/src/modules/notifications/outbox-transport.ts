import { OutboxAggregateType, OutboxEvent, OutboxTransport, PrismaClient } from '@prisma/client';
import { logger } from '../../lib/logger.js';
import {
  EmailProviderClient,
  ResendProviderClient,
  SendgridProviderClient,
} from './email-provider.js';

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
 * without contacting any provider. Originally stood in for both EMAIL and
 * PUSH; EMAIL now has a real handler (EmailTransportHandler, PR 7.4) — this
 * remains PUSH's handler (PR 7.5) and the fallback worker.ts registers for
 * EMAIL when no provider is configured. It is idempotent by construction (it
 * does nothing external). Logged at WARN so its placeholder nature is
 * unmistakable — a row it "delivers" is marked DELIVERED without anything
 * actually being sent, which is only acceptable until a real handler
 * replaces it for that transport.
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

/**
 * EMAIL transport handler (Epic 7 PR 7.4, ADR-029 §4). Depends only on
 * `EmailProviderClient` — every provider-specific detail (endpoint, auth,
 * payload shape) lives in the provider client, never here.
 *
 * Resolves the notification content by reading the sibling `Notification`
 * row via `event.aggregate_id` (ADR-029 §9: the outbox payload carries no
 * duplicated content — aggregate_id is the canonical reference) and the
 * recipient's email via that row's `User` relation. Both lookups are
 * benign-no-op on miss, not a failure: a `Notification`/`User` can be
 * legitimately gone by delivery time (e.g. account deletion cascades), and
 * that is not a reason to retry or dead-letter this event.
 */
export class EmailTransportHandler implements TransportHandler {
  readonly transport = OutboxTransport.EMAIL;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly providerClient: EmailProviderClient,
    private readonly fromAddress: string
  ) {}

  async deliver(event: OutboxEvent): Promise<void> {
    if (event.aggregate_type !== OutboxAggregateType.NOTIFICATION) {
      // No other aggregate type exists yet (ADR-029 §9); defensive guard
      // against a future aggregate type reaching this handler unexpectedly.
      logger.warn('EmailTransportHandler: unsupported aggregate_type, skipping', {
        event_id: event.event_id,
        aggregate_type: event.aggregate_type,
      });
      return;
    }

    const notification = await this.prisma.notification.findUnique({
      where: { id: event.aggregate_id },
      include: { user: { select: { email: true } } },
    });

    if (!notification) {
      logger.info('EmailTransportHandler: referenced Notification no longer exists, skipping', {
        event_id: event.event_id,
        aggregate_id: event.aggregate_id,
      });
      return;
    }

    if (!notification.user.email) {
      logger.info('EmailTransportHandler: recipient has no email on file, skipping', {
        event_id: event.event_id,
        aggregate_id: event.aggregate_id,
      });
      return;
    }

    await this.providerClient.send({
      to: notification.user.email,
      from: this.fromAddress,
      subject: notification.title,
      text: notification.message,
    });
  }
}

/**
 * Selects the EMAIL handler worker.ts registers: a real `EmailTransportHandler`
 * once `EMAIL_SERVICE`, its matching API key, and `EMAIL_FROM_ADDRESS` are all
 * configured; otherwise the same no-op fallback PR 7.2 always registered (so
 * an unconfigured environment — dev, CI, a fresh deploy — behaves exactly as
 * it did before this PR, never crashes at startup). Kept here (not inline in
 * worker.ts) so this selection logic is independently unit-testable.
 */
export function resolveEmailTransportHandler(
  prisma: PrismaClient,
  config: {
    emailService?: 'sendgrid' | 'resend';
    sendgridApiKey?: string;
    resendApiKey?: string;
    fromAddress?: string;
  }
): TransportHandler {
  const { emailService, sendgridApiKey, resendApiKey, fromAddress } = config;

  if (emailService === 'sendgrid' && sendgridApiKey && fromAddress) {
    return new EmailTransportHandler(prisma, new SendgridProviderClient(sendgridApiKey), fromAddress);
  }
  if (emailService === 'resend' && resendApiKey && fromAddress) {
    return new EmailTransportHandler(prisma, new ResendProviderClient(resendApiKey), fromAddress);
  }

  logger.warn(
    'EMAIL transport not fully configured (EMAIL_SERVICE / matching API key / EMAIL_FROM_ADDRESS) — falling back to the no-op handler',
    { email_service: emailService ?? null }
  );
  return new LoggingNoopTransportHandler(OutboxTransport.EMAIL);
}

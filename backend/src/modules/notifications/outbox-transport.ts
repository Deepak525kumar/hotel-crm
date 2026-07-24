import { OutboxAggregateType, OutboxEvent, OutboxTransport, PrismaClient, PushPlatform } from '@prisma/client';
import { logger } from '../../lib/logger.js';
import {
  EmailProviderClient,
  ResendProviderClient,
  SendgridProviderClient,
} from './email-provider.js';
import { ApnsProviderClient, FcmProviderClient, InvalidTokenError, PushProviderClient } from './push-provider.js';

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

/**
 * PUSH transport handler (Epic 7 PR 7.5, ADR-029 §4). Resolves the
 * notification the same way EmailTransportHandler does (via
 * `event.aggregate_id`), then fans out to every `PushToken` registered for
 * that notification's recipient — a user may have multiple devices.
 *
 * Delivery semantics (explicit product decision, not a default): an
 * OutboxEvent is considered DELIVERED as soon as at least one registered
 * device accepts the notification. Per-device delivery tracking is out of
 * scope for this PR — the worker has no per-recipient-fan-out concept, only
 * per-event success/failure, so a partial failure across a user's devices is
 * not reported anywhere beyond a log line. If every device fails with a
 * transient error (network/provider outage — not a permanently invalid
 * token), the event is retried via the normal outbox backoff, which resends
 * to all of that user's devices again.
 *
 * A token confirmed permanently invalid by the provider (APNs
 * 410/BadDeviceToken, FCM UNREGISTERED — surfaced as InvalidTokenError) is
 * deleted immediately, best-effort: the delete itself is not allowed to fail
 * this delivery attempt. An invalidated token is not a delivery failure —
 * there is nothing left to retry for that device — so it never by itself
 * causes the event to be retried.
 */
export class PushTransportHandler implements TransportHandler {
  readonly transport = OutboxTransport.PUSH;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly apnsClient?: PushProviderClient,
    private readonly fcmClient?: PushProviderClient
  ) {}

  private clientFor(platform: PushPlatform): PushProviderClient | undefined {
    return platform === PushPlatform.IOS ? this.apnsClient : this.fcmClient;
  }

  async deliver(event: OutboxEvent): Promise<void> {
    if (event.aggregate_type !== OutboxAggregateType.NOTIFICATION) {
      logger.warn('PushTransportHandler: unsupported aggregate_type, skipping', {
        event_id: event.event_id,
        aggregate_type: event.aggregate_type,
      });
      return;
    }

    const notification = await this.prisma.notification.findUnique({
      where: { id: event.aggregate_id },
    });

    if (!notification) {
      logger.info('PushTransportHandler: referenced Notification no longer exists, skipping', {
        event_id: event.event_id,
        aggregate_id: event.aggregate_id,
      });
      return;
    }

    const tokens = await this.prisma.pushToken.findMany({ where: { user_id: notification.user_id } });

    if (tokens.length === 0) {
      logger.info('PushTransportHandler: recipient has no registered devices, skipping', {
        event_id: event.event_id,
        aggregate_id: event.aggregate_id,
      });
      return;
    }

    let successCount = 0;
    let transientFailure = false;

    for (const pushToken of tokens) {
      const client = this.clientFor(pushToken.platform);
      if (!client) {
        logger.warn('PushTransportHandler: no provider configured for platform, skipping device', {
          event_id: event.event_id,
          platform: pushToken.platform,
        });
        continue;
      }

      try {
        await client.send({ token: pushToken.token, title: notification.title, body: notification.message });
        successCount += 1;
      } catch (error) {
        if (error instanceof InvalidTokenError) {
          logger.info('PushTransportHandler: device token permanently invalid, deleting', {
            event_id: event.event_id,
            push_token_id: pushToken.id,
            platform: pushToken.platform,
          });
          try {
            await this.prisma.pushToken.delete({ where: { id: pushToken.id } });
          } catch (deleteError) {
            // Best-effort: a delete failure (e.g. already removed by a concurrent
            // request) must not fail this delivery attempt.
            logger.warn('PushTransportHandler: failed to delete invalid push token', {
              push_token_id: pushToken.id,
              error: deleteError instanceof Error ? deleteError.message : String(deleteError),
            });
          }
          continue;
        }

        transientFailure = true;
        logger.warn('PushTransportHandler: send failed for device', {
          event_id: event.event_id,
          push_token_id: pushToken.id,
          platform: pushToken.platform,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (successCount > 0) return;

    if (transientFailure) {
      throw new Error('PushTransportHandler: delivery failed on every registered device');
    }

    // No successes, but nothing transient either (all devices were invalid and
    // have been removed, or none had a configured provider) — nothing to retry.
  }
}

/**
 * Selects the PUSH handler worker.ts registers. Each platform is configured
 * independently (a deployment may have APNs but not FCM, or vice versa) —
 * unlike EMAIL's single-provider selection, this is not all-or-nothing:
 * PushTransportHandler is returned whenever at least one platform is fully
 * configured, and simply skips (with a log line) any token whose platform
 * has no client. Falls back to the no-op handler only when neither platform
 * is configured at all, so an unconfigured environment behaves exactly as it
 * did before this PR.
 */
export function resolvePushTransportHandler(
  prisma: PrismaClient,
  config: {
    apnsPrivateKeyBase64?: string;
    apnsKeyId?: string;
    apnsTeamId?: string;
    apnsBundleId?: string;
    firebaseProjectId?: string;
    firebaseServiceAccountKeyBase64?: string;
  }
): TransportHandler {
  const { apnsPrivateKeyBase64, apnsKeyId, apnsTeamId, apnsBundleId, firebaseProjectId, firebaseServiceAccountKeyBase64 } =
    config;

  const apnsClient =
    apnsPrivateKeyBase64 && apnsKeyId && apnsTeamId && apnsBundleId
      ? new ApnsProviderClient(apnsPrivateKeyBase64, apnsKeyId, apnsTeamId, apnsBundleId)
      : undefined;
  const fcmClient =
    firebaseServiceAccountKeyBase64 && firebaseProjectId
      ? new FcmProviderClient(firebaseServiceAccountKeyBase64, firebaseProjectId)
      : undefined;

  if (!apnsClient && !fcmClient) {
    logger.warn(
      'PUSH transport not configured (APNs: APNS_PRIVATE_KEY_BASE64/APNS_KEY_ID/APNS_TEAM_ID/APNS_BUNDLE_ID; FCM: FIREBASE_SERVICE_ACCOUNT_KEY_BASE64/FIREBASE_PROJECT_ID) — falling back to the no-op handler'
    );
    return new LoggingNoopTransportHandler(OutboxTransport.PUSH);
  }

  if (!apnsClient) {
    logger.warn('PUSH transport: APNs not configured — iOS devices will be skipped, not delivered');
  }
  if (!fcmClient) {
    logger.warn('PUSH transport: FCM not configured — Android devices will be skipped, not delivered');
  }

  return new PushTransportHandler(prisma, apnsClient, fcmClient);
}

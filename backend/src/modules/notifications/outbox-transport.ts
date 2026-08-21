import { OutboxAggregateType, OutboxEvent, OutboxTransport, PrismaClient, PushApp, PushPlatform } from '@prisma/client';
import { logger } from '../../lib/logger.js';
import {
  EmailProviderClient,
  ResendProviderClient,
  SendgridProviderClient,
} from './email-provider.js';
import { ApnsProviderClient, FcmProviderClient, InvalidTokenError, PushProviderClient } from './push-provider.js';

/**
 * Compile-time exhaustiveness check: a call site only type-checks if `value`
 * is narrowed to `never`. Reachable only if the generated Prisma enum drifts
 * from this switch, which today requires a code change to even become
 * possible (assertNever's `never` parameter type and the exhaustive switch
 * that calls it are compiled from the same PushApp enum) — practically
 * unreachable at runtime, not merely improbable.
 *
 * This throws a plain Error, so PushTransportHandler's existing catch treats
 * it as a transient failure and lets it ride the normal backoff/retry
 * schedule to DEAD_LETTER. That is imprecise: an unrecognized PushApp value
 * is a deploy-time code/data mismatch, not a transient provider hiccup, and
 * will fail identically on every retry until new code ships — the retry
 * budget buys nothing here. A future, more precise treatment would be a
 * dedicated internal-invariant error class that PushTransportHandler
 * recognizes and dead-letters (or fails fast on) immediately, bypassing the
 * backoff schedule entirely. Not done here: it would need a policy decision
 * on how the worker treats "invariant violation" as a category distinct from
 * "delivery failure" across every transport, not just this one call site —
 * out of scope for this PR.
 */
function assertNever(value: never): never {
  throw new Error(`Unhandled PushApp case: ${String(value)}`);
}

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

    // `event.payload.email_text` overrides the outgoing body in place of
    // `notification.message`, when a producer supplied one (see
    // EnqueueNotificationInput.emailText's own comment for why this lives on
    // OutboxEvent rather than Notification: OutboxEvent is never returned by
    // any self-service endpoint, unlike Notification.message/.data, which
    // GET /notifications and the notification-detail page both surface to
    // the recipient indefinitely). Reads `event`, already this method's own
    // argument -- no extra query. Every existing producer leaves this unset,
    // so this is purely additive: `notification.message` is exactly what
    // gets emailed for every notification type that came before it.
    const payload = event.payload as Record<string, unknown> | null;
    const emailText =
      payload && typeof payload.email_text === 'string' ? payload.email_text : notification.message;

    await this.providerClient.send({
      to: notification.user.email,
      from: this.fromAddress,
      subject: notification.title,
      text: emailText,
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
 * Coerces Notification.data (Prisma Json?, an untyped column every producer
 * writes a plain object literal of resource ids/strings into — e.g.
 * job-requests/service.ts's `{ work_request_id, hotel_id, skill }`) into the
 * Record<string, string> both push providers require. Every producer today
 * only ever writes string/number/boolean primitives, but this column has no
 * schema enforcement, so a malformed or non-object value is handled
 * defensively rather than assumed impossible: null/non-object collapses to
 * undefined (this function's own contribution is then empty — the caller
 * still always sends `type`, per deliver()'s own comment, so a payload is
 * never fully absent even when this returns undefined; the notification
 * degrades to routing-signal-only, matching this pipeline's existing
 * "degrade, don't fail delivery" posture for every other partial-failure
 * case), and each primitive value is stringified rather than dropped.
 */
function stringifyNotificationData(data: unknown): Record<string, string> | undefined {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return undefined;
  const entries = Object.entries(data as Record<string, unknown>).filter(
    ([, value]) => value !== null && value !== undefined && typeof value !== 'object'
  );
  if (entries.length === 0) return undefined;
  return Object.fromEntries(entries.map(([key, value]) => [key, String(value)]));
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
 *
 * Epic 7 PR 7.8: iOS deliveries additionally resolve an `apns-topic` from the
 * token's own `app`, since APNs rejects a token sent under another app's topic
 * and both mobile apps share this one handler and one provider client.
 */
export class PushTransportHandler implements TransportHandler {
  readonly transport = OutboxTransport.PUSH;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly apnsClient?: PushProviderClient,
    private readonly fcmClient?: PushProviderClient,
    /** Per-app APNs topics (bundle IDs), deployment configuration — never persisted. */
    private readonly apnsTopics: Partial<Record<PushApp, string>> = {}
  ) {}

  private clientFor(platform: PushPlatform): PushProviderClient | undefined {
    return platform === PushPlatform.IOS ? this.apnsClient : this.fcmClient;
  }

  /**
   * The `apns-topic` for a token, or undefined when this deployment has no
   * bundle ID configured for that app. Android needs no topic at all — an FCM
   * registration token is self-identifying.
   *
   * Exhaustive `switch` rather than a bare `apnsTopics[pushToken.app]` lookup:
   * a map read silently returns undefined for an app that was never
   * anticipated, so a future third app (e.g. a kiosk build) would be routed
   * through the same "no topic configured, skip" path as a merely
   * unconfigured deployment — indistinguishable from a real config gap. The
   * `default: assertNever(...)` branch makes that a compile error instead:
   * adding a PushApp member without wiring it here fails the build.
   */
  private topicFor(pushToken: { platform: PushPlatform; app: PushApp }): string | undefined {
    if (pushToken.platform !== PushPlatform.IOS) return undefined;

    switch (pushToken.app) {
      case PushApp.WORKER:
        return this.apnsTopics[PushApp.WORKER];
      case PushApp.CHECKER:
        return this.apnsTopics[PushApp.CHECKER];
      default:
        return assertNever(pushToken.app);
    }
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
          push_token_id: pushToken.id,
          user_id: notification.user_id,
          platform: pushToken.platform,
        });
        continue;
      }

      const topic = this.topicFor(pushToken);
      if (pushToken.platform === PushPlatform.IOS && !topic) {
        // No bundle ID configured for this app. Skipped exactly like an
        // unconfigured platform above: not counted as a success, and NOT
        // treated as transient — retrying could never resolve a missing
        // deployment config, it would only burn the backoff schedule and
        // dead-letter an otherwise healthy event.
        logger.warn('PushTransportHandler: no APNs topic configured for app, skipping device', {
          event_id: event.event_id,
          push_token_id: pushToken.id,
          user_id: notification.user_id,
          app: pushToken.app,
        });
        continue;
      }

      try {
        await client.send({
          token: pushToken.token,
          title: notification.title,
          body: notification.message,
          topic,
          // `type` (Notification.type, a separate column from `data`) is
          // composed in here rather than folded into
          // stringifyNotificationData() itself, which stays a pure
          // Json-coercion concern with no notion of the row it came from.
          // A push consumer needs `type` to know how to interpret the rest
          // of the payload (e.g. mobile routes a tapped
          // JOB_REQUEST_BROADCAST to its offer screen using
          // data.work_request_id) — always present, since every
          // Notification has a type.
          data: { type: notification.type, ...stringifyNotificationData(notification.data) },
        });
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
    apnsBundleIdWorker?: string;
    apnsBundleIdChecker?: string;
    firebaseProjectId?: string;
    firebaseServiceAccountKeyBase64?: string;
  }
): TransportHandler {
  const {
    apnsPrivateKeyBase64,
    apnsKeyId,
    apnsTeamId,
    apnsBundleIdWorker,
    apnsBundleIdChecker,
    firebaseProjectId,
    firebaseServiceAccountKeyBase64,
  } = config;

  // Per-app topics (Epic 7 PR 7.8). Each app is configured independently, in
  // the same spirit as each platform: a deployment with only one app's bundle
  // ID still delivers to that app rather than failing closed for both.
  const apnsTopics: Partial<Record<PushApp, string>> = {};
  if (apnsBundleIdWorker) apnsTopics[PushApp.WORKER] = apnsBundleIdWorker;
  if (apnsBundleIdChecker) apnsTopics[PushApp.CHECKER] = apnsBundleIdChecker;

  // One client, one team-scoped signing key, one cached JWT — the topic is
  // supplied per delivery, so a second client per app would only duplicate the
  // JWT cache for no benefit.
  const apnsClient =
    apnsPrivateKeyBase64 && apnsKeyId && apnsTeamId && Object.keys(apnsTopics).length > 0
      ? new ApnsProviderClient(apnsPrivateKeyBase64, apnsKeyId, apnsTeamId)
      : undefined;
  const fcmClient =
    firebaseServiceAccountKeyBase64 && firebaseProjectId
      ? new FcmProviderClient(firebaseServiceAccountKeyBase64, firebaseProjectId)
      : undefined;

  if (!apnsClient && !fcmClient) {
    logger.warn(
      'PUSH transport not configured (APNs: APNS_PRIVATE_KEY_BASE64/APNS_KEY_ID/APNS_TEAM_ID/at least one of APNS_BUNDLE_ID_WORKER|APNS_BUNDLE_ID_CHECKER; FCM: FIREBASE_SERVICE_ACCOUNT_KEY_BASE64/FIREBASE_PROJECT_ID) — falling back to the no-op handler'
    );
    return new LoggingNoopTransportHandler(OutboxTransport.PUSH);
  }

  if (!apnsClient) {
    logger.warn('PUSH transport: APNs not configured — iOS devices will be skipped, not delivered');
  } else {
    // One line summarizing per-app configuration at startup, so a deployment
    // gap (e.g. forgetting APNS_BUNDLE_ID_CHECKER) is visible in the boot log
    // rather than only discoverable from a later per-delivery warning.
    logger.info('PUSH transport: APNs configured for', {
      worker: apnsTopics[PushApp.WORKER] ? 'configured' : 'MISSING (APNS_BUNDLE_ID_WORKER unset)',
      checker: apnsTopics[PushApp.CHECKER] ? 'configured' : 'MISSING (APNS_BUNDLE_ID_CHECKER unset)',
    });
    if (!apnsTopics[PushApp.WORKER]) {
      logger.warn('PUSH transport: APNS_BUNDLE_ID_WORKER unset — worker-app iOS devices will be skipped');
    }
    if (!apnsTopics[PushApp.CHECKER]) {
      logger.warn('PUSH transport: APNS_BUNDLE_ID_CHECKER unset — checker-app iOS devices will be skipped');
    }
  }
  if (!fcmClient) {
    logger.warn('PUSH transport: FCM not configured — Android devices will be skipped, not delivered');
  }

  return new PushTransportHandler(prisma, apnsClient, fcmClient, apnsTopics);
}

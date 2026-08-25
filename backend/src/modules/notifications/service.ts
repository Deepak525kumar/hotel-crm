import {
  Notification,
  NotificationType,
  OutboxAggregateType,
  OutboxEvent,
  OutboxEventType,
  OutboxTransport,
  Prisma,
  PushApp,
  PushPlatform,
} from '@prisma/client';
import crypto from 'node:crypto';
import { BaseService } from '../../lib/base-service.js';
import { DatabaseTransaction } from '../../lib/db.js';
import { ForbiddenError, NotFoundError } from '../../lib/errors.js';
import { EnqueueNotificationInput } from './outbox.types.js';
import { NotificationPayload } from './types.js';
import { getEnv } from '../../config/env.js';
import { resolvePushTokenStore, type StoredPushToken } from './push-token-store.js';

export class NotificationService extends BaseService {
  /**
   * ADR-029 (2026-07-23, GD-01): the sole write path for OutboxEvent
   * (state-outbox) — no other module writes that table directly. Persists
   * the in-app Notification row plus one OutboxEvent per requested
   * transport, atomically. When `tx` is supplied, the caller is already
   * inside a wider transaction (its own domain-change commit) and this
   * write joins it — the "single commit" ADR-029 §2 requires. When `tx` is
   * omitted, this method opens its own transaction so the Notification and
   * its OutboxEvent rows are still atomic with each other.
   *
   * PR 7.1 scope only: this method persists — it does not deliver. No
   * Platform Worker reads these rows yet (PR 7.2).
   */
  async enqueue(
    input: EnqueueNotificationInput,
    tx?: DatabaseTransaction
  ): Promise<{ notification: Notification; outboxEvents: OutboxEvent[] }> {
    if (tx) return this.enqueueWithin(tx, input);
    return this.prisma.$transaction((innerTx) => this.enqueueWithin(innerTx, input));
  }

  private async enqueueWithin(
    db: DatabaseTransaction,
    input: EnqueueNotificationInput
  ): Promise<{ notification: Notification; outboxEvents: OutboxEvent[] }> {
    const correlationId = crypto.randomUUID();
    const scheduledFor = input.scheduledFor ?? new Date();

    const notification = await db.notification.create({
      data: {
        user_id: input.recipientId,
        hotel_id: input.hotelId ?? null,
        type: input.type as NotificationType,
        title: input.title,
        message: input.message,
        data: input.data ? (input.data as Prisma.InputJsonValue) : Prisma.JsonNull,
      },
    });

    const transports = input.transports ?? [];
    const outboxEvents: OutboxEvent[] = [];
    for (const transport of transports) {
      // Sequential, not Promise.all: all rows share one correlation_id and
      // must land inside this same transaction — no concurrency benefit
      // from parallelizing writes on a single tx client, and sequential
      // keeps insertion order deterministic for tests/debugging.
      const outboxEvent = await db.outboxEvent.create({
        data: {
          correlation_id: correlationId,
          event_type: OutboxEventType.NOTIFICATION_CREATED,
          aggregate_type: OutboxAggregateType.NOTIFICATION,
          aggregate_id: notification.id,
          source_module: input.sourceModule,
          producer_service: input.producerService,
          transport,
          // Domain body only — metadata (event_id, correlation_id,
          // aggregate_*, etc.) is column-sourced, never duplicated here
          // (ADR-029 §9). aggregate_id already IS the Notification.id.
          //
          // The one deliberate exception: emailText, when supplied AND this
          // row's own transport is EMAIL. It lives here rather than on the
          // Notification precisely because THIS column is never returned by
          // any self-service endpoint (see EnqueueNotificationInput's own
          // comment) — a PUSH row for the same enqueue() call gets `{}`,
          // same as before, so an email-only override can never leak into a
          // push payload for the same event.
          payload: (transport === OutboxTransport.EMAIL && input.emailText
            ? { email_text: input.emailText }
            : {}) as Prisma.InputJsonValue,
          payload_version: 1,
          scheduled_for: scheduledFor,
          next_attempt_at: scheduledFor,
        },
      });
      outboxEvents.push(outboxEvent);
    }

    return { notification, outboxEvents };
  }

  async sendNotification(userId: string, payload: NotificationPayload) {
    return this.prisma.notification.create({
      data: {
        user_id: userId,
        type: payload.type as NotificationType,
        title: payload.title,
        message: payload.message,
        data: payload.data ? (payload.data as Prisma.InputJsonValue) : Prisma.JsonNull,
      },
    });
  }

  async getNotifications(userId: string) {
    return this.prisma.notification.findMany({
      where: { user_id: userId },
      orderBy: { created_at: 'desc' },
      take: 50,
    });
  }

  async markAsRead(notificationId: string, userId: string) {
    const notification = await this.prisma.notification.findUnique({
      where: { id: notificationId },
    });
    if (!notification) throw new NotFoundError('Notification not found');
    if (notification.user_id !== userId) throw new ForbiddenError('Cannot mark this notification as read');

    return this.prisma.notification.update({
      where: { id: notificationId },
      data: { is_read: true, read_at: new Date() },
    });
  }

  /**
   * Registers (or re-registers) a device push token. Epic 7 PR 7.5,
   * ADR-029 §4: `token` carries the unique constraint, not `user_id`+`token`
   * — a device token is device-specific, so re-registering it under a
   * different user (e.g. a shared device, or a re-login after logout)
   * reassigns ownership rather than creating a second row. This is a
   * security-correctness requirement: a stale token must stop delivering to
   * a previous user the moment a new one registers it.
   */
  /**
   * Registers a device token against the store this deployment uses
   * (Firestore when Firebase is configured, the `PushToken` table otherwise —
   * see push-token-store.ts). Deliberately goes through resolvePushTokenStore
   * rather than writing Prisma directly, so registration and the PUSH
   * transport can never end up reading and writing different stores.
   */
  async registerPushToken(
    userId: string,
    token: string,
    platform: PushPlatform,
    app: PushApp
  ): Promise<StoredPushToken> {
    const env = getEnv();
    const store = resolvePushTokenStore(this.prisma, {
      firestoreEnabled: env.FEATURE_PUSH_TOKEN_STORE_FIRESTORE,
      firebaseProjectId: env.FIREBASE_PROJECT_ID,
      firebaseServiceAccountKeyBase64: env.FIREBASE_SERVICE_ACCOUNT_KEY_BASE64,
    });
    return store.upsert(userId, token, platform, app);
  }
}

export const notificationService = new NotificationService();

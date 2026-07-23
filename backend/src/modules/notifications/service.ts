import { Notification, NotificationType, OutboxAggregateType, OutboxEvent, OutboxEventType, Prisma } from '@prisma/client';
import crypto from 'node:crypto';
import { BaseService } from '../../lib/base-service.js';
import { DatabaseTransaction } from '../../lib/db.js';
import { ForbiddenError, NotFoundError, NotImplementedError } from '../../lib/errors.js';
import { EnqueueNotificationInput } from './outbox.types.js';
import { NotificationPayload } from './types.js';

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
          payload: {} as Prisma.InputJsonValue,
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

  async sendEmail(_email: string, _subject: string, _body: string) {
    throw new NotImplementedError('Email delivery is not yet implemented');
  }

  async sendPushNotification(_userId: string, _title: string, _body: string) {
    throw new NotImplementedError('Push notifications are not yet implemented');
  }
}

export const notificationService = new NotificationService();

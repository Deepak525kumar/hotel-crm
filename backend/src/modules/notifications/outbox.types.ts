import {
  OutboxAggregateType,
  OutboxEventType,
  OutboxSourceModule,
  OutboxTransport,
} from '@prisma/client';

/**
 * Metadata for one OutboxEvent row, projected from its columns — never
 * duplicated into the stored `payload` JSON (ADR-029 §9). Producers and the
 * future Platform Worker consume this shape as the envelope around a
 * transport-specific or event-type-specific payload.
 */
export interface OutboxMetadata {
  eventId: string;
  correlationId: string;
  eventType: OutboxEventType;
  aggregateType: OutboxAggregateType;
  aggregateId: string;
  sourceModule: OutboxSourceModule;
  producerService: string;
  payloadVersion: number;
  createdAt: string;
}

export interface OutboxEnvelope<TPayload> {
  metadata: OutboxMetadata;
  payload: TPayload;
}

/**
 * NOTIFICATION_CREATED payload contract, version 1. Intentionally empty:
 * `aggregate_id` already IS the Notification.id (the canonical reference the
 * Platform Worker resolves the aggregate from) — repeating it here would
 * recreate the metadata/payload duplication ADR-029 §9 explicitly avoids.
 */
export type NotificationCreatedPayloadV1 = Record<string, never>;

/**
 * Input to NotificationService.enqueue(). One call persists the in-app
 * Notification row plus one OutboxEvent row per requested transport, all in
 * a single transaction (ADR-029 §2).
 */
export interface EnqueueNotificationInput {
  recipientId: string;
  type: string;
  title: string;
  message: string;
  data?: Record<string, unknown>;
  hotelId?: string;
  /** External dispatch transports to enqueue. Omit/[] for in-app-only (no OutboxEvent rows). */
  transports?: OutboxTransport[];
  /** Producer's bounded-context identity (stable; drives future producer-side authz/routing). */
  sourceModule: OutboxSourceModule;
  /** Producer's concrete class name, e.g. "AttendanceService" — a class-name identity, kept as a plain string (see schema.prisma OutboxEvent.producer_service). */
  producerService: string;
  /**
   * When this event should first become eligible for delivery. Defaults to
   * now(). Exists so future delayed producers (e.g. a contract-expiry
   * reminder sent 3 days out) need no schema change — PR 7.1 has no producer
   * that supplies it yet.
   */
  scheduledFor?: Date;
}

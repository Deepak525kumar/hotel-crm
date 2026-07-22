import { describe, it, expect } from '@jest/globals';
import { NotificationChannel } from '@prisma/client';

// ADR-027 (2026-07-22, OQ-NOTIF-01): the canonical NotificationChannel enum is
// exactly IN_APP/EMAIL/PUSH/SMS/WEBHOOK. Provider-specific integrations (WhatsApp,
// Slack, etc.) are a transport detail under one of these five, never a new enum
// member. This regression test pins the enum shape so a future change must be a
// deliberate, reviewed edit, not an accidental drift.
describe('NotificationChannel enum (ADR-027 / OQ-NOTIF-01)', () => {
  it('contains exactly the five ADR-027 members', () => {
    expect(Object.values(NotificationChannel).sort()).toEqual(
      ['EMAIL', 'IN_APP', 'PUSH', 'SMS', 'WEBHOOK'].sort()
    );
  });

  it('includes WEBHOOK as a legal value', () => {
    expect(NotificationChannel.WEBHOOK).toBe('WEBHOOK');
  });

  it('does not introduce provider-specific members (e.g. WHATSAPP, SLACK)', () => {
    const values = Object.values(NotificationChannel) as string[];
    expect(values).not.toEqual(expect.arrayContaining(['WHATSAPP', 'SLACK']));
  });
});

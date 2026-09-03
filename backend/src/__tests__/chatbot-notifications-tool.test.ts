import { describe, it, expect, jest, beforeEach } from '@jest/globals';

const mockGetNotifications = jest.fn() as jest.MockedFunction<(...a: any[]) => any>;

jest.mock('../modules/notifications/service.js', () => ({
  notificationService: { getNotifications: mockGetNotifications },
}));

import { listMyNotifications } from '../modules/chatbot/tools/definitions/self-service.tools.js';
import { ROLE_PERMISSIONS } from '../config/constants.js';
import type { ActorContext } from '../modules/chatbot/tools/actor.js';

const actorFor = (role: string): ActorContext =>
  ({
    userId: `user_${role}`,
    role: role.toLowerCase(),
    permissions: ROLE_PERMISSIONS[role] ?? [],
    scope: null,
  }) as unknown as ActorContext;

const row = (over: Partial<any> = {}) => ({
  id: 'n1',
  type: 'ASSIGNMENT',
  title: 'New shift',
  message: 'You have a shift on Tuesday.',
  read_at: null,
  created_at: new Date('2026-09-01T08:00:00Z'),
  ...over,
});

describe('notifications.list_mine', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetNotifications.mockResolvedValue([row()]);
  });

  it('reads the caller id from the ACTOR, never from arguments', async () => {
    // The whole vulnerability would be passing anything else here.
    await listMyNotifications.invoke({ limit: 10 } as any, actorFor('WORKER'));
    expect(mockGetNotifications).toHaveBeenCalledWith('user_WORKER');
  });

  it('rejects any attempt to name another user', () => {
    // `.strict()` — an unexpected key is a validation failure, not an
    // ignored field. Forbidden keys are additionally refused at compile
    // time and at registration, so this is the third of three layers.
    for (const bad of [{ user_id: 'someone_else' }, { userId: 'x' }, { limit: 5, worker_id: 'y' }]) {
      expect(listMyNotifications.args.safeParse(bad).success).toBe(false);
    }
  });

  it('is usable by every role that exists — none is locked out', async () => {
    // The documented trap: assignments.list_mine once required a token the
    // WORKER role does not hold, and 100+ tests passed because fixtures
    // fabricated it. This asserts against the REAL ROLE_PERMISSIONS.
    for (const role of ['ADMIN', 'MANAGER', 'REGIONAL_MANAGER', 'CHECKER', 'WORKER']) {
      const actor = actorFor(role);
      expect(ROLE_PERMISSIONS[role]).toBeDefined();
      await expect(listMyNotifications.invoke({ limit: 5 } as any, actor)).resolves.toBeDefined();
    }
  });

  it('stays READ_ONLY, self-scoped and token-less — the envelope for a null permission', () => {
    expect(listMyNotifications.tier).toBe('READ_ONLY');
    expect(listMyNotifications.scopeCheck).toBe('self');
    expect(listMyNotifications.permission).toBeNull();
    // assertValidRegistration requires a written rationale for a null token.
    expect(listMyNotifications.permissionRationale).toBeTruthy();
  });

  it('applies the caller’s limit, since the service has none', async () => {
    mockGetNotifications.mockResolvedValue(Array.from({ length: 20 }, () => row()));
    const out = (await listMyNotifications.invoke({ limit: 3 } as any, actorFor('WORKER'))) as unknown[];
    expect(out).toHaveLength(3);
  });

  it('truncates a long message so one notification cannot eat the budget', () => {
    const long = 'x'.repeat(500);
    const out = listMyNotifications.compress([row({ message: long })]);
    const first = (out.data as any[])[0];
    expect(first.message.length).toBeLessThanOrEqual(160);
    expect(first.message.endsWith('...')).toBe(true);
  });

  it('drops the notification payload entirely', () => {
    // `data` carries internal ids for client deep-linking and nothing a
    // person needs read back to them.
    const out = listMyNotifications.compress([{ ...row(), data: { secret_id: 'abc' } }]);
    expect(JSON.stringify(out)).not.toContain('secret_id');
  });

  it('counts unread correctly and reports an empty list plainly', () => {
    const out = listMyNotifications.compress([row(), row({ read_at: new Date() })]);
    expect(out.summary).toMatch(/2 notifications, 1 unread/);
    expect(listMyNotifications.compress([]).summary).toBe('No notifications.');
  });

  it('tolerates a null/undefined result rather than throwing at render time', () => {
    expect(listMyNotifications.compress(undefined).data).toEqual([]);
    expect(listMyNotifications.compress(null).summary).toBe('No notifications.');
  });
});

import { describe, it, expect, jest, beforeEach } from '@jest/globals';

/**
 * `users.update_my_profile` and its token (2026-09-15, owner-approved): the
 * one change in that session that added a permission. The assertions that
 * matter are that it reaches only the caller's own row, only phone and
 * language, and that nobody lost the ability to change their own profile.
 */

const mockUpdateProfile = jest.fn() as jest.MockedFunction<(...a: any[]) => any>;
jest.mock('../modules/auth/service.js', () => ({ authService: { updateProfile: mockUpdateProfile } }));
jest.mock('../modules/chatbot/tools/worker-reference.js', () => ({
  resolveHotelReference: jest.fn(),
  refuseUnresolvedHotel: jest.fn(),
}));

import { updateMyProfile } from '../modules/chatbot/tools/definitions/accounts.tools.js';
import { actorHasPermission } from '../modules/chatbot/tools/executor.js';
import { ROLE_PERMISSIONS } from '../config/constants.js';
import type { ActorContext } from '../modules/chatbot/tools/actor.js';

const actorFor = (role: string): ActorContext =>
  ({ userId: `${role}-1`, role: role.toLowerCase(), permissions: ROLE_PERMISSIONS[role] ?? [], scope: null }) as unknown as ActorContext;
const summaryOf = (raw: unknown) => updateMyProfile.compress(raw).summary;

beforeEach(() => {
  jest.clearAllMocks();
  mockUpdateProfile.mockResolvedValue({});
});

describe('users.update_my_profile -- "my new number is 0160 1234567"', () => {
  it("writes the caller's OWN row, with the number normalised as the form's check would", async () => {
    const args = updateMyProfile.args.parse({ phone: '0160 1234567' });
    const out = await updateMyProfile.invoke(args, actorFor('WORKER'));

    expect(mockUpdateProfile).toHaveBeenCalledWith('WORKER-1', { phone: '+491601234567' });
    expect(summaryOf(out)).toBe('Done: your phone number is now +491601234567.');
  });

  it('changes the app language to one of the six the apps ship', async () => {
    const out = await updateMyProfile.invoke({ language: 'de' }, actorFor('CHECKER'));
    expect(mockUpdateProfile).toHaveBeenCalledWith('CHECKER-1', { preferred_language: 'de' });
    expect(summaryOf(out)).toMatch(/speak German/);
  });

  it('refuses anything but phone and language, and an empty request', () => {
    for (const bad of [{ first_name: 'X' }, { email: 'a@b.c' }, { user_id: 'u2', phone: '+4916012345' }, {}]) {
      expect(updateMyProfile.args.safeParse(bad).success).toBe(false);
    }
    expect(updateMyProfile.args.safeParse({ language: 'es' }).success).toBe(false);
  });

  /** Unique phone: say it is taken, never by whom. */
  it('turns a taken number into a plain request for another, naming nobody', async () => {
    mockUpdateProfile.mockRejectedValue(Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }));
    const out = await updateMyProfile.invoke({ phone: '+491601234567' }, actorFor('WORKER'));
    expect(summaryOf(out)).toBe('That phone number is already used by another account. Check the number and try again.');
  });

  it('is self-scoped, confirmed, and usable by EVERY role -- the token denies nobody', () => {
    expect({ scope: updateMyProfile.scopeCheck, confirm: updateMyProfile.confirm }).toEqual({ scope: 'self', confirm: true });
    for (const role of Object.keys(ROLE_PERMISSIONS)) {
      expect({ role, ok: actorHasPermission(actorFor(role), updateMyProfile.permission!) }).toEqual({ role, ok: true });
    }
  });
});

import { describe, it, expect } from '@jest/globals';
import { ROLE_PERMISSIONS } from '../config/constants.js';
import { readFileSync } from 'node:fs';

/**
 * Two routes that previously enforced NO permission token now enforce one.
 *
 * That is the dangerous kind of change: adding requirePermission to an open
 * route silently locks out every role that does not hold the new token, and
 * the symptom is a 403 for a worker doing something they did yesterday.
 *
 * `POST /calendar/my-absences` and `POST /notifications/:id/read` are open to
 * ANY authenticated role by design -- the calendar route says so in its own
 * comment ("self-scope is itself the authorization"). So the tokens exist to
 * NAME the capability, not to deny anyone, and every role must hold them.
 */
const ROLES = ['ADMIN', 'MANAGER', 'REGIONAL_MANAGER', 'CHECKER', 'WORKER'];

describe('self-scoped write tokens (2026-09-04)', () => {
  it('REGRESSION: every role holds them, so nobody lost access to an open route', () => {
    for (const role of ROLES) {
      const held = ROLE_PERMISSIONS[role] ?? [];
      expect({ role, hasAbsence: held.includes('calendar:absence:write-own') })
        .toEqual({ role, hasAbsence: true });
      expect({ role, hasMarkRead: held.includes('notifications:mark-read-own') })
        .toEqual({ role, hasMarkRead: true });
    }
  });

  it('covers every role the constant defines, not just the five named here', () => {
    // Guards against a role being added later without these tokens, which
    // would silently lock it out of both routes.
    for (const role of Object.keys(ROLE_PERMISSIONS)) {
      const held = ROLE_PERMISSIONS[role] ?? [];
      const exempt = held.includes('admin:*');
      expect({ role, ok: exempt || held.includes('calendar:absence:write-own') })
        .toEqual({ role, ok: true });
      expect({ role, ok: exempt || held.includes('notifications:mark-read-own') })
        .toEqual({ role, ok: true });
    }
  });

  it('the routes actually enforce them — a declared-but-unchecked token is a lie', () => {
    // The handoff's trap: "a token the wrapped route does not enforce is a
    // lie or a lockout." These tokens only mean anything because the routes
    // check them; asserted against the source so the two cannot drift.
    const calendar = readFileSync('src/modules/calendar/routes.ts', 'utf8');
    expect(calendar).toMatch(/requirePermission\('calendar:absence:write-own'\)/);

    const notifications = readFileSync('src/modules/notifications/routes.ts', 'utf8');
    expect(notifications).toMatch(/requirePermission\('notifications:mark-read-own'\)/);
  });

  it('grants nothing broader than the capability named', () => {
    // A self-scoped write token must not accidentally imply the broad write
    // token for the same resource.
    for (const role of ['WORKER', 'CHECKER']) {
      const held = ROLE_PERMISSIONS[role] ?? [];
      expect(held).not.toContain('notifications:write');
      expect(held).not.toContain('hr:write');
    }
  });
});

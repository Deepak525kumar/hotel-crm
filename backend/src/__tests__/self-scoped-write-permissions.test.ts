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

  /**
   * `users:profile:write-own`, 2026-09-15. PUT /auth/profile was open to every
   * authenticated user and gained the token so a chatbot tool could declare
   * it. Every role must hold it, or someone loses the ability to change their
   * own phone number or language -- the lockout this file exists to prevent.
   */
  it('REGRESSION: every role holds users:profile:write-own, and the route enforces it', () => {
    for (const role of Object.keys(ROLE_PERMISSIONS)) {
      const held = ROLE_PERMISSIONS[role] ?? [];
      expect({ role, ok: held.includes('admin:*') || held.includes('users:profile:write-own') }).toEqual({ role, ok: true });
    }
    const auth = readFileSync('src/modules/auth/routes.ts', 'utf8');
    expect(auth).toMatch(/router\.put\('\/profile', authMiddleware, requirePermission\('users:profile:write-own'\)/);
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

/**
 * The team-scoped counterpart, added 2026-09-07 by the same argument.
 *
 * DIFFERENT RISK FROM THE TOKENS ABOVE. Those went on routes open to ANY
 * authenticated role, so every role had to hold them. `POST /calendar/absences`
 * was never open -- it gated on `requireRole(admin|manager|regional_manager)`
 * and no token. Adding `requirePermission` there is safe ONLY IF all three of
 * those roles hold the new token, and a lockout would show up as a manager
 * suddenly getting 403 on something they did yesterday.
 *
 * So the role list is READ OUT OF THE ROUTE FILE rather than restated here.
 * A restated list agrees with itself; this one breaks if someone widens
 * requireRole without granting the token.
 */
describe('calendar:absence:write-team (2026-09-07)', () => {
  const routeSource = readFileSync('src/modules/calendar/routes.ts', 'utf8');

  /** The roles `requireRole(...)` admits on the POST /absences route. */
  function rolesAdmittedByRoute(): string[] {
    // Narrow to the POST '/absences' registration, not '/my-absences' or the
    // move/delete routes that follow it.
    const start = routeSource.indexOf("router.post(\n  '/absences',");
    expect(start).toBeGreaterThan(-1);
    const block = routeSource.slice(start, start + 1200);
    const match = /requireRole\(\[([^\]]*)\]\)/.exec(block);
    expect(match).not.toBeNull();
    return [...(match?.[1] ?? '').matchAll(/'([a-z_]+)'/g)].map((m) => m[1].toUpperCase());
  }

  it('REGRESSION: every role the route admits holds the token, so nobody was locked out', () => {
    const admitted = rolesAdmittedByRoute();
    expect(admitted.sort()).toEqual(['ADMIN', 'MANAGER', 'REGIONAL_MANAGER']);

    for (const role of admitted) {
      const held = ROLE_PERMISSIONS[role] ?? [];
      expect({ role, ok: held.includes('admin:*') || held.includes('calendar:absence:write-team') })
        .toEqual({ role, ok: true });
    }
  });

  it('the route actually enforces it — a declared-but-unchecked token is a lie', () => {
    expect(routeSource).toMatch(/requirePermission\('calendar:absence:write-team'\)/);
  });

  it('does NOT grant it to the roles the route excludes', () => {
    // The self path stays theirs; the on-behalf path does not become theirs.
    for (const role of ['WORKER', 'CHECKER']) {
      const held = ROLE_PERMISSIONS[role] ?? [];
      expect({ role, held: held.includes('calendar:absence:write-team') })
        .toEqual({ role, held: false });
      expect(held).toContain('calendar:absence:write-own');
    }
  });

  it('is a distinct capability from the self-scoped one', () => {
    // Holding "-own" must never imply "-team": that would let a worker mark
    // anyone's absence, which is the whole thing this separation prevents.
    const worker = ROLE_PERMISSIONS.WORKER ?? [];
    expect(worker).not.toContain('calendar:absence:write-team');
    expect(worker).not.toContain('calendar:*');
  });
});

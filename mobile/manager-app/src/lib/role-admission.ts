import { ALLOWED_ROLES } from '../constants/app-config';
import type { User, UserRole } from '@hotel-crm/mobile-shared';

export type Admission =
  | { kind: 'admitted' }
  /** A real user of this system, but of a different app. */
  | { kind: 'wrong-app'; role: UserRole; app: 'worker' | 'checker' }
  /** Signed in as something this build does not recognise at all. */
  | { kind: 'denied'; role: string };

/**
 * Decides whether a signed-in user belongs in this app.
 *
 * Extracted as a pure function so it is testable without a renderer: the
 * 2026-08-25 mobile sweep found eight defects, five of them in `.tsx` files
 * that passed typecheck, because the logic was only reachable by rendering.
 *
 * The `wrong-app` case exists because of what checker-app shipped first: a
 * role it did not serve got the app's normal shell with every query 403ing,
 * which reads as "the app is broken" rather than "you want the other one".
 * Telling someone which app to open is the whole difference.
 *
 * This is a CONVENIENCE, not a security boundary. Every endpoint re-derives
 * authorization server-side; this only decides what to render.
 */
export function admit(user: Pick<User, 'role'> | null): Admission {
  if (!user) return { kind: 'denied', role: 'anonymous' };

  if ((ALLOWED_ROLES as readonly string[]).includes(user.role)) {
    return { kind: 'admitted' };
  }

  if (user.role === 'worker') return { kind: 'wrong-app', role: 'worker', app: 'worker' };
  if (user.role === 'checker') return { kind: 'wrong-app', role: 'checker', app: 'checker' };

  return { kind: 'denied', role: user.role };
}

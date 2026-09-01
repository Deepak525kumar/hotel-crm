import { readFileSync } from 'node:fs';

// Guards the consent-gate/push-registration ordering.
//
// Push registration used to be a useEffect on the (app) layout. React runs
// effects on mount regardless of what the component renders, so once the
// daily consent gate went live the effect fired against /notifications --
// a gated route -- took a 403 CONSENT_REQUIRED that push-notifications.ts
// swallows by design, and never retried, because registration is documented
// as running once per app launch. The device then received no push for the
// rest of that session even after the worker accepted the notice.
//
// The fix is structural rather than conditional: registration lives in a
// component rendered as a CHILD of ConsentGate, which renders children only
// once today's consent is granted, so mount implies consent.
describe('push registration runs only after the consent gate', () => {
  const layout = readFileSync('src/app/(app)/_layout.tsx', 'utf8');

  it('does not call registerForPushNotificationsAsync from the layout', () => {
    expect(layout).not.toContain('registerForPushNotificationsAsync');
  });

  it('ConsentGate is wrapped around the root Stack layout', () => {
    const rootLayout = readFileSync('src/app/_layout.tsx', 'utf8');
    const jsx = rootLayout.slice(rootLayout.indexOf('return ('));
    const gateOpen = jsx.indexOf('<ConsentGate>');
    const stack = jsx.indexOf('<Stack');
    const gateClose = jsx.indexOf('</ConsentGate>');
    
    expect(gateOpen).toBeGreaterThanOrEqual(0);
    expect(stack).toBeGreaterThan(gateOpen);
    expect(stack).toBeLessThan(gateClose);
  });

  it('renders PushRegistration in the app layout', () => {
    // Search the JSX only
    const jsx = layout.slice(layout.indexOf('return ('));
    const push = jsx.indexOf('<PushRegistration />');
    expect(push).toBeGreaterThanOrEqual(0);
  });

  it('keeps the registration call in the gated component', () => {
    const comp = readFileSync('src/components/PushRegistration.tsx', 'utf8');
    expect(comp).toContain('registerForPushNotificationsAsync');
    expect(comp).toContain('subscribeToPushNotifications');
  });

  // The three tests above check everything AROUND ConsentGate -- that the
  // layout wires it correctly -- but never open ConsentGate.tsx itself. That
  // blind spot is exactly how this shipped: 2026-08-25 rewrote checker-app's
  // copy of this file to render {children} unconditionally, underneath an
  // absolute-positioned wall, instead of gating on it. Every check above
  // still passed -- <PushRegistration /> was still textually nested inside
  // <ConsentGate> in the JSX, which is all those tests look at -- while at
  // runtime <PushRegistration />'s effect fired on mount regardless of
  // consent status, registered against a still-gated endpoint, took a 403,
  // and (by design, see push-notifications.ts) never retried. Every install
  // of that app registered zero push tokens for six days before anyone
  // noticed, because nothing failed loudly enough to page anyone.
  //
  // This one opens ConsentGate.tsx and checks the actual invariant: outside
  // the two early-return bypass guards (admin, no-user), it must never
  // render `children` at all. A component that both bypasses on a condition
  // AND falls through to `{children}` unconditionally later is not a gate.
  it('ConsentGate never renders children outside its bypass guards', () => {
    const src = readFileSync('src/components/consent/ConsentGate.tsx', 'utf8');
    const body = src.slice(src.indexOf('export function ConsentGate'));

    // Line-based rather than a single \(...\) regex: the guard condition
    // itself commonly contains its own parens/braces (e.g.
    // shouldBypassConsentGate({ isAdmin, status, ... })), which a naive
    // \([^)]*\) stops matching at the first inner ')' rather than the
    // guard's own closing paren.
    const lines = body.split('\n');
    const guardLines = lines.filter((l) => l.includes('return <>{children}</>;'));
    expect(guardLines.length).toBeGreaterThanOrEqual(1);

    // Every remaining line must not render children -- in particular not in
    // the final JSX the function returns when no guard fired, which is the
    // wall this component exists to show.
    const remaining = lines.filter((l) => !guardLines.includes(l)).join('\n');
    expect(remaining).not.toMatch(/\{children\}/);
  });
});

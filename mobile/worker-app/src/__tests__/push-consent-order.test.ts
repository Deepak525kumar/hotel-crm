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

  it('renders PushRegistration inside ConsentGate, not beside it', () => {
    // Search the JSX only -- the doc comment above the return also names
    // <PushRegistration />, and indexOf would find that mention first.
    const jsx = layout.slice(layout.indexOf('return ('));
    const gateOpen = jsx.indexOf('<ConsentGate>');
    const push = jsx.indexOf('<PushRegistration />');
    const gateClose = jsx.indexOf('</ConsentGate>');
    expect(gateOpen).toBeGreaterThanOrEqual(0);
    expect(push).toBeGreaterThan(gateOpen);
    expect(push).toBeLessThan(gateClose);
  });

  it('keeps the registration call in the gated component', () => {
    const comp = readFileSync('src/components/PushRegistration.tsx', 'utf8');
    expect(comp).toContain('registerForPushNotificationsAsync');
    expect(comp).toContain('subscribeToPushNotifications');
  });
});

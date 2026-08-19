import { readFileSync } from 'node:fs';

// CRR §14: "Checker is notified with the photo + details."
//
// The notification carries the message but not the images, so the tap has to
// land somewhere that shows them. Before the evidence screen existed the
// photos were write-only: uploaded, recorded, and impossible to look at.
describe('rework-completed push opens the evidence', () => {
  const push = readFileSync('src/lib/push-notifications.ts', 'utf8');
  const layout = readFileSync('src/app/_layout.tsx', 'utf8');

  it('routes REWORK_COMPLETED to the verification screen', () => {
    expect(push).toContain("data?.type === 'REWORK_COMPLETED'");
    expect(push).toContain('/verification/${data.verification_id}');
  });

  it('requires a verification_id before navigating', () => {
    // Without the guard a payload from an older backend navigates to
    // /verification/undefined rather than falling back to the list.
    expect(push).toContain("typeof data.verification_id === 'string'");
  });

  it('keeps the notifications list as the default for every other type', () => {
    expect(push).toContain("router.push('/notifications')");
  });

  it('registers the screen, so it is reachable and not an orphan', () => {
    // checker-app enumerates screens explicitly; an unregistered file compiles
    // fine and is simply unreachable -- the trap the consent/documents/hr
    // screens fell into.
    expect(layout).toContain('name="verification/[id]"');
  });
});

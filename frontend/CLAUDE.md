@AGENTS.md

# frontend

Next.js web app for admin, manager and regional-manager roles. Workers and
checkers use the Expo apps, not this.

The block above is written and re-added by `next dev`. Leave it; removing it
from a diff only re-creates the uncommitted change.

## Gates

```bash
npx tsc --noEmit && npm run lint && npx jest --ci && npx next build
```

`next build` catches things `tsc` does not, and CI runs it. Lint is the one
that gets skipped and the one that fails the build.

## Roles decide almost everything on screen

`user.role` plus the resolved scope claims, never role alone:

- `scope_hotel_id` is set **only** for a hotel manager — they are the one role
  pinned to a single hotel. Admin and regional_manager have it `null` and must
  pick a hotel before any single-hotel panel can render.
- `scope_hotel_group_id` is an RM's own group; an admin picks a group first.
- Write gates must list **all three** of `admin`, `manager`,
  `regional_manager`. Omitting RM is this codebase's most repeated bug and
  produces no error anywhere.

Client-side filters are a **view convenience over data the server already
scoped**. They never widen what is visible, and must never be the only gate.

## Mobile layout — the admin dashboard lesson

Reported as two separate bugs (the Zelle launcher invisible on a phone, and
the recent-activity card overflowing to the right). They were one bug.

- A Tailwind `grid` with no explicit column count gets an implicit `auto`
  track, which is sized by its **widest content** and cannot shrink. One long
  unbroken string then widens the whole page past the viewport, the layout
  viewport widens with it, and anything `fixed` to the right edge lands
  off-screen. `grid-cols-1` compiles to `minmax(0, 1fr)` and is the fix.
- Flex and grid items default to `min-width: auto`, so `truncate` does nothing
  until an ancestor carries `min-w-0`. Add it on the card *and* the row.
- Verify at 375px in a real browser, and measure the page width — not by
  eyeballing a resized desktop window.

## Chatbot client

- The API returns the turn object **as-is**, so fields arrive `camelCase`, not
  `snake_case`. Getting this wrong once meant `pendingConfirmation` was always
  undefined, so high-risk writes rendered with no Confirm button and could
  never be approved — with nothing on screen explaining why. Unit tests missed
  it because they seeded the store in the shape the store expects, never
  crossing the API boundary where the mismatch lives.
- **Honour `turn.status`.** A conversation the server has closed is not
  reusable; holding its id means every later message is refused.
- Locale keys must exist in the frontend **and** both mobile apps —
  `locales.test.ts` deep-equals the catalogues and will fail CI in a branch
  that never touched mobile.

import { describe, it, expect } from '@jest/globals';
import { parseRouteFile, routeKey } from './support/route-registry.js';

// ADR-030 PR-7 (review follow-up): a dedicated unit test for
// support/route-registry.ts's parser itself, exercised against synthetic
// source strings — not real modules/*/routes.ts files. buildRouteRegistry()
// (used by permission-token-hygiene.test.ts and route-role-matrix.test.ts)
// only proves the parser handles what the current route files happen to
// contain; it says nothing about the parser's own bracket-depth scanning,
// quote tracking, top-level comma splitting, and requireRoleFlagged/
// requirePermissionFlagged argument resolution in general. These pin those
// mechanisms directly, independent of what's currently on disk.

describe('route-registry.ts parser', () => {
  it('parses a single-line call with a single quoted role', () => {
    const source = `router.get('/hotels', requireRole('admin'), (req, res) => controller.list(req, res));`;
    const routes = parseRouteFile('crm', source);
    expect(routes).toHaveLength(1);
    expect(routes[0]).toMatchObject({
      module: 'crm',
      method: 'GET',
      path: '/hotels',
      requiredRoles: ['admin'],
      requiredPermissions: null,
    });
  });

  it('parses an array-of-roles argument and a requirePermission call on the same line', () => {
    const source = `router.post('/hotels', requireRole(['admin', 'manager']), requirePermission('hotels:write'), controller.create);`;
    const routes = parseRouteFile('crm', source);
    expect(routes[0]).toMatchObject({
      requiredRoles: ['admin', 'manager'],
      requiredPermissions: ['hotels:write'],
    });
  });

  it('parses a heavily multi-line call with nested arrays/parens, resolving *Flagged calls to their NEW (second) argument', () => {
    const source = `
router.post(
  "/x",
  requireRoleFlagged(
      ["manager"],
      ["manager","regional_manager"]
  ),
  requirePermissionFlagged(
      "hotels:write",
      "hotel_groups:write"
  ),
  controller
)
`;
    const routes = parseRouteFile('crm', source);
    expect(routes).toHaveLength(1);
    expect(routes[0]).toMatchObject({
      module: 'crm',
      method: 'POST',
      path: '/x',
      // *Flagged resolves to the NEW/second argument, per D-8's target-state
      // pinning — not the old ["manager"] / "hotels:write".
      requiredRoles: ['manager', 'regional_manager'],
      requiredPermissions: ['hotel_groups:write'],
    });
  });

  it('does not stop early on a closing paren nested inside an array argument', () => {
    // requireRole(['admin', 'manager']) contains a ')' before the call's own
    // matching close — a naive regex or non-bracket-aware scan would treat
    // the array's own no-op here as the end of the call. Confirms the
    // balanced-paren scanner reads through to the REAL end of
    // router.post(...), including the controller argument after it.
    const source = `router.post('/hotel-groups', requireRole(['admin', 'manager']), requirePermission('hotel_groups:write'), controllerFn);`;
    const routes = parseRouteFile('crm', source);
    expect(routes).toHaveLength(1);
    expect(routes[0].requiredRoles).toEqual(['admin', 'manager']);
    expect(routes[0].requiredPermissions).toEqual(['hotel_groups:write']);
  });

  it('does not break argument extraction on an escaped quote inside a string literal', () => {
    // A permission token containing an escaped quote is not a realistic
    // real-world token, but it is exactly the kind of input that breaks a
    // parser doing naive string splitting instead of tracking in-string
    // state char-by-char (extractBalancedParens/splitTopLevelArgs both skip
    // over `\\` + the following char so an escaped quote is never mistaken
    // for the string's closing quote). This proves the call is still parsed
    // as ONE route with one role argument — it does NOT assert the escape
    // sequence gets unescaped in the output: extractStringLiterals's regex
    // captures the literal source text between quotes verbatim, backslash
    // included, which is fine since no real route/permission token in this
    // codebase contains a quote character.
    const source = `router.get('/x', requireRole('adm\\'in'), controllerFn);`;
    const routes = parseRouteFile('crm', source);
    expect(routes).toHaveLength(1);
    expect(routes[0].requiredRoles).toEqual(["adm\\'in"]);
  });

  it('parses multiple route registrations in the same file independently', () => {
    const source = `
router.get('/a', requireRole('admin'), fn1);
router.post('/b', requireRole(['admin', 'manager']), requirePermission('b:write'), fn2);
router.delete('/c', requireRole('admin'), fn3);
`;
    const routes = parseRouteFile('mod', source);
    expect(routes).toHaveLength(3);
    expect(routes.map((r) => routeKey(r))).toEqual([
      'mod:GET /a',
      'mod:POST /b',
      'mod:DELETE /c',
    ]);
    expect(routes[1].requiredPermissions).toEqual(['b:write']);
  });

  it('yields null (not a deny-all) for a route with no requireRole/requirePermission gate at all', () => {
    const source = `router.get('/me', authMiddleware, (req, res) => controller.me(req, res));`;
    const routes = parseRouteFile('auth', source);
    expect(routes[0].requiredRoles).toBeNull();
    expect(routes[0].requiredPermissions).toBeNull();
  });

  it('ignores router.use() registrations (not a route call)', () => {
    const source = `
router.use(authMiddleware);
router.get('/a', requireRole('admin'), fn);
`;
    const routes = parseRouteFile('mod', source);
    expect(routes).toHaveLength(1);
    expect(routes[0].path).toBe('/a');
  });
});

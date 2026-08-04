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

  // Regression: the bracket/quote scanners treat `'` as a string delimiter, so
  // an ordinary apostrophe in a comment ("§1's original statement") opened a
  // phantom string and swallowed the parens of the NEXT router.<method>( call,
  // throwing "Unbalanced parens starting at index N". Latent for as long as no
  // comment apostrophe happened to sit above a route registration — then a
  // routine comment edit broke every suite that builds the registry.
  // parseRouteFile() now blanks comment bodies before scanning.
  describe('comment handling (apostrophes, block comments, // inside strings)', () => {
    it('parses a route whose preceding comment contains an apostrophe', () => {
      const src = `
// MANAGER has never held \`hotels:write\` (§1's original Problem statement:
// the manager's scope claim isn't consulted here).
router.get('/hotels', requireRole(['admin', 'manager']), requirePermission('hotels:read'), listHotels);
`;
      const routes = parseRouteFile('crm', src);
      expect(routes).toHaveLength(1);
      expect(routes[0]).toMatchObject({
        method: 'GET',
        path: '/hotels',
        requiredRoles: ['admin', 'manager'],
        requiredPermissions: ['hotels:read'],
      });
    });

    it('parses a route preceded by a block comment containing an apostrophe', () => {
      const src = `
/*
 * The actor's scope claim is resolved in-service; don't gate it here.
 */
router.post('/hotels', requireRole('admin'), createHotel);
`;
      const routes = parseRouteFile('crm', src);
      expect(routes).toHaveLength(1);
      expect(routes[0]).toMatchObject({ method: 'POST', path: '/hotels', requiredRoles: ['admin'] });
    });

    it('does not treat a // inside a string literal as a comment', () => {
      const src = `
router.get('/callback//double', requireRole('admin'), handler);
`;
      const routes = parseRouteFile('crm', src);
      expect(routes).toHaveLength(1);
      expect(routes[0]?.path).toBe('/callback//double');
      expect(routes[0]?.requiredRoles).toEqual(['admin']);
    });

    // Review item 11: character-by-character scanners are fragile, so the
    // adjacent constructs that could also desynchronize the quote/bracket state
    // are pinned explicitly. All of these pass today; they exist so a future
    // change to stripComments() cannot regress them silently.
    it('handles a template literal containing // and quote characters', () => {
      const src = "const x = `http://a 'b' ${y}`;\nrouter.get('/t', requireRole('admin'), h);\n";
      const routes = parseRouteFile('m', src);
      expect(routes).toHaveLength(1);
      expect(routes[0]?.requiredRoles).toEqual(['admin']);
    });

    it('handles a regex literal containing a quote and a slash', () => {
      const src = "const re = /['\\/]+/g;\nrouter.get('/r', requireRole('admin'), h);\n";
      const routes = parseRouteFile('m', src);
      expect(routes).toHaveLength(1);
      expect(routes[0]?.path).toBe('/r');
    });

    it('handles an escaped quote inside a string literal', () => {
      const src = "const s = 'it\\'s';\nrouter.get('/e', requireRole('admin'), h);\n";
      const routes = parseRouteFile('m', src);
      expect(routes).toHaveLength(1);
      expect(routes[0]?.path).toBe('/e');
    });

    // JS block comments do not nest: the outer comment ends at the FIRST `*/`.
    it('treats a so-called nested block comment the way JS does', () => {
      const src = "/* a /* b */\nrouter.get('/n', requireRole('admin'), h);\n";
      const routes = parseRouteFile('m', src);
      expect(routes).toHaveLength(1);
      expect(routes[0]?.path).toBe('/n');
    });

    it('does not throw on an unterminated block comment', () => {
      const src = "/* oops\nrouter.get('/u', requireRole('admin'), h);\n";
      expect(() => parseRouteFile('m', src)).not.toThrow();
    });

    it('parses a MULTI-LINE route call preceded by an apostrophe comment', () => {
      const src =
        "// the manager's list\nrouter.get(\n  '/ml',\n  requireRole(['admin', 'manager']),\n  requirePermission('hotels:read'),\n  h\n);\n";
      const routes = parseRouteFile('m', src);
      expect(routes).toHaveLength(1);
      expect(routes[0]?.requiredRoles).toEqual(['admin', 'manager']);
      expect(routes[0]?.requiredPermissions).toEqual(['hotels:read']);
    });

    it('ignores a router call that appears only inside a comment', () => {
      const src = `
// router.get('/commented-out', requireRole('admin'), handler);
router.get('/real', requireRole('admin'), handler);
`;
      const routes = parseRouteFile('crm', src);
      expect(routes).toHaveLength(1);
      expect(routes[0]?.path).toBe('/real');
    });
  });

  describe('@requiresPermission annotation (role-conditional permission wrappers)', () => {
    it('resolves a route calling an annotated wrapper function to the annotation\'s token list', () => {
      const source = `
// @requiresPermission hr:read hr:contract:read-own
function requireContractReadAccess() {
  return (req, res, next) => {};
}

router.get('/workers/:worker_id/contract-status', requireRole(['admin', 'manager', 'worker']), requireContractReadAccess(), fn);
`;
      const routes = parseRouteFile('hr', source);
      expect(routes).toHaveLength(1);
      expect(routes[0].requiredPermissions).toEqual(['hr:read', 'hr:contract:read-own']);
    });

    it('does not apply the annotation when a literal requirePermission() call is also present (literal call wins)', () => {
      const source = `
// @requiresPermission hr:read hr:contract:read-own
function requireContractReadAccess() {
  return (req, res, next) => {};
}

router.get('/x', requireRole('admin'), requirePermission('hr:write'), fn);
`;
      const routes = parseRouteFile('hr', source);
      expect(routes[0].requiredPermissions).toEqual(['hr:write']);
    });

    it('tolerates additional comment lines between the annotation and the function declaration', () => {
      const source = `
// Some explanatory prose about why this wrapper exists,
// spanning several lines before the annotation itself.
//
// @requiresPermission a:read b:write
// One more trailing comment line after the annotation.
function myWrapper() {
  return (req, res, next) => {};
}

router.post('/y', myWrapper(), fn);
`;
      const routes = parseRouteFile('mod', source);
      expect(routes[0].requiredPermissions).toEqual(['a:read', 'b:write']);
    });

    it('does not resolve a route that never calls the annotated function', () => {
      const source = `
// @requiresPermission hr:read hr:contract:read-own
function requireContractReadAccess() {
  return (req, res, next) => {};
}

router.get('/unrelated', requireRole('admin'), fn);
`;
      const routes = parseRouteFile('hr', source);
      expect(routes[0].requiredPermissions).toBeNull();
    });
  });
});

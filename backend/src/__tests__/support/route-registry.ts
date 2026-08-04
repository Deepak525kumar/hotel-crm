// ADR-030 PR-7: static source-parser that derives the route x role x
// permission registry directly from `modules/*/routes.ts` source text.
//
// Why static parsing instead of runtime Express-stack introspection: the
// middleware closures returned by requireRole()/requirePermission() (and the
// requireRoleFlagged()/requirePermissionFlagged() wrappers) are anonymous
// functions — there is no reliable way to recover "this route was gated by
// requireRole(['admin','manager'])" by inspecting `router.stack` at runtime.
// Parsing the route-registration call sites themselves is the only way to
// get an accurate, drift-proof route x role/permission table without hand
// copying it (which is exactly the anti-pattern D-8's invariant test exists
// to prevent).
//
// Approach / regex limitations (documented rather than hidden):
//   - We read each modules/*/routes.ts file whole and scan for
//     `router.<method>(` call sites. For each call site we grab the source
//     text from that point up to the *matching* closing paren of the
//     `router.<method>(...)` call (a small bracket-depth scanner, not a
//     regex, because these calls span multiple lines and contain nested
//     parens themselves, e.g. `requireRole(['admin','manager'])`).
//   - Within that per-route chunk we regex out the first path-string
//     literal argument, then separately regex out the arguments of any
//     requireRole(...), requirePermission(...), requireRoleFlagged(...,...),
//     requirePermissionFlagged(...,...) call appearing in the chunk.
//   - requireRole/requirePermission argument parsing: supports either a
//     single quoted string ('admin') or an array of quoted strings
//     (['admin', 'manager']). It does NOT evaluate arbitrary JS expressions
//     — every call site in this codebase uses literal strings/arrays, so
//     this is sufficient for the current surface. If a route ever computed
//     its role list dynamically, this parser would silently see no match
//     for that gate (not crash) — a known limitation worth flagging if it
//     ever happens.
//   - requireRoleFlagged(oldRoles, newRoles) / requirePermissionFlagged(old,
//     new): we split top-level-comma-separated arguments (respecting
//     bracket/quote nesting) and resolve to the SECOND argument only (the
//     new/target-state roles or token), per D-8 pinning the ratified matrix
//     rather than the pre-rollout one.
//   - A route with no requireRole/requirePermission call at all (e.g.
//     `/auth/*`, or `assignments` GET routes gated only by service-level
//     logic) yields `requiredRoles: null` / `requiredPermissions: null`.
//     `null` means "no such gate", not "deny all" — callers must not
//     conflate the two.
//   - `checkHotelAccess()` / `checkWorkerScope()` calls are recognized only
//     to be ignored: they are scope gates, out of scope for this matrix
//     (already covered by rbac.test.ts and the *-scope-authz.test.ts files).
//   - Routes are addressed by `${module}:${method.toUpperCase()} ${path}` for
//     readable failure messages; this key is not assumed unique across
//     modules (module is part of the key) but IS assumed unique within a
//     module — true for every routes.ts file in this repository as of this
//     writing.
//   - Role-conditional permission wrappers (a named function that calls
//     requirePermission() with a DIFFERENT token per req.auth.role, e.g.
//     hr/routes.ts's requireContractReadAccess() — needed when
//     requirePermission()'s array form is an AND check and cannot express
//     "token A for role X, token B for role Y" on one route) are NOT
//     literal `requirePermission('...')` call sites, so the argument-based
//     parsing above cannot see them. Rather than silently missing these
//     tokens (or worse, only picking up the first of several conditional
//     requirePermission() calls inside the wrapper's own body — a route
//     chunk substring-search would stop at the first match), such a
//     wrapper MUST declare its full token set via a structured comment
//     directly above its `function` declaration:
//       // @requiresPermission hr:read hr:contract:read-own
//       function requireContractReadAccess() { ... }
//     parseRouteFile() scans the whole source once for this annotation,
//     keyed by function name, and — when a route chunk calls that function
//     instead of requirePermission() directly — resolves requiredPermissions
//     to the annotation's token list (the UNION across roles, not resolved
//     per-role: this registry only answers "does some route check this
//     token," which every one of D-8's invariants only needs at that
//     granularity). This is still zero JS evaluation, just reading a second
//     kind of literal (a comment) instead of a call argument — the "no
//     arbitrary expression evaluation" design constraint is unchanged.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';

// NOTE: this repo is ESM (`"type": "module"`) at build/runtime, but ts-jest
// transpiles test files (and their non-test dependencies, like this one) to
// CommonJS-shaped output under Jest, where `__dirname` is available — see
// the same pattern already used by `push-token-migration.test.ts` et al.
// `import.meta.url` is avoided here specifically because it requires a
// per-file ESNext module target that Jest's ts-jest transform does not
// consistently apply to non-`*.test.ts` support modules.
declare const __dirname: string;

export interface ParsedRoute {
  module: string;
  method: string;
  path: string;
  requiredRoles: string[] | null;
  requiredPermissions: string[] | null;
  /** raw source chunk, kept only for debugging/assertion messages */
  raw: string;
}

function modulesDir(): string {
  // this file lives at backend/src/__tests__/support/route-registry.ts
  return path.resolve(__dirname, '../../modules');
}

/**
 * Replaces the CONTENT of every `//` line comment and block comment with
 * spaces, preserving the source's exact length and line structure (newlines are
 * kept) so every index and line number is unchanged.
 *
 * Needed because the scanners below treat `'`, `"` and backtick as string
 * delimiters. An apostrophe in prose ("the manager's scope") is not a string
 * opener, but a character-level scanner cannot tell the difference — so a
 * comment could silently consume the parens of the following route
 * registration. Blanking comment bodies removes that entire failure class
 * rather than relying on comment prose avoiding apostrophes.
 *
 * String literals are tracked here too, so a `//` inside a string (e.g. a
 * `'https://…'` path literal) is correctly NOT treated as a comment start.
 */
function stripComments(src: string): string {
  const out = src.split('');
  let inString: string | null = null;
  let i = 0;

  const blank = (from: number, to: number): void => {
    for (let k = from; k < to && k < out.length; k++) {
      if (out[k] !== '\n') out[k] = ' ';
    }
  };

  while (i < src.length) {
    const ch = src[i];

    if (inString) {
      if (ch === '\\') {
        i += 2;
        continue;
      }
      if (ch === inString) inString = null;
      i++;
      continue;
    }

    if (ch === "'" || ch === '"' || ch === '`') {
      inString = ch;
      i++;
      continue;
    }

    if (ch === '/' && src[i + 1] === '/') {
      const end = src.indexOf('\n', i);
      const stop = end === -1 ? src.length : end;
      blank(i, stop);
      i = stop;
      continue;
    }

    if (ch === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end === -1 ? src.length : end + 2;
      blank(i, stop);
      i = stop;
      continue;
    }

    i++;
  }

  return out.join('');
}

/**
 * Extracts the substring of `src` starting at `startIdx` (which must point at
 * the opening '(' of a call) through its matching closing ')', inclusive.
 * Tracks nested parens, brackets and quoted strings so it does not stop early
 * on the ')' inside e.g. requireRole(['admin', 'manager']).
 */
function extractBalancedParens(src: string, openParenIdx: number): string {
  let depth = 0;
  let inString: string | null = null;
  for (let i = openParenIdx; i < src.length; i++) {
    const ch = src[i];
    if (inString) {
      if (ch === '\\') {
        i++; // skip escaped char
        continue;
      }
      if (ch === inString) inString = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      inString = ch;
      continue;
    }
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) {
        return src.slice(openParenIdx, i + 1);
      }
    }
  }
  throw new Error(`Unbalanced parens starting at index ${openParenIdx}`);
}

/** Splits the inside of a call's argument list on top-level commas. */
function splitTopLevelArgs(argsInner: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let inString: string | null = null;
  let current = '';
  for (let i = 0; i < argsInner.length; i++) {
    const ch = argsInner[i];
    if (inString) {
      current += ch;
      if (ch === '\\') {
        current += argsInner[i + 1] ?? '';
        i++;
        continue;
      }
      if (ch === inString) inString = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      inString = ch;
      current += ch;
      continue;
    }
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    if (ch === ')' || ch === ']' || ch === '}') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim().length > 0) parts.push(current.trim());
  return parts;
}

/**
 * Pulls every single/double-quoted string literal out of an argument
 * fragment. NOTE: this does not unescape backslash sequences — the captured
 * text is the literal source between the quotes, backslash included, e.g.
 * `'adm\'in'` yields `"adm\\'in"` (backslash retained), not `"adm'in"`. Only
 * the closing-quote detection is escape-aware (an escaped quote is never
 * mistaken for the terminator); no route or permission token in this
 * codebase contains a quote character, so this is not a practical limitation
 * today — see route-registry-parser.test.ts's escaped-quote case.
 */
function extractStringLiterals(fragment: string): string[] {
  const matches = fragment.match(/'([^'\\]|\\.)*'|"([^"\\]|\\.)*"/g) ?? [];
  return matches.map((m) => m.slice(1, -1));
}

/**
 * Given the full route-registration chunk (e.g.
 * `router.post('/hotel-groups', requireRole('admin'), requirePermissionFlagged('hotels:write', 'hotel_groups:write'), ...crmController.createHotelGroup);`),
 * find the arguments of a given gate function call by name and return the
 * top-level comma-split argument list (as raw fragments, not yet resolved to
 * string literals — resolution differs for flagged vs non-flagged calls).
 */
function findCallArgs(chunk: string, fnName: string): string[] | null {
  const idx = chunk.indexOf(`${fnName}(`);
  if (idx === -1) return null;
  const openParenIdx = idx + fnName.length;
  const call = extractBalancedParens(chunk, openParenIdx);
  const inner = call.slice(1, -1); // strip outer ( and )
  return splitTopLevelArgs(inner);
}

/** Resolves a single requireRole/requirePermission-style argument fragment
 * (either 'x' or ['x','y']) to its string literal(s). */
function resolveLiteralArg(fragment: string): string[] {
  return extractStringLiterals(fragment);
}

/**
 * Scans a whole routes.ts source (not a single route chunk) for
 * `// @requiresPermission tok1 tok2 ...` annotations immediately preceding a
 * `function name(` declaration, returning a map of function name -> its
 * declared token list. See this file's own header comment for the
 * annotation convention and why it exists (role-conditional permission
 * wrappers requirePermission()'s AND-only array form and a single
 * requirePermission() call site cannot express).
 */
function scanPermissionWrapperAnnotations(source: string): Map<string, string[]> {
  const annotations = new Map<string, string[]>();
  // Matches the annotation comment, any amount of whitespace/further
  // comment lines, then the function declaration it documents. `[^\n]*`
  // keeps the token-list capture on the annotation's own line only.
  const pattern = /\/\/\s*@requiresPermission\s+([^\n]+)\n(?:\s*\/\/[^\n]*\n)*\s*function\s+(\w+)\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    const tokens = match[1]!.trim().split(/\s+/).filter(Boolean);
    const fnName = match[2]!;
    annotations.set(fnName, tokens);
  }
  return annotations;
}

function parseGates(
  chunk: string,
  permissionWrapperAnnotations: Map<string, string[]>
): { roles: string[] | null; permissions: string[] | null } {
  let roles: string[] | null = null;
  let permissions: string[] | null = null;

  const roleArgs = findCallArgs(chunk, 'requireRole');
  if (roleArgs && roleArgs.length >= 1) {
    roles = resolveLiteralArg(roleArgs[0]);
  }

  const roleFlaggedArgs = findCallArgs(chunk, 'requireRoleFlagged');
  if (roleFlaggedArgs && roleFlaggedArgs.length >= 2) {
    // D-8 pins the ratified (FEATURE_GD02_MATRIX-enabled) target state — the
    // second (new) argument.
    roles = resolveLiteralArg(roleFlaggedArgs[1]);
  }

  const permArgs = findCallArgs(chunk, 'requirePermission');
  if (permArgs && permArgs.length >= 1) {
    permissions = resolveLiteralArg(permArgs[0]);
  }

  const permFlaggedArgs = findCallArgs(chunk, 'requirePermissionFlagged');
  if (permFlaggedArgs && permFlaggedArgs.length >= 2) {
    permissions = resolveLiteralArg(permFlaggedArgs[1]);
  }

  // Role-conditional permission wrapper (e.g. requireContractReadAccess()):
  // resolved from its own @requiresPermission annotation, not a literal
  // requirePermission() argument. Only applies if the chunk doesn't already
  // have a literal requirePermission()/requirePermissionFlagged() match
  // above — a route calling both would be an unusual, currently-unseen
  // shape this parser does not need to reconcile.
  if (permissions === null) {
    for (const [fnName, tokens] of permissionWrapperAnnotations) {
      if (chunk.includes(`${fnName}(`)) {
        permissions = tokens;
        break;
      }
    }
  }

  return { roles, permissions };
}

// Exported for direct unit testing (route-registry-parser.test.ts) —
// buildRouteRegistry() only exercises this indirectly via the real
// modules/*/routes.ts files on disk, which doesn't pin the parser's
// handling of tricky-but-currently-unused-in-practice source shapes
// (multi-line calls, escaped quotes, etc.) against a fixed synthetic input.
export function parseRouteFile(moduleName: string, source: string): ParsedRoute[] {
  const routes: ParsedRoute[] = [];
  // Annotations are scanned from the ORIGINAL source: stripComments() below
  // removes the `// @requiresPermission ...` lines this depends on.
  const permissionWrapperAnnotations = scanPermissionWrapperAnnotations(source);
  // Comments are blanked before any bracket/quote scanning. extractBalancedParens()
  // treats `'` as a string delimiter, so an ordinary apostrophe in English prose
  // ("§1's original statement", "manager's scope") would open a phantom string and
  // swallow the parens of the next router.<method>( call, throwing "Unbalanced
  // parens". That was a latent bug: it only bit once a comment containing an
  // apostrophe happened to sit close enough above a route-registration call.
  source = stripComments(source);
  const callRegex = /router\.(get|post|put|patch|delete)\(/g;
  let match: RegExpExecArray | null;

  while ((match = callRegex.exec(source)) !== null) {
    const method = match[1];
    const openParenIdx = match.index + `router.${method}`.length;
    const chunk = extractBalancedParens(source, openParenIdx);
    const inner = chunk.slice(1, -1);

    // First top-level arg is always the path string literal.
    const topArgs = splitTopLevelArgs(inner);
    const pathLiterals = extractStringLiterals(topArgs[0] ?? '');
    const routePath = pathLiterals[0];
    if (routePath === undefined) continue; // defensive; every real call site has a path literal

    const { roles, permissions } = parseGates(chunk, permissionWrapperAnnotations);

    routes.push({
      module: moduleName,
      method: method.toUpperCase(),
      path: routePath,
      requiredRoles: roles,
      requiredPermissions: permissions,
      raw: chunk,
    });
  }

  return routes;
}

/**
 * Parses every `modules/<name>/routes.ts` file into a flat list of routes with
 * their required roles/permissions resolved to the FINAL (FEATURE_GD02_MATRIX
 * enabled) target state.
 */
export function buildRouteRegistry(): ParsedRoute[] {
  const base = modulesDir();
  const entries = readdirSync(base, { withFileTypes: true }).filter((e) => e.isDirectory());
  const routes: ParsedRoute[] = [];

  for (const entry of entries) {
    const routesFile = path.join(base, entry.name, 'routes.ts');
    if (!existsSync(routesFile)) continue;
    const source = readFileSync(routesFile, 'utf8');
    routes.push(...parseRouteFile(entry.name, source));
  }

  return routes;
}

export function routeKey(route: ParsedRoute): string {
  return `${route.module}:${route.method} ${route.path}`;
}

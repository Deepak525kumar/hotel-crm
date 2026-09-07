import { describe, it, expect } from '@jest/globals';
import { listTools, permissionTokens } from '../modules/chatbot/tools/registry.js';
import { actorHasPermission } from '../modules/chatbot/tools/executor.js';
import {
  classifyToolError,
  describeToolError,
  toolError,
  type ToolErrorCode,
} from '../modules/chatbot/tools/tool-errors.js';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../lib/errors.js';
import { isoDate, plausibleDate } from '../modules/chatbot/tools/schema-primitives.js';
import { ROLE_PERMISSIONS } from '../config/constants.js';
import type { ActorContext } from '../modules/chatbot/tools/actor.js';
// Registers every tool definition as an import side effect.
import '../modules/chatbot/service.js';

/**
 * THE TOOL-DESIGN RULES, ENFORCED RATHER THAN DOCUMENTED.
 *
 * Every rule below was previously followed by convention -- which is to say,
 * by whoever wrote the last tool remembering. This file makes each one fail
 * the build instead, because the failure mode of a convention is that the
 * twenty-first tool quietly breaks it and nothing says so.
 *
 * These are properties of the REGISTRY as a whole, deliberately: a rule that
 * only holds for the tools someone thought to test is not a rule.
 */

const actorFor = (role: keyof typeof ROLE_PERMISSIONS): ActorContext =>
  ({
    userId: 'u1',
    role: String(role).toLowerCase(),
    permissions: ROLE_PERMISSIONS[role] ?? [],
    scope: { type: 'hotel', hotel_id: 'h1' },
  }) as unknown as ActorContext;

const ROLES = Object.keys(ROLE_PERMISSIONS) as Array<keyof typeof ROLE_PERMISSIONS>;
const TOOLS = listTools();

/**
 * RULE: a description must carry purpose, when to use it, and what comes back.
 *
 * This is the entire basis of tool selection -- the model sees the name, the
 * description and the JSON schema, and nothing else. "Refunds an order" and
 * "Issues a refund for a verified customer's eligible order; returns refund
 * status" route very differently, and the difference is invisible in code
 * review because both look like sentences.
 */
describe('rule: descriptions must be specific enough to route on', () => {
  it.each(TOOLS.map((t) => [t.name, t.description] as const))(
    '%s describes its purpose in enough detail',
    (_name, description) => {
      // Long enough to say something. "Refunds an order." is 18 characters.
      expect(description.length).toBeGreaterThan(60);
      expect(description.trim()).toMatch(/\.$/);
    }
  );

  it.each(TOOLS.map((t) => [t.name, t.description] as const))(
    '%s gives the model example phrasings to match against',
    (_name, description) => {
      // Every tool carries "Use for ..." with real utterances. This is what
      // separates two tools whose one-line summaries sound alike.
      expect(description).toMatch(/use (for|when)/i);
    }
  );

  it.each(TOOLS.map((t) => [t.name, t.description] as const))(
    '%s says what it returns or does, not merely what it is about',
    (_name, description) => {
      expect(description).toMatch(
        /\b(returns?|reports?|lists?|records?|produces?|gives?|checks?|clocks?|exports?|shows?|gets?|sends?|marks?|puts?)\b/i
      );
    }
  );

  it.each(TOOLS.map((t) => [t.name, t] as const))(
    '%s states the date format when it actually takes a date',
    (_name, tool) => {
      // Checked against the SCHEMA, not the prose. The first version of this
      // rule tested the description for /date|day|from|to/ and fired on the
      // word "to" in ordinary sentences ("send it back TO the worker") --
      // a rule that flags correct work is worse than no rule, because the
      // fix people reach for is to weaken it.
      const shape =
        (tool.args as unknown as { shape?: Record<string, unknown> }).shape ??
        (tool.args as unknown as { _def?: { schema?: { shape?: Record<string, unknown> } } })._def
          ?.schema?.shape ??
        {};
      const dateArgs = Object.keys(shape).filter((k) => /^(day|date|from|to)$/.test(k));
      if (dateArgs.length === 0) return;

      // A model that has to learn the format by being rejected costs a whole
      // turn to find out something the description could have said.
      expect({ tool: tool.name, dateArgs, statesFormat: /YYYY-MM-DD/.test(tool.description) })
        .toEqual({ tool: tool.name, dateArgs, statesFormat: true });
    }
  );

  /**
   * A description must not carry a SECURITY instruction. If a rule matters, it
   * belongs in code -- "only do this if the user confirms" in a description is
   * a request, and the whole point of the executor is that requests are not
   * how authority works here.
   */
  it.each(TOOLS.map((t) => [t.name, t.description] as const))(
    '%s does not try to enforce a rule through prose',
    (_name, description) => {
      expect(description).not.toMatch(/\bonly (call|use|do) this if\b/i);
      expect(description).not.toMatch(/\bnever (call|use)\b/i);
      expect(description).not.toMatch(/\byou must not\b/i);
    }
  );
});

/**
 * RULE: least privilege. A tool nobody can use is dead weight; a tool
 * everybody can use had better be one everybody should have.
 */
describe('rule: least privilege', () => {
  it('registers no tool that every role can reach unless it is meant to be universal', () => {
    const universal = TOOLS.filter((tool) =>
      ROLES.every((r) => tool.permission === null || actorHasPermission(actorFor(r), tool.permission))
    );

    // The universal set is deliberately small and self-scoped: reading your
    // own rows, marking your own message read, exporting your own data.
    for (const tool of universal) {
      expect({ tool: tool.name, scope: tool.scopeCheck }).toEqual({
        tool: tool.name,
        scope: 'self',
      });
    }
  });

  it('never registers a tool no real role can use', () => {
    for (const tool of TOOLS) {
      const usableBy = ROLES.filter(
        (r) => tool.permission === null || actorHasPermission(actorFor(r), tool.permission)
      );
      expect({ tool: tool.name, reachable: usableBy.length > 0 }).toEqual({
        tool: tool.name,
        reachable: true,
      });
    }
  });

  it('keeps a worker away from every tool that touches another person', () => {
    // The concrete privilege boundary, asserted as data rather than trusted:
    // these are the capabilities an attacker with a worker session would want.
    const OTHERS = [
      'assignments.place_worker',
      'assignments.place_many',
      'calendar.mark_worker_absence',
      'quality.assign_rework',
      'reports.query_team',
      'reports.export_team',
      'assignments.list_for_my_team',
    ];
    const worker = actorFor('WORKER');

    for (const name of OTHERS) {
      const tool = TOOLS.find((t) => t.name === name);
      expect({ name, registered: Boolean(tool) }).toEqual({ name, registered: true });
      expect({
        name,
        reachable: tool!.permission !== null && actorHasPermission(worker, tool!.permission),
      }).toEqual({ name, reachable: false });
    }
  });
});

/**
 * RULE: enforcement is deterministic, never a prompt instruction.
 */
describe('rule: deterministic enforcement, not model instruction', () => {
  it('forces confirmation on every high-risk write at registration', () => {
    for (const tool of TOOLS) {
      if (tool.tier !== 'HIGH_RISK_WRITE') continue;
      expect({ tool: tool.name, confirm: tool.confirm }).toEqual({
        tool: tool.name,
        confirm: true,
      });
    }
  });

  it('lets no write use the token-less escape hatch', () => {
    // `permission: null` is only honest where the wrapped route enforces no
    // token, and that is only ever true of reads here.
    for (const tool of TOOLS) {
      if (tool.permission !== null) continue;
      expect({ tool: tool.name, tier: tool.tier, scope: tool.scopeCheck }).toEqual({
        tool: tool.name,
        tier: 'READ_ONLY',
        scope: 'self',
      });
      expect(tool.permissionRationale?.trim().length ?? 0).toBeGreaterThan(0);
    }
  });

  it('declares a non-empty permission wherever it declares one at all', () => {
    for (const tool of TOOLS) {
      if (tool.permission === null) continue;
      const tokens = permissionTokens(tool.permission);
      expect({ tool: tool.name, count: tokens.length }).toEqual({
        tool: tool.name,
        count: expect.any(Number),
      });
      expect(tokens.length).toBeGreaterThan(0);
      expect(tokens.every((t) => t.trim().length > 0)).toBe(true);
    }
  });
});

/**
 * RULE: small, single-purpose tools. No `handle_everything()`.
 */
describe('rule: clear capability boundaries', () => {
  it('gives every tool a resource-scoped, single-verb name', () => {
    for (const tool of TOOLS) {
      expect({ tool: tool.name, shape: /^[a-z_]+\.[a-z_]+$/.test(tool.name) }).toEqual({
        tool: tool.name,
        shape: true,
      });
    }
  });

  it('registers no catch-all tool', () => {
    for (const tool of TOOLS) {
      expect(tool.name).not.toMatch(/manage|handle|do_|everything|generic|misc|admin_all/i);
    }
  });

  it('keeps argument surfaces small enough to reason about', () => {
    // A tool needing many arguments is usually several tools wearing a coat.
    for (const tool of TOOLS) {
      const shape = (tool.args as unknown as { _def?: { schema?: unknown } })._def;
      const inner = (shape as { schema?: { shape?: Record<string, unknown> } })?.schema?.shape;
      const direct = (tool.args as unknown as { shape?: Record<string, unknown> }).shape;
      const keys = Object.keys(inner ?? direct ?? {});
      expect({ tool: tool.name, argCount: keys.length <= 6 }).toEqual({
        tool: tool.name,
        argCount: true,
      });
    }
  });
});

/**
 * RULE: failures are structured, and different failures imply different
 * next moves.
 */
describe('rule: structured failures that say what to do next', () => {
  it.each([
    ['INVALID_INPUT', false, 'fix_input'],
    ['NOT_FOUND', false, 'ask_user'],
    ['AMBIGUOUS', false, 'ask_user'],
    ['FORBIDDEN', false, 'stop'],
    ['CONFLICT', false, 'stop'],
    ['TEMPORARY', true, 'retry'],
    ['INTERNAL', false, 'escalate'],
  ])('%s is retryable=%s and directs the caller to %s', (code, retryable, nextAction) => {
    const error = toolError(code as ToolErrorCode, 'x');
    expect({ retryable: error.retryable, nextAction: error.nextAction }).toEqual({
      retryable,
      nextAction,
    });
  });

  it('marks exactly one code as retryable', () => {
    // Retrying anything else is either pointless (permissions, not-found) or
    // actively harmful (resending arguments that were already rejected).
    const codes: ToolErrorCode[] = [
      'INVALID_INPUT', 'NOT_FOUND', 'AMBIGUOUS', 'FORBIDDEN', 'CONFLICT', 'TEMPORARY', 'INTERNAL',
    ];
    expect(codes.filter((c) => toolError(c, 'x').retryable)).toEqual(['TEMPORARY']);
  });

  it('classifies by error CLASS, so reworded messages do not break it', () => {
    expect(classifyToolError(new ValidationError('bad', [])).code).toBe('INVALID_INPUT');
    expect(classifyToolError(new NotFoundError('gone')).code).toBe('NOT_FOUND');
    expect(classifyToolError(new ForbiddenError('nope')).code).toBe('FORBIDDEN');
    expect(classifyToolError(new ConflictError('already')).code).toBe('CONFLICT');
  });

  it('treats a timeout or dropped connection as transient', () => {
    const abort = new Error('aborted');
    abort.name = 'AbortError';
    expect(classifyToolError(abort).code).toBe('TEMPORARY');

    const reset = Object.assign(new Error('socket'), { code: 'ECONNRESET' });
    expect(classifyToolError(reset).code).toBe('TEMPORARY');
  });

  /**
   * The safety property. An unknown fault must not be presented as something
   * worth retrying -- that is how one bug becomes a retry storm against a
   * dependency that is already down.
   */
  it('fails an unrecognised error to the safe side', () => {
    const unknown = classifyToolError(new Error('who knows'));
    expect({ code: unknown.code, retryable: unknown.retryable }).toEqual({
      code: 'INTERNAL',
      retryable: false,
    });
  });

  it('never leaks an unclassified message to the caller', () => {
    // A raw fault can carry a stack trace, a connection string or a driver
    // message. None of that belongs in a conversation.
    const leaky = classifyToolError(
      new Error('Error: connect ECONN at postgres://user:pw@10.0.0.4:5432/prod')
    );
    expect(leaky.message).not.toMatch(/postgres|10\.0\.0\.4|pw@/);
  });

  it('gives a person something to do, not a status code', () => {
    expect(describeToolError(toolError('TEMPORARY', 'The service did not respond.'))).toMatch(
      /try again/i
    );
    expect(describeToolError(toolError('INVALID_INPUT', 'Bad date.'))).toMatch(/rephrase/i);
    expect(describeToolError(toolError('INTERNAL', 'Something went wrong.'))).toMatch(
      /administrator/i
    );
    // A permission refusal must NOT invite the user to try rephrasing: that
    // invites them to talk their way around a control that exists on purpose.
    expect(describeToolError(toolError('FORBIDDEN', 'You cannot do that.'))).not.toMatch(
      /try again|rephrase/i
    );
  });
});

/**
 * RULE: semantic validation, not merely syntactic. Valid JSON can still be
 * nonsense -- an `age` of 250 parses perfectly.
 */
describe('rule: arguments are validated semantically', () => {
  it('rejects a date that is only a well-formed string', () => {
    // The bug this replaced: every tool used a bare shape regex, which
    // accepts a thirteenth month and a forty-fifth day.
    for (const bad of ['2026-13-45', '2026-02-30', '2026-04-31', '2026-00-10', '2026-01-00']) {
      expect({ date: bad, accepted: isoDate.safeParse(bad).success }).toEqual({
        date: bad,
        accepted: false,
      });
    }
  });

  it('accepts real dates including a leap day', () => {
    for (const good of ['2026-09-08', '2024-02-29', '2026-12-31']) {
      expect({ date: good, accepted: isoDate.safeParse(good).success }).toEqual({
        date: good,
        accepted: true,
      });
    }
  });

  it('rejects 2026-02-30 rather than silently answering about March 2', () => {
    // JavaScript rolls this over. The platform learned that in
    // quality/service.ts: the response echoed back a day nobody asked about.
    expect(new Date('2026-02-30T00:00:00.000Z').toISOString().slice(0, 10)).toBe('2026-03-02');
    expect(isoDate.safeParse('2026-02-30').success).toBe(false);
  });

  it('rejects a date far outside anything this platform can discuss', () => {
    // Not a format problem -- a typo or a hallucination. Letting it through
    // produces a confidently empty answer that reads like a real result.
    expect(plausibleDate.safeParse('1970-01-01').success).toBe(false);
    expect(plausibleDate.safeParse('2400-01-01').success).toBe(false);
    expect(plausibleDate.safeParse(`${new Date().getUTCFullYear()}-06-01`).success).toBe(true);
  });

  it('lets no tool declare its own date regex', () => {
    // A rule copied into fifteen schemas becomes fifteen slightly different
    // rules within a year. Asserted against the source.
    const { readFileSync, readdirSync } = require('node:fs') as typeof import('node:fs');
    const dir = 'src/modules/chatbot/tools/definitions';
    for (const file of readdirSync(dir)) {
      const source = readFileSync(`${dir}/${file}`, 'utf8');
      expect({ file, hasOwnRegex: /\\d\{4\}-\\d\{2\}-\\d\{2\}/.test(source) }).toEqual({
        file,
        hasOwnRegex: false,
      });
    }
  });
});

/**
 * RULE: resolve ambiguity before a consequential action. "Cancel the
 * reservation" with three active reservations must ask, never pick.
 */
describe('rule: ambiguity is refused, never guessed', () => {
  it('gives every context resolver an explicit AMBIGUOUS outcome', () => {
    const { readFileSync, readdirSync } = require('node:fs') as typeof import('node:fs');
    const dir = 'src/modules/chatbot/tools';
    const resolvers = readdirSync(dir).filter((f) => f.endsWith('-reference.ts'));

    // If a resolver file exists at all, it must be able to say "several
    // matched" -- a resolver that can only succeed or fail will pick one.
    expect(resolvers.length).toBeGreaterThan(0);
    for (const file of resolvers) {
      const source = readFileSync(`${dir}/${file}`, 'utf8');
      expect({ file, refusesAmbiguity: source.includes("'AMBIGUOUS'") }).toEqual({
        file,
        refusesAmbiguity: true,
      });
    }
  });

  it('never lets a resolver silently take the first of several matches', () => {
    const { readFileSync, readdirSync } = require('node:fs') as typeof import('node:fs');
    const dir = 'src/modules/chatbot/tools';
    for (const file of readdirSync(dir).filter((f) => f.endsWith('-reference.ts'))) {
      const source = readFileSync(`${dir}/${file}`, 'utf8');
      // Every resolver counts its matches and branches on more-than-one
      // before returning anything.
      expect({ file, guards: /length > 1|length !== 1/.test(source) }).toEqual({
        file,
        guards: true,
      });
    }
  });
});

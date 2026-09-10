import { describe, it, expect } from '@jest/globals';

/**
 * The quick chips: instant, and free of model tokens.
 *
 * TWO DEFECTS, both found on 2026-09-10 by looking at what a MANAGER sees.
 *
 * 1. There were no manager commands at all. All eight were a worker's own
 *    record -- payslips, contract, cleaned rooms -- so a hotel manager
 *    opening the assistant got chips for none of their work, and their three
 *    commonest questions ("who's on today", "who's clocked in", "who's off")
 *    each cost a model call and a second of latency to reach a tool that
 *    takes no arguments.
 *
 * 2. `commandManifest()` returned every command to everyone. That was
 *    harmless only while every command happened to be reachable by every
 *    role. Adding manager chips without filtering would have shown a cleaner
 *    a button whose only possible answer is "You do not have access to that".
 */

import {
  L0_COMMANDS,
  commandManifest,
  matchL0,
} from '../modules/chatbot/orchestrator/router-l0.js';
import { resolveTool, FORBIDDEN_ARG_KEYS } from '../modules/chatbot/tools/registry.js';
import { actorHasPermission } from '../modules/chatbot/tools/executor.js';
import { ROLE_PERMISSIONS } from '../config/constants.js';
import type { ActorContext } from '../modules/chatbot/tools/actor.js';
import '../modules/chatbot/service.js';

const as = (role: keyof typeof ROLE_PERMISSIONS): ActorContext =>
  ({
    userId: 'u1',
    role: role.toLowerCase(),
    permissions: ROLE_PERMISSIONS[role] ?? [],
    scope: null,
  }) as unknown as ActorContext;

describe('every command points at a tool that exists', () => {
  it.each(L0_COMMANDS.map((c) => [c.id, c.tool]))(
    '%s -> %s is registered',
    (_id, tool) => {
      expect(resolveTool(tool as string)).toBeDefined();
    }
  );

  /**
   * Arguments are FIXED in the source -- some commands legitimately carry one
   * (`my_upcoming_shifts` pins `status: CONFIRMED`). What matters is that
   * none of them is an authorization input: a chip must not be able to say
   * who it is acting for, any more than a model can.
   */
  it('never carries an argument that names a person, hotel or role', () => {
    for (const command of L0_COMMANDS) {
      for (const key of Object.keys(command.args)) {
        expect({ command: command.id, forbidden: (FORBIDDEN_ARG_KEYS as readonly string[]).includes(key) }).toEqual({
          command: command.id,
          forbidden: false,
        });
      }
    }
  });

  it('validates its fixed arguments against the tool it calls', () => {
    // A chip whose arguments the tool would reject is a button that fails on
    // tap -- and nothing else would catch it, since no user text is involved.
    for (const command of L0_COMMANDS) {
      const tool = resolveTool(command.tool)!;
      expect({ command: command.id, ok: tool.args.safeParse(command.args).success }).toEqual({
        command: command.id,
        ok: true,
      });
    }
  });
});

describe('the manifest offers only what the caller can use', () => {
  it('shows a manager the team chips', () => {
    const ids = commandManifest(as('MANAGER')).map((c) => c.id);
    expect(ids).toEqual(expect.arrayContaining(['team_today', 'team_clocked_in', 'team_off']));
  });

  /**
   * THE POINT OF THE FILTER. A cleaner must not be shown a button that can
   * only refuse them.
   */
  it('hides every manager chip from a worker', () => {
    const ids = commandManifest(as('WORKER')).map((c) => c.id);
    expect(ids).not.toContain('team_today');
    expect(ids).not.toContain('team_clocked_in');
    expect(ids).not.toContain('team_off');
  });

  it('still gives a worker their own chips, including hours', () => {
    const ids = commandManifest(as('WORKER')).map((c) => c.id);
    expect(ids).toEqual(expect.arrayContaining(['my_shifts', 'my_hours', 'my_payslips']));
  });

  /**
   * The filter must agree with the executor. If a chip is offered, the call
   * behind it has to pass the same permission check -- otherwise the button
   * and the boundary drift apart and the person meets the difference.
   */
  it('offers no chip whose tool the caller could not call', () => {
    for (const role of ['WORKER', 'CHECKER', 'MANAGER', 'ADMIN'] as const) {
      const actor = as(role);
      for (const entry of commandManifest(actor)) {
        const tool = resolveTool(entry.tool)!;
        // `actorHasPermission` is the executor's own check; using it here is
        // the point -- a different check could agree today and drift later.
        const allowed = tool.permission === null || actorHasPermission(actor, tool.permission);
        expect({ role, chip: entry.id, allowed }).toEqual({ role, chip: entry.id, allowed: true });
      }
    }
  });

  it('returns everything when no actor is given, as before', () => {
    expect(commandManifest().length).toBe(L0_COMMANDS.length);
  });
});

describe('the manager phrases resolve without a model', () => {
  it.each([
    ['who is working today', 'team_today'],
    ['wer arbeitet heute', 'team_today'],
    ['who has clocked in', 'team_clocked_in'],
    ['wer ist heute da', 'team_clocked_in'],
    ['who called in sick', 'team_off'],
    ['wer ist heute krank', 'team_off'],
    ['my hours', 'my_hours'],
    ['wie viele stunden habe ich gearbeitet', 'my_hours'],
  ])('"%s" resolves to %s', (phrase, id) => {
    expect(matchL0(phrase as string)?.id).toBe(id);
  });

  it('matches regardless of case and punctuation', () => {
    expect(matchL0('Who has clocked in?')?.id).toBe('team_clocked_in');
    expect(matchL0('  WER IST HEUTE KRANK  ')?.id).toBe('team_off');
  });

  /**
   * Conservative by design: a near-miss falls through to L1 rather than
   * answering a question nobody asked. "who is off on friday" is NOT
   * "who is off" -- it names a day this chip cannot honour.
   */
  it('falls through rather than guessing at a phrase with more in it', () => {
    expect(matchL0('who is off on friday')).toBeUndefined();
    expect(matchL0('who is working next week')).toBeUndefined();
  });
});

import { describe, it, expect } from '@jest/globals';

/**
 * Five defects found by a hotel manager using the assistant in production on
 * 2026-09-10, in one conversation. Each test below is that conversation's
 * actual failure, turned into something that cannot come back.
 *
 * The transcript, abridged:
 *
 *   > is there anyone working today?
 *   Which hotel? Please name it, since you cover more than one.
 *   > what are the options
 *   1. Use `assignments.list_for_my_team` ...
 *   > can you give me my hotel data for this month
 *   2 hotels: hotel_1_group_1 (abcd), Premier Inn Essen City Centre Hotel (essen).
 *   > for the firsst one
 *   2 hotels: hotel_1_group_1 (abcd), ...          <- same answer, four times
 *   > the name of worker is worker 1
 *   0 assignments rows from 2023-10-01 to 2023-10-31.   <- invented year
 *   > place the woker with naem worker 1 in hotel 1 today
 *   This will run: assignments.place_worker  hotel_name: hotel 1  day: 2023-04-10
 *   > Confirmed
 *   No hotel matching "hotel 1" is in your scope.   <- approved a fiction
 */

import { buildSystemPrompt, dateReference } from '../modules/chatbot/orchestrator/router-l1.js';
import { redactToolNames } from '../modules/chatbot/orchestrator/templates.js';
import { schemaKeys } from '../modules/chatbot/orchestrator/reference-precheck.js';
import { ROLE_PERMISSIONS } from '../config/constants.js';
import type { ActorContext } from '../modules/chatbot/tools/actor.js';

const manager = (): ActorContext =>
  ({
    userId: 'm1',
    role: 'manager',
    permissions: ROLE_PERMISSIONS.MANAGER ?? [],
    scope: null,
  }) as unknown as ActorContext;

/** Today in Europe/Berlin, computed the same way the prompt must. */
const berlinToday = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin' }).format(new Date());

describe('defect 1: the model was never told what day it is', () => {
  /**
   * The worst of the five, because nothing downstream can catch it:
   * `2023-10-01` is a well-formed date that passes every schema. Asked for
   * "this month" the assistant answered about October 2023, and asked to
   * place someone "today" it proposed 2023-04-10.
   */
  it('states today in the system prompt, in ISO form', () => {
    const prompt = buildSystemPrompt(manager(), []);
    expect(prompt).toContain(berlinToday());
  });

  it('carries a precomputed calendar rather than asking for arithmetic', () => {
    const prompt = buildSystemPrompt(manager(), []);
    expect(prompt).toMatch(/use these exact dates/i);
    expect(prompt).toMatch(/this week .* to /i);
    expect(prompt).toMatch(/never use another year/i);
  });

  /**
   * Europe/Berlin, not UTC -- the timezone every other date on this platform
   * is computed in. Between 23:00 and 00:00 Berlin time the two disagree, and
   * a night-shift manager would be told the wrong day.
   *
   * Asserted on the TABLE's own "today" entry, not on the absence of the UTC
   * string anywhere in the prompt: the table legitimately contains yesterday
   * and tomorrow, so "the prompt does not mention that date" was never the
   * property worth pinning and became false the moment the table existed.
   */
  it('uses Europe/Berlin for today, so a night shift is not a day out', () => {
    const prompt = buildSystemPrompt(manager(), []);
    expect(prompt).toContain(`today ${berlinToday()},`);
  });

  /**
   * THE ARITHMETIC ITSELF, on a fixed instant so it is the same every run.
   *
   * The model got these wrong in a way nothing downstream could catch: asked
   * "what about saturday" it answered with Friday's date, and "and last week"
   * with this week's -- valid dates, right format, wrong day. Precomputing
   * them moves the failure from a model behaviour into something a test can
   * hold still.
   *
   * 2026-09-09T20:00Z is a Wednesday in Berlin (22:00 local).
   */
  describe('the precomputed calendar', () => {
    const table = dateReference(new Date('2026-09-09T20:00:00Z'));

    it('names today, tomorrow and yesterday', () => {
      expect(table).toContain('today 2026-09-09, tomorrow 2026-09-10, yesterday 2026-09-08');
    });

    it('gives each of the next seven days its weekday, so "saturday" needs no counting', () => {
      expect(table).toContain('Saturday 2026-09-12');
      expect(table).toContain('Friday 2026-09-11');
    });

    /** Monday to Sunday: how weeks run in Germany, and how the rosters are drawn. */
    it('runs weeks Monday to Sunday', () => {
      expect(table).toContain('this week 2026-09-07 to 2026-09-13');
      expect(table).toContain('last week 2026-08-31 to 2026-09-06');
      expect(table).toContain('next week 2026-09-14 to 2026-09-20');
    });

    it('bounds this month and last month, including the month-length change', () => {
      expect(table).toContain('this month 2026-09-01 to 2026-09-30');
      expect(table).toContain('last month 2026-08-01 to 2026-08-31');
    });

    /**
     * Sunday is the off-by-one that Monday-start weeks invite: with
     * getUTCDay() === 0 a naive `1 - dow` lands on the Monday AFTER, making
     * "this week" the next one.
     */
    it('puts a Sunday in the week that is ending, not the one starting', () => {
      // 2026-09-13 is a Sunday.
      const sunday = dateReference(new Date('2026-09-13T10:00:00Z'));
      expect(sunday).toContain('this week 2026-09-07 to 2026-09-13');
      expect(sunday).toContain('next week 2026-09-14 to 2026-09-20');
    });

    it('crosses a year boundary without inventing a month', () => {
      const newYear = dateReference(new Date('2027-01-05T10:00:00Z'));
      expect(newYear).toContain('this month 2027-01-01 to 2027-01-31');
      expect(newYear).toContain('last month 2026-12-01 to 2026-12-31');
    });
  });
});

describe('defect 2: the manifest was recited to the user', () => {
  const TOOLS = ['assignments.list_for_my_team', 'attendance.team_status'];

  it('removes tool names from free model text', () => {
    const leaked =
      'To see who is working today:\n' +
      '1. Use `assignments.list_for_my_team` - shows all shifts scheduled.\n' +
      '2. Use `attendance.team_status` - shows who has checked in.';

    const out = redactToolNames(leaked, TOOLS);

    expect(out).not.toContain('assignments.list_for_my_team');
    expect(out).not.toContain('attendance.team_status');
  });

  it('strips the backticks with the name, leaving no empty code span', () => {
    expect(redactToolNames('Use `attendance.team_status` now', TOOLS)).not.toMatch(/``/);
  });

  /**
   * The dot in a tool name is a regex wildcard. Unescaped, the pattern for
   * `attendance.team_status` also matches "attendanceXteam_status" -- and,
   * worse, patterns for short names would start eating ordinary prose.
   */
  it('treats the dot as a literal, not a wildcard', () => {
    expect(redactToolNames('attendanceXteam_status', TOOLS)).toBe('attendanceXteam_status');
  });

  it('leaves ordinary answers untouched', () => {
    const normal = 'Three people are on shift today: Anna, Tomasz and Maria.';
    expect(redactToolNames(normal, TOOLS)).toBe(normal);
  });

  it('is safe on empty text', () => {
    expect(redactToolNames('', TOOLS)).toBe('');
  });

  /**
   * DELIBERATELY NOT SOLVED IN THE PROMPT, and this test exists so nobody
   * "fixes" that later without re-measuring.
   *
   * Three wordings of a prompt rule were tried against the live 54-case
   * routing suite: 49/54, 41/54 and 51/54, against 54/54 with no rule. The
   * failures were almost all `(none)` -- the model stopped calling tools,
   * because a tool call is the one place a tool name legitimately appears.
   *
   * Redaction gives the same guarantee without the model's cooperation, so
   * the prompt stays out of it.
   */
  it('does NOT spend a prompt rule on it -- redaction is the control', () => {
    const prompt = buildSystemPrompt(manager(), []);
    expect(prompt).not.toMatch(/never (show|write) .*tool/i);
  });
});

describe('defect 3: the assistant did not know which hotels the person covers', () => {
  it('lists them, numbered, so "the first one" has something to mean', () => {
    const prompt = buildSystemPrompt(manager(), [], {
      hotels: ['hotel_1_group_1', 'Premier Inn Essen City Centre Hotel'],
    });

    expect(prompt).toContain('1. hotel_1_group_1');
    expect(prompt).toContain('2. Premier Inn Essen City Centre Hotel');
    expect(prompt).toMatch(/the first one/i);
  });

  it('tells a single-hotel user\'s assistant never to ask which hotel', () => {
    const prompt = buildSystemPrompt(manager(), [], { hotels: ['Hotel Adler'] });
    expect(prompt).toMatch(/only one/i);
    expect(prompt).toContain('Hotel Adler');
  });

  it('says nothing at all when the list is unavailable', () => {
    // Must degrade to the old behaviour, not to a broken sentence.
    const prompt = buildSystemPrompt(manager(), [], { hotels: [] });
    expect(prompt).not.toMatch(/they cover these hotels/i);
    expect(prompt).not.toMatch(/undefined|\[object/i);
  });
});

describe('defect 4: every turn looked like the first one', () => {
  it('tells the model what it already ran, and not to repeat it', () => {
    const prompt = buildSystemPrompt(manager(), [], {
      hotels: [],
      lastAction: { tool: 'hotels.my_hotels', ok: true },
    });
    expect(prompt).toContain('hotels.my_hotels');
    expect(prompt).toMatch(/do not repeat it/i);
  });

  it('distinguishes an action that failed from one that worked', () => {
    const failed = buildSystemPrompt(manager(), [], {
      hotels: [],
      lastAction: { tool: 'reports.query_team', ok: false },
    });
    expect(failed).toMatch(/did not work/i);
  });

  /** The result itself must never reach a prompt (ADR-074 §5). */
  it('carries the label and outcome only -- never a result', () => {
    const prompt = buildSystemPrompt(manager(), [], {
      hotels: [],
      lastAction: { tool: 'hotels.my_hotels', ok: true },
    });
    expect(prompt).not.toMatch(/Premier Inn|abcd|rows/);
  });
});

describe('defect 5: schemaKeys reads the schema, not the arguments', () => {
  /**
   * The precheck must fire for an OPTIONAL `hotel_name` the model omitted --
   * the tool still resolves a hotel when it runs, so a confirmation built
   * without checking would still be a fiction. Reading the parsed arguments
   * instead of the schema would miss exactly that case.
   */
  it('finds an optional field that the caller omitted', async () => {
    const { z } = await import('zod');
    const schema = z
      .object({
        worker_name: z.string(),
        hotel_name: z.string().optional(),
      })
      .strict();

    expect(schemaKeys(schema).has('hotel_name')).toBe(true);
  });

  it('sees through a .refine(), which returns a ZodEffects not a ZodObject', async () => {
    const { z } = await import('zod');
    const schema = z
      .object({ hotel_name: z.string().optional(), kind: z.string() })
      .strict()
      .refine((d) => d.kind !== 'x' || Boolean(d.hotel_name), { message: 'needed' });

    // Without unwrapping, this returns an empty set and the precheck silently
    // stops running for every tool that validates across fields.
    expect(schemaKeys(schema).has('hotel_name')).toBe(true);
  });

  it('returns an empty set for a schema with no fields, rather than throwing', async () => {
    const { z } = await import('zod');
    expect(schemaKeys(z.object({}).strict()).size).toBe(0);
  });
});

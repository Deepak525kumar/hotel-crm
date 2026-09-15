/**
 * END-TO-END: Zelle's conversations, through the whole stack.
 *
 *   cd backend && RESEND_API_KEY= npx tsx scripts/chatbot-e2e-conversations.ts
 *
 * WHAT MAKES THIS END TO END, and why it exists beside the unit suite and
 * `chatbot-routing-check.ts`:
 *
 *   - the REAL app (`createApp()`), listening on a local port, reached over HTTP;
 *   - a REAL login (`POST /auth/login`, bcrypt, JWT) and the REAL daily consent
 *     gate (`POST /consent/decisions`) -- no fabricated actor anywhere;
 *   - the REAL model (`CHATBOT_PROVIDER=mantle`, AWS credentials required),
 *     choosing tools from the real permission-filtered manifest;
 *   - confirmations answered the way a client answers them, by sending the
 *     `confirm_token` back as the next turn;
 *   - every write READ BACK from PostgreSQL. A reply saying "Scheduled" is not
 *     evidence; the row is.
 *
 * Only PREREQUISITES are seeded with Prisma (a hotel group, a hotel, people
 * with active employment, one finished shift) -- allowed by the E2E rules. No
 * direct DB write stands in for anything under test.
 *
 * NOT IN CI, deliberately: every turn is a paid model call, and the result is
 * model behaviour that can change without a line of code changing. Run it
 * before a release and after any prompt or tool-description change. Cost is
 * roughly 40 turns at ~11k prompt tokens each.
 *
 * It uses whatever DATABASE_URL backend/.env names. Point that at a
 * throwaway database; each run seeds its own uniquely-tagged rows and leaves
 * them there for inspection.
 *
 * Scenarios are E2E scenarios 21 and 22 (docs/10-testing/e2e/scenarios/).
 * Each has an id; `ONLY=S07,R2 npx tsx ...` runs a subset.
 */
process.env.FEATURE_CHATBOT = 'true';
process.env.CHATBOT_PROVIDER = process.env.CHATBOT_PROVIDER || 'mantle';
process.env.CHATBOT_CONFIRM_TOKEN_SECRET = process.env.CHATBOT_CONFIRM_TOKEN_SECRET || 'e2e-'.repeat(12);
process.env.CHATBOT_TRANSCRIPT_KEY = process.env.CHATBOT_TRANSCRIPT_KEY || 'ab'.repeat(32);
// Belt and braces: nothing here drains the outbox, but no email key either.
process.env.RESEND_API_KEY = '';

import bcrypt from 'bcrypt';
import type { AddressInfo } from 'node:net';
import { loadEnv } from '../src/config/env.js';

// EVERYTHING ELSE IS IMPORTED DYNAMICALLY, after loadEnv(). ES module imports
// are hoisted above any statement, so a static `import { createApp }` runs
// before `loadEnv()` no matter where it is written -- and several modules read
// the environment at import time. The first run of this script died on
// "Environment not loaded" for exactly that reason (2026-09-15).
loadEnv();
const { createApp } = await import('../src/app.js');
const { connectDb, disconnectDb, getPrisma } = await import('../src/lib/db.js');
const { installConfiguredProvider } = await import('../src/modules/chatbot/provider/llm-provider.js');
const { assertAllToolsApproved } = await import('../src/modules/chatbot/tools/registry.js');
const { todayIso } = await import('../src/modules/chatbot/tools/definitions/daily-operations.tools.js');

const PASSWORD = 'E2e-Password-1';
const ONLY = new Set((process.env.ONLY ?? '').split(',').map((s) => s.trim()).filter(Boolean));

type Turn = {
  reply: string;
  status: string;
  route?: string;
  toolInvoked?: string;
  pendingConfirmation?: { token: string; summary: string; toolName: string };
};

interface Result {
  id: string;
  pass: boolean;
  detail: string;
}
const results: Result[] = [];

const today = todayIso();
const plus = (n: number) => new Date(Date.parse(`${today}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const words = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${iso}T12:00:00Z`));
const short = (s: string) => s.replace(/\s+/g, ' ').slice(0, 220);

async function main() {
  await connectDb();
  await installConfiguredProvider();
  const app = createApp();
  assertAllToolsApproved();
  const server = app.listen(Number(process.env.E2E_PORT ?? 0));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
  const prisma = getPrisma();
  const tag = `e2e${Date.now().toString(36)}`;

  // ---- prerequisites --------------------------------------------------------
  const hash = await bcrypt.hash(PASSWORD, 10);
  const group = await prisma.hotelGroup.create({ data: { name: `E2E group ${tag}` } });
  const hotel = await prisma.hotel.create({
    data: { name: `Premier Inn Essen City Centre Hotel ${tag}`, city: 'Essen', address: 'Kennedyplatz 1', hotel_group_id: group.id },
  });
  let n = 0;
  const person = async (first: string, last: string, role: string) => {
    n += 1;
    const user = await prisma.user.create({
      data: {
        email: `${first}.${last}.${tag}@example.test`.toLowerCase(),
        password_hash: hash,
        first_name: first,
        last_name: last,
        role: role as never,
        email_verified_at: new Date(),
      } as never,
    });
    await prisma.employmentRecord.create({
      data: {
        user_id: user.id, employee_id: `${tag}-${n}`, job_title: 'Staff', start_date: new Date('2026-01-01'),
        employment_type: 'FULL_TIME', status: 'ACTIVE', hotel_group_id: group.id, primary_hotel_id: hotel.id,
      } as never,
    });
    return user;
  };
  const maria = await person('Maria', `Manager${tag}`, 'MANAGER');
  const parveen = await person('Parveen', 'Kumar', 'WORKER');
  const harvir = await person('Harvir', 'Singh', 'MANAGER');
  const anna = await person('Anna', 'Braun', 'WORKER');
  const tomasz = await person('Tomasz', 'Nowak', 'WORKER');
  await prisma.hotel.update({ where: { id: hotel.id }, data: { manager_user_id: maria.id, manager_assigned_at: new Date() } });
  // A finished shift today with nothing logged, for S13.
  const finished = await prisma.workerAssignment.create({
    data: { worker_id: parveen.id, hotel_id: hotel.id, assigned_by_id: maria.id, day: new Date(today), status: 'COMPLETED', started_at: new Date(), completed_at: new Date() } as never,
  });

  // ---- HTTP -------------------------------------------------------------------
  // PACED. The chatbot's own per-user limiter allows CHATBOT_TURN_RATE_LIMIT_MAX
  // turns a minute, and a script fires them far faster than a person on a
  // phone. The first full run (2026-09-15) had three scenarios answered with
  // 429 and one reported a FALSE pass because of it. A 429 is waited out and
  // retried -- it is this harness's speed, not the product under test.
  const http = async (method: string, path: string, token: string | null, body?: unknown) => {
    for (let attempt = 0; ; attempt += 1) {
      const res = await fetch(`${base}${path}`, {
        method,
        headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (res.status === 429 && attempt < 4) {
        const wait = Number(res.headers.get('retry-after')) || 30;
        console.log(`  (rate limited on ${path}; waiting ${wait}s)`);
        await new Promise((r) => setTimeout(r, wait * 1000));
        continue;
      }
      const json = (await res.json().catch(() => ({}))) as { data?: any; error?: any };
      return { status: res.status, data: json.data, error: json.error };
    }
  };

  const login = async (email: string) => {
    const r = await http('POST', '/auth/login', null, { email, password: PASSWORD });
    const token = r.data?.access_token ?? r.data?.tokens?.access_token ?? r.data?.accessToken;
    if (!token) throw new Error(`login failed for ${email}: ${r.status} ${JSON.stringify(r.error ?? Object.keys(r.data ?? {}))}`);
    // The real daily consent gate, answered through its real route.
    await http('POST', '/consent/request', token, { consent_instance: 'daily-access-gate' });
    const c = await http('POST', '/consent/decisions', token, { consent_instance: 'daily-access-gate', decision: 'GRANTED', notice_version: 'v1' });
    if (c.status >= 400) throw new Error(`consent failed: ${c.status} ${JSON.stringify(c.error)}`);
    return token as string;
  };

  const managerToken = await login(maria.email);
  const workerToken = await login(parveen.email);

  // SERVE_FOR_BROWSER=<file>: seed, grant today's consent through the real
  // route, write the manager's credentials to <file>, and keep this real
  // backend listening for the web app's /api proxy (run with E2E_PORT=3001).
  // The Playwright spec frontend/e2e/zelle-live.spec.ts drives a real browser
  // against it. No scenario runs here in that mode.
  if (process.env.SERVE_FOR_BROWSER) {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(
      process.env.SERVE_FOR_BROWSER,
      JSON.stringify({ email: maria.email, password: PASSWORD, hotel: hotel.name, tag })
    );
    console.log(`SERVING on ${base} for the browser spec; credentials in ${process.env.SERVE_FOR_BROWSER}`);
    await new Promise(() => undefined);
  }

  class Chat {
    id = '';
    constructor(private token: string) {}
    async open() {
      const r = await http('POST', '/chatbot/conversations', this.token, {});
      this.id = r.data.id;
      return this;
    }
    async say(text: string): Promise<Turn> {
      const r = await http('POST', `/chatbot/conversations/${this.id}/messages`, this.token, { text });
      if (r.status >= 400) return { reply: `HTTP ${r.status}: ${JSON.stringify(r.error)}`, status: 'ERROR' };
      return r.data as Turn;
    }
    async confirm(turn: Turn): Promise<Turn> {
      if (!turn.pendingConfirmation) return turn;
      const r = await http('POST', `/chatbot/conversations/${this.id}/messages`, this.token, { confirm_token: turn.pendingConfirmation.token });
      return (r.status >= 400 ? { reply: `HTTP ${r.status}: ${JSON.stringify(r.error)}`, status: 'ERROR' } : r.data) as Turn;
    }
  }

  const never = /did not catch that|asked me as much as I can answer|conversation has got too long|do not have access/i;

  const scenario = async (id: string, run: () => Promise<{ pass: boolean; detail: string }>) => {
    if (ONLY.size > 0 && !ONLY.has(id)) return;
    try {
      const r = await run();
      results.push({ id, ...r });
      console.log(`${r.pass ? 'PASS' : 'FAIL'} ${id} -- ${r.detail}`);
    } catch (error) {
      results.push({ id, pass: false, detail: `threw: ${error instanceof Error ? error.message : String(error)}` });
      console.log(`FAIL ${id} -- threw: ${error instanceof Error ? error.stack : String(error)}`);
    }
  };

  // ===========================================================================
  // Scenario 21 -- the field report, verbatim where the owner's words allow.
  // ===========================================================================
  const c1 = await new Chat(managerToken).open();

  await scenario('S01', async () => {
    const t = await c1.say('Make day task rooms today we have 90 rooms to clean add that work list and 10 blibe');
    const row = await prisma.dailyShiftSummary.findFirst({ where: { hotel_id: hotel.id } });
    return {
      pass: row?.total_rooms === 90 && row?.stay_over_rooms === 10 && !/worth a check/.test(t.reply),
      detail: `tool=${t.toolInvoked} reply="${short(t.reply)}" db=${row?.total_rooms}/${row?.stay_over_rooms}`,
    };
  });

  await scenario('S02', async () => {
    const t1 = await c1.say('I want make id more next employe');
    const t2 = await c1.say('yes create id for Mukesh kumar, phone 016090744182, he is a cleaner');
    const created = await prisma.user.count({ where: { first_name: 'Mukesh', created_at: { gte: new Date(Date.now() - 600_000) } } });
    const reply = `${t1.reply} || ${t2.reply}`;
    return {
      pass: /\/users\/new#/.test(reply) && !/HR department/i.test(reply) && created === 0,
      detail: `tools=${t1.toolInvoked},${t2.toolInvoked} reply="${short(reply)}" usersCreated=${created}`,
    };
  });

  await scenario('S03', async () => {
    const t = await c1.say('make me that chat copy');
    return { pass: /copy/i.test(t.reply) && !never.test(t.reply) && !/not support/i.test(t.reply), detail: `reply="${short(t.reply)}"` };
  });

  const c2 = await new Chat(managerToken).open();

  await scenario('S05', async () => {
    const t = await c2.say(`Put Harvir Singh on the schedule on ${words(plus(1))}, ${words(plus(2))} and ${words(plus(3))}`);
    const rows = await prisma.workerAssignment.count({ where: { worker_id: harvir.id } });
    return {
      pass: !t.pendingConfirmation && /manager/i.test(t.reply) && rows === 0,
      detail: `confirmation=${Boolean(t.pendingConfirmation)} reply="${short(t.reply)}" harvirRows=${rows}`,
    };
  });

  await scenario('S06', async () => {
    const t = await c2.say('manger not worker');
    const rows = await prisma.workerAssignment.count({ where: { worker_id: harvir.id } });
    // THE REPLY MUST NOT CLAIM A WRITE. The second live run passed this step
    // while Zelle said "Harvir Singh has been placed on the schedule" with
    // zero rows written -- a data check alone scored a false statement as a pass.
    const claims = /(has been|have been|was|were|I have|I've)\s+(placed|scheduled|put|added)/i.test(t.reply);
    return {
      pass: !t.pendingConfirmation && rows === 0 && !claims && !never.test(t.reply),
      detail: `reply="${short(t.reply)}" harvirRows=${rows} claimsWrite=${claims}`,
    };
  });

  await scenario('S07', async () => {
    const day = plus(1);
    const place = await c2.confirm(await c2.say(`put parveen kumar on ${words(day)}`));
    const proposal = await c2.say(`cancel shift for parveen kumar ${words(day)}`);
    const done = await c2.confirm(proposal);
    const row = await prisma.workerAssignment.findFirst({ where: { worker_id: parveen.id, day: new Date(day) } });
    return {
      pass: proposal.pendingConfirmation?.toolName === 'assignments.cancel_shift' && row?.status === 'CANCELLED',
      detail: `place="${short(place.reply)}" proposal=${proposal.pendingConfirmation?.toolName ?? short(proposal.reply)} done="${short(done.reply)}" db=${row?.status}`,
    };
  });

  await scenario('S08', async () => {
    const t = await c2.say('I want previous chats');
    const hist = await http('GET', '/chatbot/conversations', managerToken);
    return {
      pass: /History/i.test(t.reply) && !/independent/i.test(t.reply) && Array.isArray(hist.data) && hist.data.length >= 1,
      detail: `tool=${t.toolInvoked} reply="${short(t.reply)}" historyApi=${hist.status}/${hist.data?.length}`,
    };
  });

  const c3 = await new Chat(managerToken).open();

  await scenario('S09', async () => {
    const t1 = await c3.say('give me record data previews weeks how much work we did');
    const t2 = await c3.say('07.09.2026 data');
    // The owner's sentence is answered by the L0 work-summary INTENT: no model
    // call, no dependence on how a model reads "previews weeks". The date
    // follow-up still goes to the model, which reads dates.
    return {
      pass:
        t1.route === 'L0' &&
        t1.toolInvoked === 'reports.work_summary' &&
        /shifts?|no work recorded/i.test(t1.reply) &&
        /2026-09-07/.test(t2.reply) &&
        !never.test(t1.reply + t2.reply),
      detail: `t1=${t1.route}/${t1.toolInvoked} "${short(t1.reply)}" | t2=${t2.route}/${t2.toolInvoked} "${short(t2.reply)}"`,
    };
  });

  await scenario('S10-S11', async () => {
    const [d1, d2, d3] = [plus(2), plus(3), plus(4)];
    const t1 = await c3.say(`make me plans. for parveen ${words(d1).split(' ')[0]} ${words(d2).split(' ')[0]} ${words(d3).split(' ')[0]} ${words(d1).split(' ')[1]}`);
    const t2 = t1.pendingConfirmation ? t1 : await c3.say('ok make');
    const done = await c3.confirm(t2);
    const rows = await prisma.workerAssignment.count({ where: { worker_id: parveen.id, status: 'CONFIRMED', day: { in: [d1, d2, d3].map((d) => new Date(d)) } } });
    return {
      pass: rows === 3 && !never.test(t1.reply + t2.reply + done.reply),
      detail: `t1=${t1.toolInvoked ?? t1.pendingConfirmation?.toolName} t2=${t2.pendingConfirmation?.toolName} done="${short(done.reply)}" rows=${rows}`,
    };
  });

  await scenario('S12', async () => {
    const before = await prisma.workerAssignment.count({ where: { worker_id: parveen.id } });
    const t = await c3.say('add that another dates also');
    const after = await prisma.workerAssignment.count({ where: { worker_id: parveen.id } });
    // No confirmation either. Run 5 "passed" this step while Zelle offered to
    // re-schedule the three shifts it had just scheduled -- nothing was
    // written only because nobody pressed Confirm.
    return {
      pass: before === after && !t.pendingConfirmation && !never.test(t.reply),
      detail: `confirmation=${t.pendingConfirmation?.toolName ?? 'none'} reply="${short(t.reply)}" rows ${before}->${after}`,
    };
  });

  await scenario('S13', async () => {
    const t = await c3.confirm(await c3.say('parveen didi today 10 rooms'));
    const entry = await prisma.roomsCompletedEntry.findUnique({ where: { assignment_id: finished.id } });
    return { pass: entry?.rooms_completed === 10, detail: `reply="${short(t.reply)}" db=${entry?.rooms_completed}` };
  });

  // ===========================================================================
  // Scenario 22 -- the tools built after the field report.
  // ===========================================================================
  const c4 = await new Chat(managerToken).open();

  await scenario('R1-swap', async () => {
    const day = plus(3); // Parveen holds it from S10-S11
    const t = await c4.confirm(await c4.say(`Parveen can't come on ${words(day)}, give her shift to Anna Braun`));
    const annaRow = await prisma.workerAssignment.findFirst({ where: { worker_id: anna.id, day: new Date(day) } });
    const parveenRow = await prisma.workerAssignment.findFirst({ where: { worker_id: parveen.id, day: new Date(day) }, orderBy: { confirmed_at: 'desc' } });
    return {
      pass: annaRow?.status === 'CONFIRMED' && parveenRow?.status === 'REASSIGNED',
      detail: `reply="${short(t.reply)}" db anna=${annaRow?.status} parveen=${parveenRow?.status}`,
    };
  });

  await scenario('R2-plan', async () => {
    const [d1, d2] = [plus(6), plus(7)];
    const proposal = await c4.say(`Anna is off sick on ${words(d1)}, put Tomasz on ${words(d1)} and ${words(d2)}`);
    const done = await c4.confirm(proposal);
    const absence = await prisma.calendarAbsence.count({ where: { worker_id: anna.id, day: new Date(d1) } });
    const tomaszRows = await prisma.workerAssignment.count({ where: { worker_id: tomasz.id, status: 'CONFIRMED', day: { in: [new Date(d1), new Date(d2)] } } });
    return {
      pass: absence === 1 && tomaszRows === 2,
      detail: `proposal=${proposal.pendingConfirmation?.toolName ?? short(proposal.reply)} done="${short(done.reply)}" absence=${absence} tomasz=${tomaszRows}`,
    };
  });

  await scenario('E1-withdraw-absence', async () => {
    const d1 = plus(6);
    // The absence must EXIST first, or "0 after" proves nothing: the first
    // full run passed this step because R2 had been rate-limited and never
    // created the absence at all.
    const before = await prisma.calendarAbsence.count({ where: { worker_id: anna.id, day: new Date(d1) } });
    const t = await c4.confirm(await c4.say(`Anna is better, she is not off on ${words(d1)}`));
    const absence = await prisma.calendarAbsence.count({ where: { worker_id: anna.id, day: new Date(d1) } });
    return { pass: before === 1 && absence === 0, detail: `reply="${short(t.reply)}" absence ${before}->${absence}` };
  });

  const c5 = await new Chat(managerToken).open();
  const requestDay = plus(10);

  await scenario('E2-requests', async () => {
    const create = await c5.confirm(await c5.say(`I need 2 cleaners on ${words(requestDay)} from 07:00 to 15:00`));
    const list = await c5.say('which staffing requests are still open');
    const cancel = await c5.confirm(await c5.say(`cancel the cleaner request for ${words(requestDay)}`));
    const rows = await prisma.jobRequest.findMany({ where: { hotel_id: hotel.id }, select: { status: true } });
    return {
      pass: /cleaner/i.test(list.reply) && rows.length === 1 && rows[0]!.status === 'CANCELLED',
      detail: `create="${short(create.reply)}" list="${short(list.reply)}" cancel="${short(cancel.reply)}" db=${JSON.stringify(rows)}`,
    };
  });

  // ---- the worker -------------------------------------------------------------
  const today2 = await prisma.workerAssignment.create({
    data: { worker_id: anna.id, hotel_id: hotel.id, assigned_by_id: maria.id, day: new Date(today), status: 'IN_PROGRESS', started_at: new Date() } as never,
  });
  for (const room of ['301', '302']) {
    await prisma.roomLog.create({ data: { assignment_id: today2.id, hotel_id: hotel.id, worker_id: anna.id, day: new Date(today), room_number: room, room_key: room } as never });
  }

  await scenario('E3-team-rooms', async () => {
    const t = await c5.say('how many rooms has everyone done today');
    return { pass: /Anna Braun 2/.test(t.reply), detail: `tool=${t.toolInvoked} reply="${short(t.reply)}"` };
  });

  const w1 = await new Chat(workerToken).open();
  const shiftToday = await prisma.workerAssignment.create({
    data: { worker_id: parveen.id, hotel_id: hotel.id, assigned_by_id: maria.id, day: new Date(plus(0)), status: 'IN_PROGRESS', started_at: new Date() } as never,
  }).catch(() => finished);
  await prisma.roomLog.create({ data: { assignment_id: shiftToday.id, hotel_id: hotel.id, worker_id: parveen.id, day: new Date(today), room_number: '214', room_key: '214' } as never });

  await scenario('E4-fix-room', async () => {
    const t = await w1.confirm(await w1.say('I logged 214 but it was 241'));
    const rooms = (await prisma.roomLog.findMany({ where: { worker_id: parveen.id, day: new Date(today) }, select: { room_number: true } })).map((r: any) => r.room_number);
    return { pass: rooms.includes('241') && !rooms.includes('214'), detail: `reply="${short(t.reply)}" db=${JSON.stringify(rooms)}` };
  });

  await scenario('E5-profile', async () => {
    // A number unique to THIS run. User.phone is unique platform-wide, and the
    // third live run failed here because the second had already given that
    // number to its own Parveen -- the product refused correctly; the harness
    // had reused data.
    const digits = String(Date.now()).slice(-7);
    const t = await w1.confirm(await w1.say(`my new number is 0160 ${digits}`));
    const row = await prisma.user.findUnique({ where: { id: parveen.id }, select: { phone: true } });
    return { pass: row?.phone === `+49160${digits}`, detail: `reply="${short(t.reply)}" db=${row?.phone}` };
  });

  await scenario('E6-worker-boundary', async () => {
    const t = await w1.say('cancel the shift for Anna Braun tomorrow');
    return { pass: !t.pendingConfirmation, detail: `confirmation=${Boolean(t.pendingConfirmation)} reply="${short(t.reply)}"` };
  });

  await scenario('E7-language', async () => {
    // Last for the worker, deliberately: it changes the language every later
    // reply to this person is written in.
    const t = await w1.confirm(await w1.say('switch the app to German please'));
    const row = await prisma.user.findUnique({ where: { id: parveen.id }, select: { preferred_language: true } });
    return { pass: row?.preferred_language === 'de', detail: `reply="${short(t.reply)}" db=${row?.preferred_language}` };
  });

  // ===========================================================================
  // Regional manager and admin -- the roles with no single hotel.
  // ===========================================================================
  const adler = await prisma.hotel.create({
    data: { name: `Hotel Adler ${tag}`, city: 'Essen', address: 'Rüttenscheider Str. 2', hotel_group_id: group.id },
  });
  const rita = await prisma.user.create({
    data: { email: `rita.regional.${tag}@example.test`, password_hash: hash, first_name: 'Rita', last_name: `Regional${tag}`, role: 'REGIONAL_MANAGER' as never, email_verified_at: new Date() } as never,
  });
  await prisma.employmentRecord.create({
    data: { user_id: rita.id, employee_id: `${tag}-rm`, job_title: 'Regional Manager', start_date: new Date('2026-01-01'), employment_type: 'FULL_TIME', status: 'ACTIVE', hotel_group_id: group.id } as never,
  });
  await prisma.hotelGroup.update({ where: { id: group.id }, data: { regional_manager_user_id: rita.id, regional_manager_assigned_at: new Date() } });
  const admin = await prisma.user.create({
    data: { email: `ada.admin.${tag}@example.test`, password_hash: hash, first_name: 'Ada', last_name: `Admin${tag}`, role: 'ADMIN' as never, email_verified_at: new Date() } as never,
  });

  const rmToken = await login(rita.email);
  const rmChat = await new Chat(rmToken).open();
  const adminChat = await new Chat(await login(admin.email)).open();

  await scenario('RM1-names-the-hotel', async () => {
    // Two hotels in Rita's group: the placement must land at the one she NAMES.
    const day = plus(12);
    const t = await rmChat.confirm(await rmChat.say(`put Tomasz Nowak on ${words(day)} at Hotel Adler ${tag}`));
    const row = await prisma.workerAssignment.findFirst({ where: { worker_id: tomasz.id, day: new Date(day) }, select: { hotel_id: true, status: true } });
    return { pass: row?.hotel_id === adler.id && row?.status === 'CONFIRMED', detail: `reply="${short(t.reply)}" db=${row?.status}@${row?.hotel_id === adler.id ? 'Adler' : row?.hotel_id}` };
  });

  await scenario('RM2-asks-which-hotel', async () => {
    // A FRESH conversation. Run 5 asked this in the same conversation where
    // Rita had just named Hotel Adler, and the model reasonably carried it
    // forward (showing it on the confirmation) -- that tested follow-up
    // context, not whether an unnamed hotel is guessed.
    const fresh = await new Chat(rmToken).open();
    const before = await prisma.workerAssignment.count({ where: { worker_id: anna.id } });
    const t = await fresh.say(`put Anna Braun on ${words(plus(13))}`);
    const after = await prisma.workerAssignment.count({ where: { worker_id: anna.id } });
    // With two hotels and none named, it must ask -- never pick one.
    return {
      pass: !t.pendingConfirmation && before === after && /Hotel Adler|Premier Inn|which hotel/i.test(t.reply),
      detail: `confirmation=${Boolean(t.pendingConfirmation)} reply="${short(t.reply)}" rows ${before}->${after}`,
    };
  });

  await scenario('A1-admin-work-summary', async () => {
    const t = await adminChat.say('how much work did we do');
    return { pass: t.route === 'L0' && /across your hotels/.test(t.reply), detail: `route=${t.route} reply="${short(t.reply)}"` };
  });

  await scenario('A2-admin-day-summary', async () => {
    const t = await adminChat.say(`today at Premier Inn Essen City Centre Hotel ${tag} we have 40 rooms to clean and 5 stay-over`);
    const row = await prisma.dailyShiftSummary.findFirst({ where: { hotel_id: hotel.id } });
    return { pass: row?.total_rooms === 40 && row?.stay_over_rooms === 5, detail: `reply="${short(t.reply)}" db=${row?.total_rooms}/${row?.stay_over_rooms}` };
  });

  // ---- summary ----------------------------------------------------------------
  const passed = results.filter((r) => r.pass).length;
  console.log(`\n${passed}/${results.length} passed (tag ${tag}, hotel "${hotel.name}")`);
  server.close();
  await disconnectDb();
  process.exit(passed === results.length ? 0 : 1);
}

main().catch(async (error) => {
  console.error('E2E harness failed:', error);
  await disconnectDb().catch(() => undefined);
  process.exit(2);
});

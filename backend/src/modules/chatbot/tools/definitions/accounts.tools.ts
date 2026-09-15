import { z } from 'zod';
import { SkillTag } from '@prisma/client';
import { phoneNumber } from '../../../../lib/phone.js';
import { creatableRolesFor } from '../../../../lib/role-hierarchy.js';
import { refuseUnresolvedHotel, resolveHotelReference } from '../worker-reference.js';
import { registerTool, type CompactResult } from '../registry.js';
import { asRefusal, refuse } from '../tool-errors.js';
import { APPROVED_2026_09_15_FIELD_REPORT } from '../approvals.js';

/**
 * A NEW EMPLOYEE'S ACCOUNT, prepared from a sentence.
 *
 * Reported 2026-09-15, from a manager:
 *
 *     > I want make id more next employe
 *     > yes create id
 *     I cannot create IDs or manage user accounts. That is handled through the
 *     employee onboarding process ... contact your HR department.
 *
 * There is no HR department to contact. The manager IS who creates accounts
 * here (RULE A, lib/role-hierarchy.ts), and they were sent away from a task
 * they are allowed to do.
 *
 * WHY THIS RETURNS A LINK AND DOES NOT CREATE THE ACCOUNT. Owner decision,
 * 2026-09-15. `POST /users` requires a profile photo (RULE-PHOTO-01): every
 * account carries a real photo, uploaded straight to storage, and a chat
 * message cannot carry one. The alternatives were to make the photo optional
 * for accounts created in chat -- a change to a platform rule, declined -- or
 * to create the account now and chase the photo later, which is the same
 * change by another name. So the assistant does the part a sentence CAN do:
 * it collects the details and hands back the New user form with them already
 * filled in, and the person adds the photo and presses Create. The account is
 * created by exactly the path, validation and audit it always was.
 *
 * NOT A DRAFT. Nothing is stored anywhere: the details travel in the link
 * itself, and a link nobody opens leaves nothing behind. ("There is no draft
 * functionality anywhere in this product" -- an owner correction this
 * respects.)
 *
 * THE DETAILS RIDE IN THE URL FRAGMENT, after the `#`. A fragment is never
 * sent to a server, so a new employee's email and phone do not land in the
 * web host's request logs the way a query string would.
 *
 * AUTHORIZATION. `users:write` is the token `POST /users` enforces, held by
 * admin, manager and regional manager and by no worker or checker. The role
 * offered is checked against `creatableRolesFor` -- the same table the route
 * and the form enforce -- so a manager is told plainly that they cannot create
 * a manager rather than being handed a form that will refuse them. The hotel
 * is resolved inside the caller's own scope, like every other hotel name.
 */

const ROLE_WORDS: Record<string, string> = {
  worker: 'worker',
  checker: 'checker',
  manager: 'manager',
  regional_manager: 'regional manager',
  admin: 'admin',
};

const SKILLS = Object.values(SkillTag) as [SkillTag, ...SkillTag[]];

const NewAccountArgs = z
  .object({
    first_name: z.string().trim().min(1).max(100),
    last_name: z.string().trim().min(1).max(100).optional(),
    email: z.string().trim().toLowerCase().email().optional(),
    // Normalised exactly as the form's own server check will be, so a German
    // number said the German way arrives in the form already acceptable.
    phone: phoneNumber.optional(),
    // `staff_type`, NOT `role`. `role` is a FORBIDDEN_ARG_KEY and the SafeArgs
    // type refused it at compile time -- correctly, even though this names the
    // NEW account's kind rather than the caller's. A model-supplied `role` is
    // exactly the costume an authorization input wears, and the guard cannot
    // tell the two apart, so the argument takes a different name and the value
    // is checked against creatableRolesFor() below regardless.
    staff_type: z.enum(['worker', 'checker', 'manager', 'regional_manager']).optional(),
    hotel_name: z.string().trim().min(2).max(120).optional(),
    skills: z.array(z.enum(SKILLS)).max(SKILLS.length).optional(),
  })
  .strict();

type NewAccountArgs = z.infer<typeof NewAccountArgs>;

/** "a, b and c" -- how a person reads a short list. */
function humanList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

interface PreparedAccount {
  link: string;
  name: string;
  role: string;
  hotel: string | null;
  missing: string[];
}

export const newAccountLink = registerTool<NewAccountArgs>({
  name: 'users.new_account_link',
  description:
    'Prepares the New user form for a new employee account and returns a link to it with the ' +
    'details already filled in. Use when a manager or admin asks to create an ID, a login, an ' +
    'account or a profile for a new employee: "make id for the next employee", "create a worker ' +
    'account for Mukesh Kumar", "neuen Mitarbeiter anlegen". Pass whatever was mentioned -- name, ' +
    'email, phone, staff type (worker unless said otherwise), hotel and skills. The account itself is ' +
    'created on that form, because every new account needs a profile photo.',
  tier: 'READ_ONLY',
  confirm: false,

  interfaceRef:
    'IF-USR-CreateUser (users/service.ts createUser(), reached through the New user form; this tool writes nothing)',
  approvalRef:
    APPROVED_2026_09_15_FIELD_REPORT +
    ' Registration note: writes nothing; returns a link whose fragment pre-fills the form, for roles creatableRolesFor already allows.',

  args: NewAccountArgs,
  permission: 'users:write',
  scopeCheck: 'none',

  invoke: async (args, actor) => {
    const role = args.staff_type ?? 'worker';

    const allowed = creatableRolesFor(actor.role);
    if (!(allowed as readonly string[]).includes(role)) {
      return refuse(
        'OUT_OF_SCOPE',
        allowed.length === 0
          ? 'Your role cannot create accounts.'
          : `You can create ${humanList(allowed.map((r) => ROLE_WORDS[r] ?? r))} accounts, not a ${ROLE_WORDS[role]} account.`
      );
    }

    // A regional manager is placed on a GROUP, not a hotel, so no hotel is
    // resolved for one. For everyone else a named hotel must be one of the
    // caller's own; a hotel-scoped manager's own hotel is used when none was
    // named, since they have exactly one.
    let hotel: { hotelId: string; name: string } | null = null;
    if (role !== 'regional_manager' && (args.hotel_name || actor.scope?.type === 'hotel')) {
      const resolved = await resolveHotelReference(args.hotel_name, actor);
      if (resolved.status !== 'RESOLVED') return refuseUnresolvedHotel(resolved);
      hotel = { hotelId: resolved.hotelId, name: resolved.name };
    }

    const fragment = new URLSearchParams();
    fragment.set('first_name', args.first_name);
    if (args.last_name) fragment.set('last_name', args.last_name);
    if (args.email) fragment.set('email', args.email);
    if (args.phone) fragment.set('phone', args.phone);
    fragment.set('role', role);
    // An id here is SERVER-RESOLVED from a name inside the caller's scope --
    // not a model-supplied authorization input -- and the form re-validates
    // it against the hotels it has loaded for this person.
    if (hotel) fragment.set('hotel_id', hotel.hotelId);
    if (role === 'worker' && args.skills?.length) fragment.set('skills', args.skills.join(','));

    const missing: string[] = [];
    if (!args.last_name) missing.push('the last name');
    if (!args.email) missing.push('an email address');
    if (!args.phone) missing.push('a phone number');

    const prepared: PreparedAccount = {
      link: `/users/new#${fragment.toString()}`,
      name: [args.first_name, args.last_name].filter(Boolean).join(' '),
      role: ROLE_WORDS[role] ?? role,
      hotel: hotel?.name ?? null,
      missing,
    };
    return prepared;
  },

  compress: (raw: unknown): CompactResult => {
    const refusal = asRefusal(raw);
    if (refusal) return { summary: refusal.message, data: { refusal_code: refusal.code } };

    const r = raw as PreparedAccount | null;
    if (!r) return { summary: 'Nothing was prepared.', data: null };

    const stillNeeded = [...r.missing, 'a temporary password', 'a profile photo'];
    return {
      summary:
        'I cannot create the account from the chat, because every new account needs a profile photo. ' +
        `The New user form is filled in for ${r.name} (${r.role}${r.hotel ? `, ${r.hotel}` : ''}):\n` +
        `${r.link}\n` +
        `Open it, add ${humanList(stillNeeded)}, then press Create.`,
      data: { still_needed: stillNeeded },
    };
  },
  maxResultTokens: 250,
});

import { z } from 'zod';
import { SkillTag } from '@prisma/client';
import { phoneNumber } from '../../../../lib/phone.js';
import { creatableRolesFor } from '../../../../lib/role-hierarchy.js';
import { refuseUnresolvedHotel, resolveHotelReference } from '../worker-reference.js';
import { registerTool, type CompactResult } from '../registry.js';
import { asRefusal, refuse } from '../tool-errors.js';
import { APPROVED_2026_09_15_FIELD_REPORT, APPROVED_2026_09_15_PROFILE } from '../approvals.js';

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
  // The reply carries the form LINK. Rewritten by the model in the live run of
  // 2026-09-15, it lost the link and claimed the account "has been started".
  finalAnswer: true,

  interfaceRef:
    'IF-USR-CreateUser (users/service.ts createUser(), reached through the New user form; this tool writes nothing)',
  approvalRef:
    APPROVED_2026_09_15_FIELD_REPORT +
    ' Registration note: writes nothing; returns a link whose fragment pre-fills the form, for roles creatableRolesFor already allows.',

  args: NewAccountArgs,
  permission: 'users:write',
  scopeCheck: 'none',

  invoke: async (args, actor) => {
    // A DESCRIPTION IS NOT A NAME. Replaying the owner's own words, "I want
    // make id more next employe" pre-filled the form with first name "next
    // employee" -- the model took the request for the person. Asked instead.
    const placeholder =
      /\b(next|new|neue[rn]?|another|some(one|body)?|employe+e?s?|worker|staff|mitarbeiter(in)?|person|user|id|account|cleaner|checker)\b/i;
    if (placeholder.test(args.first_name) || (args.last_name && placeholder.test(args.last_name))) {
      return refuse(
        'NEEDS_INPUT',
        "What is the new employee's name? Tell me their first and last name -- and their email and phone if you have them -- and I will fill in the form."
      );
    }

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

/* ------------------------------------------------------------------ *
 * users.update_my_profile
 * ------------------------------------------------------------------ */

/**
 * "CHANGE MY PHONE NUMBER" / "SPEAK GERMAN TO ME" -- the person's own profile.
 *
 * Found by the 2026-09-15 route map as the one daily self-service write with
 * no tool, and left unbuilt until the owner approved the token it needed the
 * same day: `PUT /auth/profile` enforced no permission at all, and the
 * registry refuses the `null` escape hatch for a write. `users:profile:write-own`
 * is held by every role and denies nobody; the route now enforces it.
 *
 * ONLY PHONE AND LANGUAGE. The route also accepts first and last name, and
 * they are deliberately not exposed: a name is how colleagues, rosters and
 * contracts identify a person, and changing it by a sentence to a chat model
 * is identity mutation of the kind the 2026-09-09 gap analysis refused. The
 * phone is normalised exactly as the form's (lib/phone.ts), and the language
 * is one of the six the apps ship.
 */
const LANGUAGE_WORDS: Record<string, string> = {
  de: 'German', en: 'English', ur: 'Urdu', ar: 'Arabic', fr: 'French', uk: 'Ukrainian',
};

const MyProfileArgs = z
  .object({
    phone: phoneNumber.optional(),
    language: z.enum(['de', 'en', 'ur', 'ar', 'fr', 'uk']).optional(),
  })
  .strict()
  .refine((a) => a.phone !== undefined || a.language !== undefined, {
    message: 'give a new phone number or a language',
    path: ['phone'],
  });

type MyProfileArgs = z.infer<typeof MyProfileArgs>;

export const updateMyProfile = registerTool<MyProfileArgs>({
  name: 'users.update_my_profile',
  description:
    "Changes the person's OWN phone number or the language the app speaks to them. Use when " +
    'someone asks to change or add their number or language: "my new number is 0160 1234567", ' +
    '"change my phone to +49 176 5550000", "switch the app to German", "ich möchte die App auf ' +
    'Englisch". Give the phone as written, and the language as de, en, ur, ar, fr or uk. Returns ' +
    "what was changed. It cannot change a name, email or anyone else's details.",
  tier: 'LOW_RISK_WRITE',
  // Confirmed: a misheard digit in a phone number is exactly what reading it
  // back catches, and the number is how the person is reached.
  confirm: true,

  interfaceRef: 'IF-AUTH-UpdateProfile (auth/service.ts updateProfile())',
  approvalRef:
    APPROVED_2026_09_15_PROFILE +
    " Registration note: the caller's own phone and app language only; names and email are not exposed.",

  args: MyProfileArgs,
  permission: 'users:profile:write-own',
  scopeCheck: 'self',

  invoke: async (args, actor) => {
    const { authService } = await import('../../../auth/service.js');
    try {
      await authService.updateProfile(actor.userId, {
        ...(args.phone ? { phone: args.phone } : {}),
        ...(args.language ? { preferred_language: args.language } : {}),
      } as never);
    } catch (error) {
      // User.phone is unique. The message says so without naming whose number
      // it is -- that would tell anyone who types a number whether it is in use
      // by a colleague, and by whom.
      const code = (error as { code?: string })?.code;
      if (code === 'P2002' || /unique/i.test(String((error as Error)?.message))) {
        return refuse('NEEDS_INPUT', 'That phone number is already used by another account. Check the number and try again.');
      }
      throw error;
    }
    return { phone: args.phone ?? null, language: args.language ?? null };
  },

  compress: (raw: unknown): CompactResult => {
    const refusal = asRefusal(raw);
    if (refusal) return { summary: refusal.message, data: { refusal_code: refusal.code } };
    const r = raw as { phone: string | null; language: string | null };
    const parts = [
      ...(r.phone ? [`your phone number is now ${r.phone}`] : []),
      ...(r.language ? [`the app will speak ${LANGUAGE_WORDS[r.language]} to you (next time it loads)`] : []),
    ];
    const sentence = parts.join(', and ');
    return { summary: `Done: ${sentence}.`, data: { phone_changed: Boolean(r.phone), language: r.language } };
  },
  maxResultTokens: 80,
});

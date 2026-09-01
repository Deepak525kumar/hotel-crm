import { z } from 'zod';

/**
 * Room-log request/response contracts (owner decision, 2026-09-01).
 *
 * There is deliberately no canonical Room catalogue in this platform: a room's
 * identity is (hotel_id, day, room_key), so "412" at two hotels can never
 * collide and a room cleaned again tomorrow is a new record. See RoomLog in
 * schema.prisma for the full rationale.
 */

// 32 is generous for a real room label ("Penthouse Suite 4" is 18) while still
// refusing a paragraph pasted into the field.
const ROOM_NUMBER_MAX = 32;

export const LogRoomSchema = z
  .object({
    room_number: z.string().trim().min(1, 'A room number is required').max(ROOM_NUMBER_MAX),
  })
  .strict();

export const UpdateRoomLogSchema = z
  .object({
    room_number: z.string().trim().min(1, 'A room number is required').max(ROOM_NUMBER_MAX),
  })
  .strict();

// `day` is optional everywhere: absent means "today" in every read path, which
// is the only day any of these screens actually ask for in practice.
export const ListRoomsQuerySchema = z.object({
  day: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'day must be YYYY-MM-DD')
    .optional(),
});

export const RoomPickerQuerySchema = z.object({
  day: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'day must be YYYY-MM-DD')
    .optional(),
  // Optional narrowing only -- it never widens what the caller may see. An
  // out-of-scope hotel_id yields a 403, not a silent empty list, so a checker
  // cannot probe other hotels' room activity by guessing ids.
  hotel_id: z.string().min(1).optional(),
});

export const RoomSuggestionsQuerySchema = z.object({
  hotel_id: z.string().min(1),
});

export type LogRoomRequest = z.infer<typeof LogRoomSchema>;
export type UpdateRoomLogRequest = z.infer<typeof UpdateRoomLogSchema>;
export type ListRoomsQuery = z.infer<typeof ListRoomsQuerySchema>;
export type RoomPickerQuery = z.infer<typeof RoomPickerQuerySchema>;
export type RoomSuggestionsQuery = z.infer<typeof RoomSuggestionsQuerySchema>;

/**
 * The collision key for the (hotel_id, day, room_key) unique constraint.
 *
 * Trim + upper-case ONLY (owner decision): "412 " is "412" and "412a" is
 * "412A", but "0412" stays a different room from "412". Anything more
 * aggressive -- stripping leading zeros, spaces or dashes -- would merge
 * genuinely distinct rooms at hotels that use "012" and "12" side by side,
 * and a wrong merge is unrecoverable (two workers' work collapses into one
 * record) whereas a missed merge is merely an extra row in a picker. The
 * worker's input offers a typeahead of room numbers already used at that
 * hotel, so spellings converge by suggestion rather than by lossy
 * normalisation.
 */
export function roomKey(roomNumber: string): string {
  return roomNumber.trim().toUpperCase();
}

/** The quality state of a logged room, derived (never stored) from its verification. */
export type RoomState =
  /** No inspection references this log yet. */
  | 'AWAITING_CHECK'
  /** Inspected and passed, with no rework history. */
  | 'PASSED'
  /** Sent back; the worker has not submitted their fix yet. */
  | 'NEEDS_REWORK'
  /**
   * Sent back, worker submitted their fix, auto-passed on submission (owner
   * decision, 2026-09-01). Surfaced to the checker as "review photos" so they
   * can reopen the room if the fix is not good enough.
   */
  | 'REWORK_SUBMITTED';

export interface RoomLogDto {
  id: string;
  assignment_id: string;
  hotel_id: string;
  hotel_name: string | null;
  worker_id: string;
  worker_name: string | null;
  day: string;
  room_number: string;
  state: RoomState;
  logged_at: string;
  /** Null until a checker inspects this room. */
  verification_id: string | null;
  score: number | null;
  /**
   * The rework assignment the worker must act on, when one is open. This is
   * what the worker's room tab links to ("Go to rework") -- the rework is a
   * separate WorkerAssignment (ADR-069), not a state on this one.
   */
  rework_assignment_id: string | null;
  /** True while the log is still the worker's to correct or remove. */
  editable: boolean;
}

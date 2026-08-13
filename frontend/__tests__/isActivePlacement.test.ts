import { isActivePlacement } from "@/lib/types";
import type { CalendarEntryDto } from "@/lib/types";

/**
 * The predicate every staffing count depends on.
 *
 * `listCalendarEntries` deliberately RETURNS cancelled placements so the grid
 * can render them struck-through instead of a shift silently vanishing. That
 * makes this the single guard stopping a cancelled placement from being
 * counted as real staffing — and it went missing once already: the cancelled
 * state was added to the grid only, while the range breakdown's "Placements"
 * and "Workers placed" tiles and the calendar-entry list kept counting
 * cancelled rows as staffed.
 */

const entry = (overrides: Partial<CalendarEntryDto> = {}): CalendarEntryDto => ({
  id: "ce1",
  assignment_id: "a1",
  worker_id: "w1",
  hotel_id: "h1",
  day: "2026-08-13",
  placed_by_id: "mgr1",
  created_at: "2026-08-01T00:00:00.000Z",
  updated_at: "2026-08-01T00:00:00.000Z",
  ...overrides,
});

describe("isActivePlacement", () => {
  it("excludes a cancelled placement", () => {
    expect(isActivePlacement(entry({ assignment_status: "CANCELLED" }))).toBe(false);
  });

  it.each(["CONFIRMED", "IN_PROGRESS", "COMPLETED", "NO_SHOW"] as const)(
    "counts a %s placement as active",
    (status) => {
      expect(isActivePlacement(entry({ assignment_status: status }))).toBe(true);
    },
  );

  // Responses predating the assignment_status field must keep their old
  // meaning rather than silently dropping out of every count.
  it("treats an entry with no assignment_status as active", () => {
    expect(isActivePlacement(entry())).toBe(true);
  });

  // NO_SHOW is deliberately active: the shift was staffed and the worker
  // failed to appear, which is a different fact from the shift not existing.
  // Counting it as unstaffed would hide the no-show from the manager.
  it("does not treat NO_SHOW as unstaffed", () => {
    expect(isActivePlacement(entry({ assignment_status: "NO_SHOW" }))).toBe(true);
  });
});

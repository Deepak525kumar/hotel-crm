import { isActivePlacement, placementAbsenceLabel } from "@/lib/types";
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

  it.each(["CONFIRMED", "IN_PROGRESS", "COMPLETED"] as const)(
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

  // A no-show means nobody worked the shift, so it must not read as staffed --
  // it is the case that most needs the manager's attention, and counting it as
  // covered hides exactly that.
  it("excludes a no-show", () => {
    expect(isActivePlacement(entry({ assignment_status: "NO_SHOW" }))).toBe(false);
  });
});

describe("placementAbsenceLabel", () => {
  it.each([
    ["CANCELLED", "Cancelled"],
    ["NO_SHOW", "No show"],
  ] as const)("labels %s as %s", (status, expected) => {
    expect(placementAbsenceLabel(entry({ assignment_status: status }))).toBe(expected);
  });

  // The two unstaffed states have different causes and must stay
  // distinguishable -- a cancellation was known in advance, a no-show was not.
  it("distinguishes a cancellation from a no-show", () => {
    expect(placementAbsenceLabel(entry({ assignment_status: "CANCELLED" }))).not.toBe(
      placementAbsenceLabel(entry({ assignment_status: "NO_SHOW" })),
    );
  });

  it.each(["CONFIRMED", "IN_PROGRESS", "COMPLETED"] as const)(
    "returns no label for a staffed %s placement",
    (status) => {
      expect(placementAbsenceLabel(entry({ assignment_status: status }))).toBeNull();
    },
  );

  it("returns no label when the status is absent entirely", () => {
    expect(placementAbsenceLabel(entry())).toBeNull();
  });
});

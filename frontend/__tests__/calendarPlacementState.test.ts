/**
 * Placement state helpers behind two calendar-grid affordances (2026-08-16):
 * completed shifts render green, and workers who cannot take a shift render
 * red in the placement picker.
 */
import {
  isActivePlacement,
  isCompletedPlacement,
  placementAbsenceLabel,
  workerDayConflict,
} from "@/lib/types";
import type { AssignmentStatus, CalendarAbsence, CalendarEntryDto } from "@/lib/types";

function entry(over: Partial<CalendarEntryDto> = {}): CalendarEntryDto {
  return {
    id: "e1",
    assignment_id: "a1",
    worker_id: "w1",
    hotel_id: "h1",
    day: "2026-08-16",
    placed_by_id: "m1",
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-01T00:00:00.000Z",
    ...over,
  };
}

function absence(over: Partial<CalendarAbsence> = {}): CalendarAbsence {
  return {
    id: "ab1",
    worker_id: "w1",
    day: "2026-08-16",
    kind: "SICK",
    reason: null,
    created_at: "2026-08-01T00:00:00.000Z",
    ...over,
  } as CalendarAbsence;
}

describe("isCompletedPlacement", () => {
  it("is true only for COMPLETED", () => {
    const statuses: AssignmentStatus[] = [
      "CONFIRMED",
      "IN_PROGRESS",
      "COMPLETED",
      "NO_SHOW",
      "CANCELLED",
    ];
    const completed = statuses.filter((s) => isCompletedPlacement(entry({ assignment_status: s })));
    expect(completed).toEqual(["COMPLETED"]);
  });

  // Entries from older responses carry no status at all. Those predate the
  // completion flow and must not render as worked.
  it("is false when the status is absent", () => {
    expect(isCompletedPlacement(entry())).toBe(false);
  });

  // The green tone must not change what the staffing counts include. A
  // completed shift was staffed and worked, so it stays an active placement;
  // collapsing the two predicates would drop finished shifts out of every
  // total on the page.
  it("does not make a completed placement inactive", () => {
    const done = entry({ assignment_status: "COMPLETED" });
    expect(isCompletedPlacement(done)).toBe(true);
    expect(isActivePlacement(done)).toBe(true);
    expect(placementAbsenceLabel(done)).toBeNull();
  });

  // Cancelled/no-show keep their own grey struck-through treatment; the grid
  // checks `cancelled` first, and these must never both be true.
  it("never overlaps the cancelled states", () => {
    for (const status of ["CANCELLED", "NO_SHOW"] as const) {
      const e = entry({ assignment_status: status });
      expect(isCompletedPlacement(e)).toBe(false);
      expect(placementAbsenceLabel(e)).not.toBeNull();
    }
  });
});

describe("workerDayConflict", () => {
  const DAY = "2026-08-16";

  it("returns null when the worker is free", () => {
    expect(workerDayConflict("w1", DAY, [], [])).toBeNull();
  });

  it("flags a sick day and a vacation day distinctly", () => {
    expect(workerDayConflict("w1", DAY, [], [absence({ kind: "SICK" })])).toBe("ABSENT_SICK");
    expect(workerDayConflict("w1", DAY, [], [absence({ kind: "VACATION" })])).toBe(
      "ABSENT_VACATION",
    );
  });

  it("flags a worker already placed that day", () => {
    expect(workerDayConflict("w1", DAY, [entry()], [])).toBe("ALREADY_PLACED");
  });

  // The case a manager is most likely to be fixing: cover was cancelled and
  // someone needs re-placing onto that day. Treating the dead placement as a
  // conflict would flag the very person they are trying to schedule.
  it("ignores cancelled and no-show placements", () => {
    for (const status of ["CANCELLED", "NO_SHOW"] as const) {
      expect(workerDayConflict("w1", DAY, [entry({ assignment_status: status })], [])).toBeNull();
    }
  });

  // A completed shift still occupies the day.
  it("still flags a completed placement as occupying the day", () => {
    expect(workerDayConflict("w1", DAY, [entry({ assignment_status: "COMPLETED" })], [])).toBe(
      "ALREADY_PLACED",
    );
  });

  it("only considers the day being staffed", () => {
    expect(workerDayConflict("w1", DAY, [entry({ day: "2026-08-17" })], [])).toBeNull();
    expect(workerDayConflict("w1", DAY, [], [absence({ day: "2026-08-17" })])).toBeNull();
  });

  it("only considers the worker being placed", () => {
    expect(workerDayConflict("w1", DAY, [entry({ worker_id: "w2" })], [])).toBeNull();
    expect(workerDayConflict("w1", DAY, [], [absence({ worker_id: "w2" })])).toBeNull();
  });

  // Absence is the more serious signal, so it wins over a stale placement --
  // a sick worker should read as sick, not as merely double-booked.
  it("prefers the absence reason when the worker is both absent and placed", () => {
    expect(workerDayConflict("w1", DAY, [entry()], [absence({ kind: "SICK" })])).toBe(
      "ABSENT_SICK",
    );
  });

  // Workers/checkers cannot read absences (403, handled in the hook), so the
  // picker degrades to double-booking detection rather than erroring.
  it("still detects double-booking with no absence data", () => {
    expect(workerDayConflict("w1", DAY, [entry()], [])).toBe("ALREADY_PLACED");
  });
});

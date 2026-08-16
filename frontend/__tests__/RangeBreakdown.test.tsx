import { render, screen } from "@testing-library/react";
import { RangeBreakdown } from "@/components/calendar/RangeBreakdown";
import { toDateKey } from "@/lib/calendar";
import type { CalendarAbsence, CalendarEntryDto } from "@/lib/types";
// Side-effect import: initialises i18next so `t()` resolves real copy rather
// than falling back to the raw key path (e.g. "calendar.placements" instead
// of "Placements", which these assertions search for literally).
import "@/lib/i18n";

/**
 * The staffing summary a manager reads to decide whether a day is covered.
 *
 * This component is where a real regression landed: `listCalendarEntries` was
 * changed to RETURN cancelled placements (so the grid could show them
 * struck-through rather than vanishing), but only the grid was updated to
 * understand them. These tiles kept counting a cancelled placement as staffed,
 * so a manager saw a shift as covered that nobody was working.
 *
 * The tests assert the RENDERED NUMBERS rather than the filter internals —
 * the wrong number on screen is the actual defect.
 */

const DAY = new Date("2026-08-13T00:00:00.000Z");
const KEY = toDateKey(DAY);

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

function renderBreakdown(entries: CalendarEntryDto[], absences: CalendarAbsence[] = []) {
  return render(
    <RangeBreakdown
      days={[DAY]}
      view="day"
      entriesByDay={new Map([[KEY, entries]])}
      absencesByDay={new Map([[KEY, absences]])}
      workerNameById={new Map([["w1", "Ada Lovelace"], ["w2", "Grace Hopper"]])}
      hotelNameById={new Map([["h1", "Northside Hotel"]])}
      loading={false}
      canSeeAbsences
      onSelectEntry={() => {}}
    />,
  );
}

/**
 * Reads the number rendered inside the StatTile with the given label.
 *
 * Scoped to the tile's own <p> label rather than any matching text: a label
 * like "Sick" also appears on the absence badge further down, so a plain text
 * query is ambiguous. StatTile renders the value in the <p> immediately after
 * the label.
 */
function tile(label: string): string {
  const labelNode = screen
    .getAllByText(label)
    .find((el) => el.tagName === "P" && el.className.includes("uppercase"));
  if (!labelNode) throw new Error(`stat tile "${label}" not found`);
  return labelNode.nextElementSibling?.textContent ?? "";
}

describe("RangeBreakdown staffing counts", () => {
  // A no-show means nobody worked the shift; it must not read as covered.
  it("does not count a no-show as staffing", () => {
    renderBreakdown([entry({ assignment_status: "NO_SHOW" })]);
    expect(tile("Placements")).toBe("0");
    expect(tile("Workers placed")).toBe("0");
  });

  it("counts an active placement", () => {
    renderBreakdown([entry({ assignment_status: "CONFIRMED" })]);
    expect(tile("Placements")).toBe("1");
    expect(tile("Workers placed")).toBe("1");
  });

  // The regression, stated directly.
  it("does not count a cancelled placement as staffing", () => {
    renderBreakdown([entry({ assignment_status: "CANCELLED" })]);
    expect(tile("Placements")).toBe("0");
    expect(tile("Workers placed")).toBe("0");
  });

  it("counts only the active ones when a day mixes both", () => {
    renderBreakdown([
      entry({ id: "ce1", worker_id: "w1", assignment_status: "CONFIRMED" }),
      entry({ id: "ce2", worker_id: "w2", assignment_status: "CANCELLED" }),
    ]);
    expect(tile("Placements")).toBe("1");
    expect(tile("Workers placed")).toBe("1");
  });

  // A worker whose only placement that day was cancelled is not "placed".
  it("excludes a worker whose sole placement was cancelled", () => {
    renderBreakdown([
      entry({ id: "ce1", worker_id: "w1", assignment_status: "CANCELLED" }),
      entry({ id: "ce2", worker_id: "w1", assignment_status: "CANCELLED" }),
    ]);
    expect(tile("Workers placed")).toBe("0");
  });

  it("does not list the hotel at all when its only placement is cancelled", () => {
    renderBreakdown([entry({ assignment_status: "CANCELLED" })]);
    expect(screen.queryByText("Northside Hotel")).not.toBeInTheDocument();
  });

  it("still lists the hotel when a live placement remains", () => {
    renderBreakdown([
      entry({ id: "ce1", worker_id: "w1", assignment_status: "CONFIRMED" }),
      entry({ id: "ce2", worker_id: "w2", assignment_status: "CANCELLED" }),
    ]);
    expect(screen.getByText("Northside Hotel")).toBeInTheDocument();
  });

  // An absence still makes the day worth showing even with no live placement —
  // "nobody is working and someone is off" is exactly what a manager needs.
  it("keeps a day visible when it has only a cancelled placement and an absence", () => {
    renderBreakdown(
      [entry({ assignment_status: "CANCELLED" })],
      [
        {
          id: "abs1",
          worker_id: "w1",
          day: "2026-08-13",
          kind: "SICK",
          reason: null,
          created_at: "2026-08-01T00:00:00.000Z",
          updated_at: "2026-08-01T00:00:00.000Z",
        } as CalendarAbsence,
      ],
    );
    expect(tile("Sick")).toBe("1");
    expect(tile("Placements")).toBe("0");
  });
});

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AbsencesCard } from "@/components/calendar/AbsencesCard";
import { useOwnAbsences } from "@/hooks/useCalendar";
import { ApiError, calendarApi } from "@/lib/api";
import { localToday } from "@/lib/format";
import type { CalendarAbsence } from "@/lib/types";
// Side-effect import: initialises i18next so `t()` resolves real copy rather
// than falling back to the raw key path. Most existing assertions here only
// happened to still pass against an uninitialised `t()` because their regex
// (e.g. /withdraw/i) matched a substring of the key itself (jobs.withdraw);
// the empty-state assertion below does not share that coincidence.
import "@/lib/i18n";

/**
 * A worker's own absences, and withdrawing one.
 *
 * The withdraw path is the interesting half: the backend rejects withdrawing a
 * PAST absence, so offering the button there produces a guaranteed error. That
 * boundary is a date comparison, which is exactly the kind of thing that breaks
 * quietly and is invisible to a type-check.
 */

jest.mock("@/hooks/useCalendar", () => ({ useOwnAbsences: jest.fn() }));
// ApiError is kept REAL: useAsyncAction surfaces a message only for an
// ApiError and falls back to a generic string for anything else, so a test
// that rejected with a plain Error would assert against the fallback and prove
// nothing about the backend's message reaching the user.
jest.mock("@/lib/api", () => ({
  ...jest.requireActual("@/lib/api"),
  calendarApi: { deleteAbsence: jest.fn(), markOwnAbsence: jest.fn() },
}));
jest.mock("swr", () => ({ mutate: jest.fn() }));

const mockUseOwnAbsences = useOwnAbsences as jest.MockedFunction<typeof useOwnAbsences>;
const mockDelete = calendarApi.deleteAbsence as jest.MockedFunction<typeof calendarApi.deleteAbsence>;

const absence = (overrides: Partial<CalendarAbsence> = {}): CalendarAbsence =>
  ({
    id: "abs1",
    worker_id: "w1",
    day: "2099-01-01",
    kind: "SICK",
    reason: null,
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-01T00:00:00.000Z",
    ...overrides,
  }) as CalendarAbsence;

function show(absences: CalendarAbsence[]) {
  mockUseOwnAbsences.mockReturnValue({
    data: absences,
    isLoading: false,
    error: undefined,
  } as ReturnType<typeof useOwnAbsences>);
  return render(<AbsencesCard />);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockDelete.mockResolvedValue(undefined as never);
});

describe("AbsencesCard withdraw", () => {
  it("offers Withdraw on a future absence", () => {
    show([absence({ day: "2099-01-01" })]);
    expect(screen.getByRole("button", { name: /withdraw/i })).toBeInTheDocument();
  });

  // The backend refuses this, so a button here could only ever error.
  it("does not offer Withdraw on a past absence", () => {
    show([absence({ day: "2000-01-01" })]);
    expect(screen.queryByRole("button", { name: /withdraw/i })).not.toBeInTheDocument();
  });

  // Today is withdrawable — the backend's rule is "not in the past", and an
  // off-by-one here would strand a worker who recovered the same morning.
  it("offers Withdraw on today", () => {
    show([absence({ day: localToday() })]);
    expect(screen.getByRole("button", { name: /withdraw/i })).toBeInTheDocument();
  });

  it("calls the API with that absence's id", async () => {
    show([absence({ id: "abs-42", day: "2099-01-01" })]);

    await userEvent.click(screen.getByRole("button", { name: /withdraw/i }));

    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith("abs-42"));
  });

  it("surfaces a backend rejection instead of silently doing nothing", async () => {
    mockDelete.mockRejectedValue(
      new ApiError(409, "CONFLICT", "Cannot delete an absence in the past"),
    );
    show([absence({ day: "2099-01-01" })]);

    await userEvent.click(screen.getByRole("button", { name: /withdraw/i }));

    expect(
      await screen.findByText(/cannot delete an absence in the past/i),
    ).toBeInTheDocument();
  });

  it("renders one Withdraw per future absence, not one for the whole list", () => {
    show([
      absence({ id: "a1", day: "2099-01-01" }),
      absence({ id: "a2", day: "2099-01-02" }),
      absence({ id: "a3", day: "2000-01-01" }),
    ]);
    expect(screen.getAllByRole("button", { name: /withdraw/i })).toHaveLength(2);
  });

  it("shows the empty state when there are no absences", () => {
    show([]);
    expect(screen.getByText(/no absences recorded/i)).toBeInTheDocument();
  });
});

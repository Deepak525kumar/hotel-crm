import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CalendarGridPage from "@/app/(protected)/calendar/page";
import { useCalendarEntriesInRange } from "@/hooks/useAssignments";
import { useAbsencesInRange, useOwnAbsences } from "@/hooks/useCalendar";
import { useAuth } from "@/hooks/useAuth";
import { useHotelOptions, useHotelOptionsInGroup } from "@/hooks/useWorkRequests";
import { useHotelGroups, useUserOptions, useShiftWorkerOptions, useUsersByIds } from "@/hooks/useHotels";
import { useAuthStore } from "@/stores/auth";
// Side-effect import: initialises i18next so `t()` resolves real copy rather
// than echoing key paths. Relying on a transitive import chain for this is
// fragile -- it is what let these assertions bake in raw keys originally.
import "@/lib/i18n";
import type { AuthUser, CalendarAbsence, CalendarEntryDto } from "@/lib/types";

/**
 * The two calendar affordances added 2026-08-16, asserted through the
 * rendered grid rather than through their helpers alone (those are covered by
 * calendarPlacementState.test.ts):
 *
 *   1. a COMPLETED shift renders green, not blue;
 *   2. a worker who cannot take a shift renders red in the placement picker.
 *
 * Rendering is what actually ships, and the wiring between helper and class
 * name is exactly the part a type-check cannot see.
 */

jest.mock("@/hooks/useAssignments", () => ({
  useCalendarEntriesInRange: jest.fn(),
  useAssignment: jest.fn(() => ({ assignment: null, isLoading: false })),
}));
jest.mock("@/hooks/useCalendar", () => ({
  useAbsencesInRange: jest.fn(),
  useOwnAbsences: jest.fn(() => ({ data: [], isLoading: false })),
}));
jest.mock("@/hooks/useAuth", () => ({ useAuth: jest.fn() }));
jest.mock("@/hooks/useWorkRequests", () => ({
  useHotelOptions: jest.fn(),
  useHotelOptionsInGroup: jest.fn(() => ({ hotels: [] })),
}));
jest.mock("@/hooks/useHotels", () => ({
  useHotelGroups: jest.fn(() => ({ groups: [] })),
  useUserOptions: jest.fn(),
  // The picker now sources candidates from useShiftWorkerOptions (worker +
  // checker, merged) rather than calling useUserOptions({role:"worker"})
  // directly -- kept a separate mock, driven identically to useUserOptions
  // below, so this test does not silently assert against a hook the
  // component no longer calls.
  useShiftWorkerOptions: jest.fn(),
  useUsersByIds: jest.fn(() => new Map()),
}));
jest.mock("swr", () => ({ mutate: jest.fn() }));

const mockEntries = useCalendarEntriesInRange as jest.Mock;
const mockAbsences = useAbsencesInRange as jest.Mock;
const mockAuth = useAuth as jest.Mock;
const mockHotels = useHotelOptions as jest.Mock;
const mockUsers = useUserOptions as jest.Mock;
const mockShiftWorkers = useShiftWorkerOptions as jest.Mock;
const mockUsersByIds = useUsersByIds as jest.Mock;
const mockGroupHotels = useHotelOptionsInGroup as jest.Mock;

/** Today, in the same local-date form the grid keys days by. */
function todayKey(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const DAY = todayKey();

function entry(over: Partial<CalendarEntryDto> = {}): CalendarEntryDto {
  return {
    id: "e1",
    assignment_id: "a1",
    worker_id: "w1",
    hotel_id: "h1",
    day: DAY,
    placed_by_id: "m1",
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-01T00:00:00.000Z",
    ...over,
  };
}

const MANAGER = {
  id: "m1",
  email: "mia@test.local",
  first_name: "Mia",
  last_name: "Manager",
  role: "manager",
  permissions: ["staffing:write"],
  is_active: true,
  scope_hotel_id: "h1",
  scope_hotel_group_id: "g1",
} as unknown as AuthUser;

beforeEach(() => {
  jest.clearAllMocks();
  // RoleGate (and so StaffingWriteGate, which guards the add-entry button)
  // reads the zustand store directly rather than the useAuth hook -- seeding
  // the real store is what actually renders the control under test.
  useAuthStore.setState({ user: MANAGER, status: "authenticated" });
  mockAuth.mockReturnValue({ user: MANAGER });
  mockEntries.mockReturnValue({ data: [], isLoading: false, error: null });
  mockAbsences.mockReturnValue({ data: [], isLoading: false });
  mockHotels.mockReturnValue({ hotels: [{ id: "h1", name: "Grand Hotel" }], isLoading: false });
  mockGroupHotels.mockReturnValue({ hotels: [{ id: "h1", name: "Grand Hotel" }] });
  mockUsers.mockReturnValue({ users: [], isLoading: false });
  mockShiftWorkers.mockReturnValue({ users: [], isLoading: false });
  mockUsersByIds.mockReturnValue(
    new Map([["w1", { id: "w1", first_name: "Wanda", last_name: "Worker" }]]),
  );
});

describe("completed shifts on the grid", () => {
  it("renders a completed placement green rather than blue", () => {
    mockEntries.mockReturnValue({
      data: [entry({ assignment_status: "COMPLETED" })],
      isLoading: false,
      error: null,
    });
    render(<CalendarGridPage />);

    const chip = screen.getAllByRole("button", { name: /Wanda Worker/ })[0];
    expect(chip.className).toMatch(/bg-green-50/);
    expect(chip.className).not.toMatch(/bg-blue-50/);
  });

  it("labels the state in text, not colour alone", () => {
    mockEntries.mockReturnValue({
      data: [entry({ assignment_status: "COMPLETED" })],
      isLoading: false,
      error: null,
    });
    render(<CalendarGridPage />);

    const chip = screen.getAllByRole("button", { name: /Wanda Worker/ })[0];
    expect(within(chip).getByText(/Completed/i)).toBeInTheDocument();
  });

  it("leaves an upcoming placement blue", () => {
    mockEntries.mockReturnValue({
      data: [entry({ assignment_status: "CONFIRMED" })],
      isLoading: false,
      error: null,
    });
    render(<CalendarGridPage />);

    const chip = screen.getAllByRole("button", { name: /Wanda Worker/ })[0];
    expect(chip.className).toMatch(/bg-blue-50/);
    expect(chip.className).not.toMatch(/bg-green-50/);
  });

  // Cancelled must keep winning: a green chip on a shift nobody worked would
  // be an outright lie about the day's cover.
  it("keeps a cancelled placement grey and struck through", () => {
    mockEntries.mockReturnValue({
      data: [entry({ assignment_status: "CANCELLED" })],
      isLoading: false,
      error: null,
    });
    render(<CalendarGridPage />);

    const chip = screen.getAllByRole("button", { name: /Wanda Worker/ })[0];
    expect(chip.className).toMatch(/line-through/);
    expect(chip.className).not.toMatch(/bg-green-50/);
  });
});

describe("unavailable workers in the placement picker", () => {
  async function openPickerWith(
    workers: Array<{ id: string; first_name: string; last_name: string; email: string }>,
    entries: CalendarEntryDto[] = [],
    absences: CalendarAbsence[] = [],
  ) {
    mockUsers.mockReturnValue({ users: workers, isLoading: false });
    mockShiftWorkers.mockReturnValue({ users: workers, isLoading: false });
    mockEntries.mockReturnValue({ data: entries, isLoading: false, error: null });
    mockAbsences.mockReturnValue({ data: absences, isLoading: false });

    render(<CalendarGridPage />);
    await userEvent.click(
      screen.getByRole("button", { name: `Add calendar entry for ${DAY}` }),
    );
    const dialog = await screen.findByRole("dialog");
    // The worker list only renders once a hotel is chosen -- the picker is
    // scoped to workers eligible for that hotel.
    await userEvent.selectOptions(within(dialog).getByLabelText(/hotel/i), "h1");
    return dialog;
  }

  const WORKERS = [
    { id: "w1", first_name: "Wanda", last_name: "Worker", email: "wanda@test.local" },
    { id: "w2", first_name: "Free", last_name: "Person", email: "free@test.local" },
  ];

  it("marks a worker already placed that day in red, and leaves a free worker plain", async () => {
    const dialog = await openPickerWith(WORKERS, [entry({ worker_id: "w1" })]);

    const busy = within(dialog).getByRole("button", { name: /Wanda Worker/ });
    const free = within(dialog).getByRole("button", { name: /Free Person/ });
    expect(busy.className).toMatch(/bg-red-50/);
    expect(free.className).not.toMatch(/bg-red-50/);
  });

  // The reason must be carried in TEXT, not colour alone -- red is unreadable
  // for a red/green-colourblind manager.
  //
  // These assertions previously expected the raw key path
  // ("assignments.conflictAlreadyPlaced"), because i18next happened not to be
  // initialised in this render and an uninitialised `t()` echoes its key.
  // That made the test pass on output a user must never see. i18next is now
  // initialised here (via the `@/lib/i18n` side-effect import below, matching
  // the other component tests in this suite), so these assert the copy a
  // manager actually reads. Key parity across all six locales stays covered
  // by locales.test.ts.
  it("spells out the reason rather than relying on colour", async () => {
    const dialog = await openPickerWith(WORKERS, [entry({ worker_id: "w1" })]);

    const busy = within(dialog).getByRole("button", { name: /Wanda Worker/ });
    const describedBy = busy.getAttribute("aria-describedby");
    expect(describedBy).toBe("worker-conflict-w1");

    const reason = document.getElementById(describedBy!);
    expect(reason).not.toBeNull();
    expect(reason!.textContent).toBe("Already placed this day");
  });

  it("distinguishes a sick day from a double-booking", async () => {
    const dialog = await openPickerWith(WORKERS, [], [
      {
        id: "ab1",
        worker_id: "w1",
        day: DAY,
        kind: "SICK",
        reason: null,
        created_at: "2026-08-01T00:00:00.000Z",
      } as unknown as CalendarAbsence,
    ]);

    const busy = within(dialog).getByRole("button", { name: /Wanda Worker/ });
    expect(busy.className).toMatch(/bg-red-50/);
    expect(document.getElementById("worker-conflict-w1")!.textContent).toBe(
      "Sick leave",
    );
  });

  // A warning, not a veto: the backend is the authority, and a manager may
  // legitimately place someone the client believes is busy.
  it("keeps an unavailable worker selectable", async () => {
    const dialog = await openPickerWith(WORKERS, [entry({ worker_id: "w1" })]);

    const busy = within(dialog).getByRole("button", { name: /Wanda Worker/ });
    expect(busy).not.toBeDisabled();
  });

  it("does not flag anyone when every worker is free", async () => {
    const dialog = await openPickerWith(WORKERS);

    for (const name of [/Wanda Worker/, /Free Person/]) {
      expect(within(dialog).getByRole("button", { name }).className).not.toMatch(/bg-red-50/);
    }
  });
});

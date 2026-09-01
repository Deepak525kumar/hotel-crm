import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import RoomsPage from "@/app/(protected)/rooms/page";
import { useAssignments } from "@/hooks/useAssignments";
import { useHotel } from "@/hooks/useHotels";
import { useMyRooms, useRoomSuggestions } from "@/hooks/useRooms";
import { useAuthStore } from "@/stores/auth";
import type { AuthUser, Role, RoomLog } from "@/lib/types";
// Side-effect import: initialises i18next so `t()` resolves real copy rather
// than raw key paths -- this test asserts on rendered TEXT.
import i18n from "@/lib/i18n";

/**
 * The worker's room log (owner decision, 2026-09-01), web parity with the
 * mobile Rooms tab.
 *
 * Three behaviours are pinned here because each of them is a rule the server
 * also enforces, and getting them wrong on the client means offering an action
 * that can only fail:
 *
 *   1. `editable` false => no edit/remove affordance at all. The server 409s
 *      once a room has been inspected, and discovering that by pressing a
 *      button is not a state, it is a dead end.
 *   2. A room sent back links to the REWORK SHIFT (a separate assignment,
 *      ADR-069), not back to itself.
 *   3. The log input needs a shift, and the fallback for a worker who has
 *      already checked out comes from a room the SERVER dated today -- there
 *      is no client-side date arithmetic to get wrong, and none is allowed
 *      (the server's day is Europe/Berlin).
 */

jest.mock("@/hooks/useRooms", () => ({
  useMyRooms: jest.fn(),
  useRoomSuggestions: jest.fn(),
}));
jest.mock("@/hooks/useAssignments", () => ({
  useAssignments: jest.fn(),
}));
jest.mock("@/hooks/useHotels", () => ({
  useHotel: jest.fn(),
}));

const mockMyRooms = useMyRooms as jest.Mock;
const mockSuggestions = useRoomSuggestions as jest.Mock;
const mockAssignments = useAssignments as jest.Mock;
const mockHotel = useHotel as jest.Mock;

function roomOf(overrides: Partial<RoomLog> = {}): RoomLog {
  return {
    id: "rl1",
    assignment_id: "a1",
    hotel_id: "h1",
    hotel_name: "Grand Hotel",
    worker_id: "w1",
    worker_name: "Ana Petrova",
    day: "2026-09-01",
    room_number: "412",
    state: "AWAITING_CHECK",
    logged_at: "2026-09-01T08:00:00.000Z",
    verification_id: null,
    score: null,
    rework_assignment_id: null,
    editable: true,
    ...overrides,
  };
}

import { todayKeyInCalendarTimezone } from "@/lib/calendar";

const TODAY = todayKeyInCalendarTimezone();
const THREE_DAYS_AGO = "2020-01-01"; // Any day that is not today

function signIn(role: Role) {
  useAuthStore.setState({
    user: { id: "w1", email: "w@x.de", first_name: "Ana", last_name: "P", role } as AuthUser,
    status: "authenticated",
  });
}

beforeAll(async () => {
  await i18n.changeLanguage("en");
});

beforeEach(() => {
  jest.clearAllMocks();
  mockMyRooms.mockReturnValue({
    data: { rooms: [], needs_rework: [] },
    isLoading: false,
    error: undefined,
    mutate: jest.fn(),
  });
  mockSuggestions.mockReturnValue({ data: undefined });
  mockAssignments.mockReturnValue({ assignments: [], isLoading: false });
  mockHotel.mockReturnValue({ data: undefined });
  signIn("worker");
});

describe("worker rooms page", () => {
  it("offers the log input for the shift the worker is checked into", () => {
    mockAssignments.mockReturnValue({
      assignments: [
        { id: "a1", hotel_id: "h1", rework_of_assignment_id: null, day: TODAY },
      ],
      isLoading: false,
    });
    mockHotel.mockReturnValue({ data: { id: "h1", name: "Grand Hotel" } });

    render(<RoomsPage />);

    expect(screen.getByLabelText("Room number")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add" })).toBeInTheDocument();
    expect(screen.getByText("Grand Hotel")).toBeInTheDocument();
    expect(screen.queryByText(/Check in to today/)).not.toBeInTheDocument();
  });

  // Rooms belong to the ORIGINAL shift: the server 400s a rework shift, and
  // logging here would put the same room in the checker's picker twice.
  it("does not offer the input when the only shift is a rework shift", () => {
    mockAssignments.mockReturnValue({
      assignments: [
        { id: "rw1", hotel_id: "h1", rework_of_assignment_id: "a1", day: TODAY },
      ],
      isLoading: false,
    });

    render(<RoomsPage />);

    expect(screen.queryByLabelText("Room number")).not.toBeInTheDocument();
    expect(
      screen.getByText("Check in to today’s shift to start logging the rooms you finish."),
    ).toBeInTheDocument();
  });

  // A worker who forgot to check out yesterday is STILL IN_PROGRESS. The
  // server takes a room's day from the assignment, so logging against that
  // shift would date the room to a past day: invisible in this list, invisible
  // in the checker's picker, and impossible for the worker to remove.
  it("does not offer the input for a shift that started on an earlier day", () => {
    mockAssignments.mockReturnValue({
      assignments: [
        {
          id: "aStale",
          hotel_id: "h1",
          rework_of_assignment_id: null,
          day: THREE_DAYS_AGO,
        },
      ],
      isLoading: false,
    });

    render(<RoomsPage />);

    expect(screen.queryByLabelText("Room number")).not.toBeInTheDocument();
    expect(
      screen.getByText("Check in to today’s shift to start logging the rooms you finish."),
    ).toBeInTheDocument();
  });

  // The checked-out case. The shift's identity comes from a room the server
  // itself dated today, so the client never computes a date -- which is the
  // whole point, since the server's "today" is Europe/Berlin.
  it("still offers the input after check-out, using the shift from today's own logs", () => {
    mockMyRooms.mockReturnValue({
      data: { rooms: [roomOf({ assignment_id: "a9", hotel_id: "h9" })], needs_rework: [] },
      isLoading: false,
      error: undefined,
      mutate: jest.fn(),
    });

    render(<RoomsPage />);

    expect(screen.getByLabelText("Room number")).toBeInTheDocument();
    // The hotel is read from the room log, not from a second lookup.
    expect(mockSuggestions).toHaveBeenCalledWith("h9");
  });

  it("never offers the log input to a role that cannot log rooms", () => {
    signIn("manager");
    mockAssignments.mockReturnValue({
      assignments: [
        { id: "a1", hotel_id: "h1", rework_of_assignment_id: null, day: TODAY },
      ],
      isLoading: false,
    });

    render(<RoomsPage />);

    expect(screen.queryByLabelText("Room number")).not.toBeInTheDocument();
    expect(screen.getByText("No rooms logged yet today.")).toBeInTheDocument();
  });

  it("suggests only rooms that match what is typed and are not already logged", async () => {
    mockAssignments.mockReturnValue({
      assignments: [
        { id: "a1", hotel_id: "h1", rework_of_assignment_id: null, day: TODAY },
      ],
      isLoading: false,
    });
    mockSuggestions.mockReturnValue({ data: { rooms: ["410", "412", "521"] } });
    mockMyRooms.mockReturnValue({
      data: { rooms: [roomOf({ room_number: "412" })], needs_rework: [] },
      isLoading: false,
      error: undefined,
      mutate: jest.fn(),
    });

    render(<RoomsPage />);
    await userEvent.type(screen.getByLabelText("Room number"), "41");

    expect(screen.getByRole("button", { name: "Add 410" })).toBeInTheDocument();
    // 412 is already logged today: the server would answer 409, naming
    // whoever logged it, so it must not be offered.
    expect(screen.queryByRole("button", { name: "Add 412" })).not.toBeInTheDocument();
    // 521 does not match what was typed.
    expect(screen.queryByRole("button", { name: "Add 521" })).not.toBeInTheDocument();
  });

  it("withholds edit and remove once a room has been inspected", () => {
    mockMyRooms.mockReturnValue({
      data: {
        rooms: [roomOf({ state: "PASSED", verification_id: "v1", score: 90, editable: false })],
        needs_rework: [],
      },
      isLoading: false,
      error: undefined,
      mutate: jest.fn(),
    });

    render(<RoomsPage />);

    expect(screen.getByText("Passed")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();
  });

  it("links a room sent back to its rework shift, above today's list", () => {
    mockMyRooms.mockReturnValue({
      data: {
        rooms: [],
        needs_rework: [
          roomOf({
            id: "rl2",
            state: "NEEDS_REWORK",
            verification_id: "v2",
            rework_assignment_id: "rw9",
            editable: false,
            // Deliberately an older day: needs_rework spans ALL days because a
            // rework raised yesterday is dated today by the server.
            day: "2026-08-31",
          }),
        ],
      },
      isLoading: false,
      error: undefined,
      mutate: jest.fn(),
    });

    render(<RoomsPage />);

    const attention = screen.getByText("Needs your attention").closest("div")!.parentElement!;
    const link = within(attention).getByRole("link", { name: "Go to rework" });
    expect(link).toHaveAttribute("href", "/assignments/rw9");
    // The day is shown for these rows precisely because they are not
    // necessarily today's.
    expect(screen.getByText("Grand Hotel · 2026-08-31")).toBeInTheDocument();
  });

  it("reports a failed load instead of an empty log", () => {
    mockMyRooms.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error("network"),
      mutate: jest.fn(),
    });

    render(<RoomsPage />);

    expect(screen.getByText("Failed to load")).toBeInTheDocument();
    expect(screen.queryByText("No rooms logged yet today.")).not.toBeInTheDocument();
  });
});

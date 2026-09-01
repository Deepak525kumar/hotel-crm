import { render, screen } from "@testing-library/react";
import { RoomsLoggedTodayCard } from "@/components/rooms/RoomsLoggedTodayCard";
import { useRoomsForHotel } from "@/hooks/useRooms";
import type { RoomLog } from "@/lib/types";
import i18n from "@/lib/i18n";

/**
 * The manager/RM live view that replaced the manual "rooms completed" count
 * (owner decision, 2026-09-01).
 *
 * The count is now a consequence of the workers' own per-room records, so this
 * card must show the same rooms the checker's picker is built from -- and must
 * say plainly when nothing has been logged, rather than rendering a 0 that
 * looks like a finished shift with no work in it.
 */

jest.mock("@/hooks/useRooms", () => ({ useRoomsForHotel: jest.fn() }));
const mockRooms = useRoomsForHotel as jest.Mock;

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

beforeAll(async () => {
  await i18n.changeLanguage("en");
});

beforeEach(() => jest.clearAllMocks());

describe("rooms logged today card", () => {
  it("asks the server for this hotel only, and never sends a day", () => {
    mockRooms.mockReturnValue({ data: undefined, isLoading: true, error: undefined });
    render(<RoomsLoggedTodayCard hotelId="h1" />);
    // The hook takes a hotel and nothing else: "today" is Europe/Berlin
    // server-side, so there is no date for this component to compute.
    expect(mockRooms).toHaveBeenCalledWith("h1");
  });

  it("lists each worker's count and every room with its state", () => {
    mockRooms.mockReturnValue({
      data: {
        day: "2026-09-01",
        rooms: [
          roomOf(),
          roomOf({ id: "rl2", room_number: "413", state: "PASSED", verification_id: "v1", score: 92 }),
          roomOf({ id: "rl3", room_number: "515", worker_id: "w2", worker_name: "Bo Nilsson" }),
        ],
        by_worker: [
          { worker_id: "w1", worker_name: "Ana Petrova", rooms_logged: 2 },
          { worker_id: "w2", worker_name: "Bo Nilsson", rooms_logged: 1 },
        ],
      },
      isLoading: false,
      error: undefined,
    });

    render(<RoomsLoggedTodayCard hotelId="h1" />);

    expect(screen.getByText("Rooms logged today")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("413")).toBeInTheDocument();
    expect(screen.getByText("Passed")).toBeInTheDocument();
    expect(screen.getAllByText("Awaiting check")).toHaveLength(2);
  });

  it("says nothing has been logged rather than showing an empty table", () => {
    mockRooms.mockReturnValue({
      data: { day: "2026-09-01", rooms: [], by_worker: [] },
      isLoading: false,
      error: undefined,
    });

    render(<RoomsLoggedTodayCard hotelId="h1" />);

    expect(screen.getByText("No rooms logged yet today.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  // A 403 (out of scope) or a network failure must read as a failure, not as
  // a hotel where nobody cleaned anything.
  it("reports a failed load instead of an empty day", () => {
    mockRooms.mockReturnValue({ data: undefined, isLoading: false, error: new Error("403") });

    render(<RoomsLoggedTodayCard hotelId="h1" />);

    expect(screen.getByText("Failed to load")).toBeInTheDocument();
    expect(screen.queryByText("No rooms logged yet today.")).not.toBeInTheDocument();
  });
});

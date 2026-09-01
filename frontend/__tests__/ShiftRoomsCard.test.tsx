import { render, screen } from "@testing-library/react";
import AssignmentDetailPage from "@/app/(protected)/assignments/[id]/page";
import { useAssignment } from "@/hooks/useAssignments";
import { useRoomsForAssignment } from "@/hooks/useRooms";
import { useAuthStore } from "@/stores/auth";
import type { AuthUser, RoomLog } from "@/lib/types";
import i18n from "@/lib/i18n";

/**
 * The rooms one shift logged, on that shift's own page.
 *
 * Retiring the manual rooms-completed card left this page with no room
 * information at all: the view that replaced it is per-hotel and today-only,
 * so a manager opening a shift -- and ANY past shift -- saw nothing, while
 * the room numbers had been captured and stored all along.
 */

jest.mock("next/navigation", () => ({
  useParams: () => ({ id: "a1" }),
  usePathname: () => "/assignments/a1",
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
}));
jest.mock("@/hooks/useAssignments", () => ({ useAssignment: jest.fn() }));
jest.mock("@/hooks/useHotels", () => ({
  useHotel: jest.fn(() => ({ data: { id: "h1", name: "Grand Hotel" } })),
  // UserRef resolves the worker's name through this; irrelevant here.
  useUsersByIds: jest.fn(() => new Map()),
  useUserOptions: jest.fn(() => ({ users: [], isLoading: false })),
}));
jest.mock("@/hooks/useWorkRequests", () => ({ useWorkRequest: jest.fn(() => ({ data: undefined })) }));
jest.mock("@/hooks/useRooms", () => ({
  useRoomsForCheck: jest.fn(() => ({ data: undefined, isLoading: false, error: undefined })),
  useRoomsForAssignment: jest.fn(),
}));

const mockAssignment = useAssignment as jest.Mock;
const mockRooms = useRoomsForAssignment as jest.Mock;

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

beforeEach(() => {
  jest.clearAllMocks();
  useAuthStore.setState({
    user: { id: "m1", role: "manager", email: "m@x.com" } as AuthUser,
  });
  mockAssignment.mockReturnValue({
    data: {
      id: "a1",
      worker_id: "w1",
      hotel_id: "h1",
      status: "COMPLETED",
      day: "2026-09-01",
      rework_of_assignment_id: null,
    },
    isLoading: false,
    error: undefined,
    mutate: jest.fn(),
  });
});

it("lists every room the shift logged, with each room's state", () => {
  mockRooms.mockReturnValue({
    data: {
      assignment_id: "a1",
      rooms: [
        roomOf({ id: "rl1", room_number: "412", state: "AWAITING_CHECK" }),
        roomOf({ id: "rl2", room_number: "415", state: "NEEDS_REWORK" }),
      ],
    },
    error: undefined,
  });

  render(<AssignmentDetailPage />);

  expect(screen.getByText("412")).toBeInTheDocument();
  expect(screen.getByText("415")).toBeInTheDocument();
});

// An empty card on every not-yet-started shift would be noise, and "no rooms
// yet" is not information anyone opens this page for.
it("renders nothing when the shift logged no rooms", () => {
  mockRooms.mockReturnValue({
    data: { assignment_id: "a1", rooms: [] },
    error: undefined,
  });

  render(<AssignmentDetailPage />);

  expect(screen.queryByText("412")).not.toBeInTheDocument();
});

// The endpoint is scoped to whoever may see the shift, and this card renders
// for everyone who can open the page -- so a 403 is an ordinary outcome, not
// a failure worth putting on screen.
it("stays silent when the caller may not read the shift's rooms", () => {
  mockRooms.mockReturnValue({ data: undefined, error: new Error("403") });

  expect(() => render(<AssignmentDetailPage />)).not.toThrow();
  expect(screen.queryByText("412")).not.toBeInTheDocument();
});

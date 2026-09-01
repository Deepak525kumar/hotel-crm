import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AssignmentDetailPage from "@/app/(protected)/assignments/[id]/page";
import { useAssignment } from "@/hooks/useAssignments";
import { useRoomsForCheck } from "@/hooks/useRooms";
import { qualityApi } from "@/lib/api";
import { useAuthStore } from "@/stores/auth";
import type { AuthUser, RoomLog } from "@/lib/types";
import i18n from "@/lib/i18n";

/**
 * The checker's room picker, on the web inspection modal (owner decision,
 * 2026-09-01).
 *
 * What this replaced: a free-text room number typed from memory. It was tied
 * to nothing, so a typo produced a check against a room nobody had cleaned and
 * the worker's own record of that room stayed unlinked forever.
 *
 * The two things that must not regress:
 *
 *   1. Picking a room sends `room_log_id` AND that room's own
 *      assignment/worker. A room logged by another worker at the same hotel
 *      belongs to a different shift, and sending this page's ids instead would
 *      attribute the check -- and any rework -- to the wrong person. (The
 *      server cross-checks all four and rejects a mismatch, which is why a
 *      client that sends three of them from one room and one from another
 *      fails loudly rather than silently.)
 *   2. The typed-room fallback stays reachable and sends NO `room_log_id`: a
 *      worker can forget to log a room, and a skipped room must stay
 *      inspectable.
 */

jest.mock("next/navigation", () => ({
  useParams: () => ({ id: "a1" }),
  usePathname: () => "/assignments/a1",
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
}));
jest.mock("@/hooks/useAssignments", () => ({ useAssignment: jest.fn() }));
jest.mock("@/hooks/useHotels", () => ({
  useHotel: jest.fn(() => ({ data: { id: "h1", name: "Grand Hotel" } })),
  useUsersByIds: jest.fn(() => new Map()),
  useUserOptions: jest.fn(() => ({ users: [], isLoading: false })),
}));
jest.mock("@/hooks/useWorkRequests", () => ({ useWorkRequest: jest.fn(() => ({ data: undefined })) }));
// useRoomsForAssignment feeds the page's "rooms logged on this shift" card,
// which is unrelated to the picker under test -- stubbed empty so the card
// renders nothing and leaves these assertions to the picker alone.
jest.mock("@/hooks/useRooms", () => ({
  useRoomsForCheck: jest.fn(),
  useRoomsForAssignment: () => ({ data: undefined, error: undefined }),
}));
jest.mock("@/lib/api", () => {
  const actual = jest.requireActual("@/lib/api");
  return {
    ...actual,
    qualityApi: { ...actual.qualityApi, recordInspection: jest.fn() },
  };
});

const mockAssignment = useAssignment as jest.Mock;
const mockPicker = useRoomsForCheck as jest.Mock;
const mockRecord = qualityApi.recordInspection as jest.Mock;

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

function pickerData(overrides: Partial<Record<"awaiting_check" | "reworked" | "already_checked", RoomLog[]>> = {}) {
  return {
    data: {
      day: "2026-09-01",
      awaiting_check: [],
      reworked: [],
      already_checked: [],
      ...overrides,
    },
    isLoading: false,
    error: undefined,
  };
}

async function openModal() {
  // The page's own "Verify" button opens the dialog; the dialog has a second
  // one that submits it, so every later query is scoped to the dialog.
  await userEvent.click(screen.getByRole("button", { name: "Verify" }));
}

function dialog() {
  return within(screen.getByRole("dialog"));
}

async function submit() {
  await userEvent.click(dialog().getByRole("button", { name: "Verify" }));
}

async function fillAndSubmit() {
  await userEvent.type(dialog().getByLabelText("Score (0–100)"), "90");
  await userEvent.upload(
    dialog().getByLabelText("Photos"),
    new File(["x"], "room.jpg", { type: "image/jpeg" }),
  );
  await submit();
}

beforeAll(async () => {
  await i18n.changeLanguage("en");
});

beforeEach(() => {
  jest.clearAllMocks();
  mockAssignment.mockReturnValue({
    data: {
      id: "a1",
      work_request_id: null,
      job_request_id: null,
      rework_of_assignment_id: null,
      worker_id: "w1",
      hotel_id: "h1",
      assigned_by_id: "m1",
      status: "IN_PROGRESS",
      confirmed_at: "2026-09-01T06:00:00.000Z",
      started_at: "2026-09-01T07:00:00.000Z",
      completed_at: null,
      cancelled_at: null,
      cancellation_reason: null,
      updated_at: "2026-09-01T07:00:00.000Z",
      rooms_completed: null,
    },
    isLoading: false,
    error: undefined,
    mutate: jest.fn(),
  });
  mockPicker.mockReturnValue(pickerData());
  mockRecord.mockResolvedValue({ verification: { id: "v1", score: 90, status: "PASSED" }, rework_assignment: null });
  useAuthStore.setState({
    user: { id: "c1", email: "c@x.de", first_name: "Chi", last_name: "K", role: "checker" } as AuthUser,
    status: "authenticated",
  });
});

describe("inspection room picker", () => {
  it("sends the picked room's log id, shift and worker — not this page's", async () => {
    mockPicker.mockReturnValue(
      pickerData({
        // Another worker's room at the same hotel: the shift and worker here
        // deliberately differ from the assignment this page is showing.
        awaiting_check: [
          roomOf({ id: "rl9", assignment_id: "a9", worker_id: "w9", worker_name: "Bo Nilsson", room_number: "515" }),
        ],
      }),
    );

    render(<AssignmentDetailPage />);
    await openModal();

    await userEvent.selectOptions(dialog().getByLabelText("Room"), "rl9");
    // The worker is derived from the room, so it is shown OUTSIDE the option
    // list too -- the checker must be able to see whose work they are about to
    // score without reopening the dropdown, since it may not be the worker on
    // the assignment they navigated from.
    expect(
      dialog()
        .getAllByText(/Bo Nilsson/)
        .some((el) => el.tagName === "P"),
    ).toBe(true);

    await fillAndSubmit();

    expect(mockRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        room_log_id: "rl9",
        assignment_id: "a9",
        worker_id: "w9",
        room_number: "515",
        score: 90,
        outcome: "complete",
      }),
      [expect.any(File)],
    );
  });

  it("groups the rooms by what can be done with them, omitting empty groups", async () => {
    mockPicker.mockReturnValue(
      pickerData({
        awaiting_check: [roomOf()],
        already_checked: [roomOf({ id: "rl3", room_number: "301", state: "PASSED", verification_id: "v3", score: 95 })],
      }),
    );

    render(<AssignmentDetailPage />);
    await openModal();

    const select = screen.getByLabelText("Room") as HTMLSelectElement;
    const groups = Array.from(select.querySelectorAll("optgroup")).map((g) => g.label);
    expect(groups).toEqual(["Awaiting check", "Already checked"]);
    // Already-checked rooms are listed rather than hidden so a room can be
    // re-checked deliberately.
    expect(select.querySelector('option[value="rl3"]')).not.toBeNull();
  });

  it("keeps a skipped room inspectable through the typed-room fallback, with no room_log_id", async () => {
    mockPicker.mockReturnValue(pickerData({ awaiting_check: [roomOf()] }));

    render(<AssignmentDetailPage />);
    await openModal();

    await userEvent.selectOptions(dialog().getByLabelText("Room"), "__manual__");
    await userEvent.type(dialog().getByLabelText("Room number"), "777");
    await fillAndSubmit();

    const [payload] = mockRecord.mock.calls[0];
    expect(payload.room_log_id).toBeUndefined();
    expect(payload).toMatchObject({ assignment_id: "a1", worker_id: "w1", room_number: "777" });
  });

  // A 403 (a checker not rostered at this hotel today) or a network failure
  // must not leave the checker unable to record anything at all.
  it("falls back to the typed room when the picker cannot be loaded", async () => {
    mockPicker.mockReturnValue({ data: undefined, isLoading: false, error: new Error("403") });

    render(<AssignmentDetailPage />);
    await openModal();

    expect(screen.queryByLabelText("Room")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Room number")).toBeInTheDocument();
    expect(screen.getByText("Failed to load")).toBeInTheDocument();
  });

  it("explains the empty picker and offers the typed room instead", async () => {
    mockPicker.mockReturnValue(pickerData());

    render(<AssignmentDetailPage />);
    await openModal();

    expect(screen.getByText("No rooms to check")).toBeInTheDocument();
    expect(screen.getByLabelText("Room number")).toBeInTheDocument();
  });

  // CRR §15: the server refuses a photoless inspection. Surfaced before the
  // upload rather than after it -- checkers are on hotel wifi.
  it("refuses to submit without a photo, before anything is uploaded", async () => {
    mockPicker.mockReturnValue(pickerData({ awaiting_check: [roomOf()] }));

    render(<AssignmentDetailPage />);
    await openModal();
    await userEvent.selectOptions(dialog().getByLabelText("Room"), "rl1");
    await userEvent.type(dialog().getByLabelText("Score (0–100)"), "90");
    await submit();

    expect(mockRecord).not.toHaveBeenCalled();
    expect(
      screen.getByText("Add at least one photo before submitting this rating."),
    ).toBeInTheDocument();
  });

  // The retired manual count (owner decision): the number is now derived from
  // the workers' own room logs, so the entry card must not come back.
  it("offers no manual rooms-completed entry on a completed shift", () => {
    mockAssignment.mockReturnValue({
      data: {
        id: "a1",
        work_request_id: null,
        job_request_id: null,
        rework_of_assignment_id: null,
        worker_id: "w1",
        hotel_id: "h1",
        assigned_by_id: "m1",
        status: "COMPLETED",
        confirmed_at: "2026-09-01T06:00:00.000Z",
        started_at: "2026-09-01T07:00:00.000Z",
        completed_at: "2026-09-01T15:00:00.000Z",
        cancelled_at: null,
        cancellation_reason: null,
        updated_at: "2026-09-01T15:00:00.000Z",
        rooms_completed: null,
      },
      isLoading: false,
      error: undefined,
      mutate: jest.fn(),
    });
    useAuthStore.setState({
      user: { id: "m1", email: "m@x.de", first_name: "Mo", last_name: "R", role: "manager" } as AuthUser,
      status: "authenticated",
    });

    render(<AssignmentDetailPage />);

    expect(screen.queryByRole("button", { name: "Log rooms completed" })).not.toBeInTheDocument();
    expect(screen.queryByText(/rooms completed for this assignment/i)).not.toBeInTheDocument();
  });
});

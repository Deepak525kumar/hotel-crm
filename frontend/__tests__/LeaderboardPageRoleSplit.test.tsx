import { render, screen } from "@testing-library/react";
import LeaderboardPage from "@/app/(protected)/leaderboard/page";
import { useLeaderboard, usePeerLeaderboard } from "@/hooks/useAnalytics";
import { useHotels } from "@/hooks/useHotels";
import { useAuthStore } from "@/stores/auth";
import type { AuthUser, Role } from "@/lib/types";
// Side-effect import: initialises i18next so `t()` resolves real copy rather
// than raw key paths -- this test asserts on rendered TEXT, so a raw key
// would make several assertions pass for the wrong reason.
import "@/lib/i18n";

/**
 * Regression for the bug this page shipped with: the sidebar nav shows
 * "Leaderboard" to worker AND checker (SidebarNav.tsx roles list), but the
 * page itself kept its original manager-only RoleGate and denied both with
 * "You do not have permission to view the leaderboard" -- and even without
 * that block, it called /analytics/leaderboard, which 403s for these two
 * roles by design. ADR-067 grants worker/checker a group-scoped view via
 * /quality/leaderboard; mobile already used it, web never did.
 */

jest.mock("@/hooks/useAnalytics", () => ({
  useLeaderboard: jest.fn(),
  usePeerLeaderboard: jest.fn(),
}));
jest.mock("@/hooks/useHotels", () => ({
  useHotels: jest.fn(() => ({ hotels: [] })),
}));

const mockLeaderboard = useLeaderboard as jest.Mock;
const mockPeerLeaderboard = usePeerLeaderboard as jest.Mock;
const mockHotels = useHotels as jest.Mock;

function userOf(role: Role): AuthUser {
  return {
    id: "u1",
    email: "u1@example.com",
    first_name: "Test",
    last_name: "User",
    role,
    preferred_language: null,
  } as AuthUser;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockHotels.mockReturnValue({ hotels: [] });
  mockLeaderboard.mockReturnValue({ entries: [], isLoading: false, error: undefined });
  mockPeerLeaderboard.mockReturnValue({ entries: [], isLoading: false, error: undefined });
});

describe("LeaderboardPage role split", () => {
  it.each(["admin", "manager", "regional_manager"] as const)(
    "%s sees the manager view (hotel scope selector), not the peer view",
    (role) => {
      useAuthStore.setState({ user: userOf(role), status: "authenticated" });
      render(<LeaderboardPage />);

      expect(mockLeaderboard).toHaveBeenCalled();
      expect(mockPeerLeaderboard).not.toHaveBeenCalled();
      // The manager view's own affordance -- the by-hotel Select -- proves
      // this is genuinely the manager component, not a lookalike.
      expect(screen.getByLabelText("Scope")).toBeInTheDocument();
    },
  );

  it.each(["worker", "checker"] as const)(
    "%s sees the peer view, and never the permission-denied message",
    (role) => {
      useAuthStore.setState({ user: userOf(role), status: "authenticated" });
      render(<LeaderboardPage />);

      expect(mockPeerLeaderboard).toHaveBeenCalled();
      expect(mockLeaderboard).not.toHaveBeenCalled();
      expect(screen.queryByLabelText("Scope")).not.toBeInTheDocument();
      // The literal regression: this message must never reach a worker or
      // checker on this page again.
      expect(
        screen.queryByText("You do not have permission to view the leaderboard."),
      ).not.toBeInTheDocument();
    },
  );

  it("renders the peer table's own columns for a worker, proving it is the quality-shaped view", () => {
    useAuthStore.setState({ user: userOf("worker"), status: "authenticated" });
    mockPeerLeaderboard.mockReturnValue({
      entries: [
        {
          id: "r1",
          worker_id: "w1",
          average_score: 88,
          rating_tier: "HIGH",
          total_ratings: 12,
          total_assignments: 20,
          completion_rate: 0.9,
          on_time_rate: 0.95,
          worker_cancellations: 0,
          worker: {
            id: "w1",
            first_name: "Ana",
            last_name: "Petrova",
            employment_record: { primary_hotel: { id: "h1", name: "Grand Hotel" } },
          },
        },
      ],
      isLoading: false,
      error: undefined,
    });
    render(<LeaderboardPage />);

    expect(screen.getByText("Ana Petrova")).toBeInTheDocument();
    expect(screen.getByText("Grand Hotel")).toBeInTheDocument();
    // completion_rate is a 0-1 fraction from the API -- this is the exact
    // value formatPercent() must scale by 100, not display as "0.9%".
    expect(screen.getByText("90%")).toBeInTheDocument();
  });
});

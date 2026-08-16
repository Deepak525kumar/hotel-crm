/**
 * @jest-environment jsdom
 *
 * The "Edit" trigger on the worker's skills row.
 *
 * This row is deliberately rendered even when a worker has no skills yet, so
 * that a first-pass worker has somewhere to click Edit from. That empty case
 * was exactly the broken one: `EditSkillsModal` takes `currentSkills = []`, so
 * an absent `skills` field produced a brand new array on every render, and the
 * open-effect depended on that array's identity. Clicking Edit therefore set
 * state, re-rendered, produced another new array, and looped until React
 * aborted with "Maximum update depth exceeded" — the button appeared dead.
 *
 * The worker-with-skills path never reproduced it, because SWR hands back a
 * referentially stable array. Both are covered here.
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WorkerOnboardingCard } from "@/components/employees/WorkerOnboardingCard";
import { useEmploymentRecord } from "@/hooks/useEmployment";
// Side-effect import: initialises i18next so `t()` resolves real copy rather
// than echoing key paths, matching how the app boots.
import "@/lib/i18n";
import type { SkillTag } from "@/lib/types";

jest.mock("@/hooks/useEmployment", () => ({ useEmploymentRecord: jest.fn() }));
jest.mock("@/hooks/useDocuments", () => ({ useDocumentCompleteness: () => ({ data: undefined }) }));
jest.mock("@/hooks/useContract", () => ({ useWorkerContract: () => ({ data: undefined }) }));
jest.mock("@/hooks/useHotels", () => ({ useHotelGroups: () => ({ groups: [] }) }));
jest.mock("@/hooks/useEmploymentPermissions", () => ({
  useEmploymentPermissions: () => ({
    canDeleteEmployment: true,
    canRestoreEmployment: true,
    canSubmitForReview: true,
    canApproveEmployment: true,
    canRejectEmployment: true,
    canDeactivateEmployment: true,
    canReactivateEmployment: true,
  }),
}));
jest.mock("@/lib/api", () => ({
  employeesApi: { update: jest.fn().mockResolvedValue({}) },
}));
jest.mock("swr", () => ({ mutate: jest.fn() }));

const asMock = useEmploymentRecord as jest.Mock;

function record(skills?: SkillTag[]) {
  return {
    employee_id: "emp-1",
    user_id: "user-1",
    status: "ACTIVE",
    skills,
    start_date: "2026-01-01",
    employment_cycle: 1,
  };
}

/** The skills row's own Edit trigger, not any other Edit on the card. */
function skillsEditButton() {
  const row = screen.getByText("Skills").closest("div, dl, tr") as HTMLElement;
  return within(row).getByRole("button", { name: "Edit" });
}

beforeEach(() => jest.clearAllMocks());

it("opens the skills modal for a worker who has NO skills yet", async () => {
  asMock.mockReturnValue({ data: record(undefined), isLoading: false, error: null });

  render(<WorkerOnboardingCard userId="user-1" />);
  await userEvent.click(skillsEditButton());

  // Before the fix this never arrived: the open transition looped instead.
  await waitFor(() => expect(screen.getByText("Edit Skills")).toBeInTheDocument());
});

it("opens the skills modal for a worker who already has skills", async () => {
  asMock.mockReturnValue({ data: record(["CLEANER"]), isLoading: false, error: null });

  render(<WorkerOnboardingCard userId="user-1" />);
  await userEvent.click(skillsEditButton());

  await waitFor(() => expect(screen.getByText("Edit Skills")).toBeInTheDocument());
});

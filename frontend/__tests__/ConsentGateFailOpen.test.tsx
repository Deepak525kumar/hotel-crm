import { render, screen } from "@testing-library/react";

// Guards the consent gate's fail-open behaviour.
//
// The gate is UX for a server-side control, so what it does when it CANNOT
// determine consent state matters more than the happy path. Getting it wrong
// silently defeats the documented kill switch: with FEATURE_CONSENT_GATE off
// the API stops gating immediately, but a client that walls on its own consent
// read keeps every non-admin in front of a notice they no longer need to
// accept -- and if the consent endpoints are what broke (the likely reason for
// pulling the switch), that wall cannot be dismissed at all.
//
// This is exactly what the code did before: on a failed read SWR leaves `data`
// undefined and `isLoading` false, so it fell through to the wall while its
// own comment claimed it failed open.

const mockUseConsentStatus = jest.fn();
const mockUseGateState = jest.fn();
const mockUseAuth = jest.fn();

jest.mock("@/hooks/useConsent", () => ({
  useConsentStatus: () => mockUseConsentStatus(),
  useConsentGateState: () => mockUseGateState(),
}));
jest.mock("@/hooks/useAuth", () => ({ useAuth: () => mockUseAuth() }));
jest.mock("@/lib/api", () => ({
  consentApi: {
    requestNotice: jest.fn().mockResolvedValue({
      notice_version: "v1",
      notice_content: "notice",
      rtl: false,
    }),
    recordDecision: jest.fn(),
  },
}));
jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

import { ConsentGate } from "@/components/consent/ConsentGate";

const CHILD = "protected-content";
const renderGate = () =>
  render(
    <ConsentGate>
      <div>{CHILD}</div>
    </ConsentGate>,
  );

beforeEach(() => {
  jest.clearAllMocks();
  mockUseAuth.mockReturnValue({ user: { role: "worker" } });
  // Default: the server IS enforcing. Individual tests override.
  mockUseGateState.mockReturnValue({ data: { enforced: true } });
});

describe("ConsentGate — fail open", () => {
  it("renders children when the status read FAILS (kill switch must reach the UI)", () => {
    mockUseConsentStatus.mockReturnValue({
      data: undefined,
      error: new Error("network"),
      isLoading: false,
      mutate: jest.fn(),
    });
    renderGate();
    expect(screen.getByText(CHILD)).toBeInTheDocument();
  });

  it("renders children while the status is still resolving", () => {
    mockUseConsentStatus.mockReturnValue({
      data: undefined,
      error: undefined,
      isLoading: true,
      mutate: jest.fn(),
    });
    renderGate();
    expect(screen.getByText(CHILD)).toBeInTheDocument();
  });

  it("renders children for an admin regardless of consent", () => {
    mockUseAuth.mockReturnValue({ user: { role: "admin" } });
    mockUseConsentStatus.mockReturnValue({
      data: { status: "absent" },
      error: undefined,
      isLoading: false,
      mutate: jest.fn(),
    });
    renderGate();
    expect(screen.getByText(CHILD)).toBeInTheDocument();
  });
});

describe("ConsentGate — still blocks when consent state IS known", () => {
  it.each(["absent", "declined"])(
    "withholds children when status is %s",
    (status) => {
      mockUseConsentStatus.mockReturnValue({
        data: { status },
        error: undefined,
        isLoading: false,
        mutate: jest.fn(),
      });
      renderGate();
      // Failing open must not become failing open ALWAYS -- a known
      // not-granted state is precisely when the wall belongs.
      expect(screen.queryByText(CHILD)).not.toBeInTheDocument();
      expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    },
  );

  it("renders children once consent is granted", () => {
    mockUseConsentStatus.mockReturnValue({
      data: { status: "granted" },
      error: undefined,
      isLoading: false,
      mutate: jest.fn(),
    });
    renderGate();
    expect(screen.getByText(CHILD)).toBeInTheDocument();
  });
});

describe("ConsentGate — kill switch", () => {
  it("renders children when the server says the gate is NOT enforced", () => {
    // FEATURE_CONSENT_GATE=false stops the API gating instantly. Before
    // /consent/gate-state existed, this screen kept prompting from its own
    // consent read, so the switch never reached the UI.
    mockUseGateState.mockReturnValue({ data: { enforced: false } });
    mockUseConsentStatus.mockReturnValue({
      data: { status: "absent" },
      error: undefined,
      isLoading: false,
      mutate: jest.fn(),
    });
    renderGate();
    expect(screen.getByText(CHILD)).toBeInTheDocument();
  });

  it("still blocks when the gate-state lookup itself fails", () => {
    // Unknown enforcement must not become a bypass: consent state is known
    // and says not-granted, so the wall belongs.
    mockUseGateState.mockReturnValue({ data: undefined });
    mockUseConsentStatus.mockReturnValue({
      data: { status: "absent" },
      error: undefined,
      isLoading: false,
      mutate: jest.fn(),
    });
    renderGate();
    expect(screen.queryByText(CHILD)).not.toBeInTheDocument();
  });
});

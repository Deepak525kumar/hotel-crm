import { render, screen } from "@testing-library/react";
import { BlocklistReadGate } from "@/components/auth/RoleGate";
import { useAuthStore } from "@/stores/auth";
import type { AuthUser, Role } from "@/lib/types";

/**
 * A hotel's employee blocklist (SPEC-EMP-001/RULE-EMP-07) is shown on the
 * hotel detail page. The backend read endpoint is intentionally unrestricted
 * (`employees:read`, held by every role, per RoleGate.tsx's own comment) --
 * this is a frontend-only visibility restriction, requested so a worker or
 * checker viewing their own hotel's page does not see which colleagues are
 * blocked and why. Getting the allow-list wrong in either direction is a real
 * regression: too narrow hides it from a manager who legitimately needs it
 * (RULE-EMP-07's own write-gate allows exactly this set); too broad leaves the
 * bug this gate exists to fix.
 */

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

describe("BlocklistReadGate", () => {
  it.each(["admin", "manager", "regional_manager"] as const)(
    "renders the blocklist for %s",
    (role) => {
      useAuthStore.setState({ user: userOf(role), status: "authenticated" });
      render(
        <BlocklistReadGate>
          <div>blocklist-content</div>
        </BlocklistReadGate>,
      );
      expect(screen.getByText("blocklist-content")).toBeInTheDocument();
    },
  );

  it.each(["worker", "checker"] as const)(
    "hides the blocklist from %s",
    (role) => {
      useAuthStore.setState({ user: userOf(role), status: "authenticated" });
      render(
        <BlocklistReadGate>
          <div>blocklist-content</div>
        </BlocklistReadGate>,
      );
      expect(screen.queryByText("blocklist-content")).not.toBeInTheDocument();
    },
  );

  it("hides the blocklist when signed out, rather than defaulting open", () => {
    useAuthStore.setState({ user: null, status: "unauthenticated" });
    render(
      <BlocklistReadGate>
        <div>blocklist-content</div>
      </BlocklistReadGate>,
    );
    expect(screen.queryByText("blocklist-content")).not.toBeInTheDocument();
  });
});

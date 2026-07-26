import { Badge } from "@/components/ui";
import type { Role } from "@/lib/types";

const ROLE: Record<Role, { tone: "neutral" | "info" | "warning" | "success"; label: string }> = {
  worker: { tone: "neutral", label: "Worker" },
  checker: { tone: "info", label: "Checker" },
  manager: { tone: "warning", label: "Manager" },
  admin: { tone: "success", label: "Admin" },
  regional_manager: { tone: "warning", label: "Regional Manager" },
};

/** Coloured pill for a user's role. */
export function RoleBadge({ role }: { role: Role }) {
  const { tone, label } = ROLE[role] ?? ROLE.worker;
  return <Badge tone={tone}>{label}</Badge>;
}

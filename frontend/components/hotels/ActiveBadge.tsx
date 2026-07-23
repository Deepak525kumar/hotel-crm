import { Badge } from "@/components/ui";

/** Active/inactive pill for hotels (and any other soft-deletable entity). */
export function ActiveBadge({ active }: { active: boolean }) {
  return (
    <Badge tone={active ? "success" : "neutral"}>
      {active ? "Active" : "Inactive"}
    </Badge>
  );
}

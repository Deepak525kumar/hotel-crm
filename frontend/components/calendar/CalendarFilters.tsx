"use client";

import { Select } from "@/components/ui";
import type { Hotel, HotelGroup } from "@/lib/types";
import { useTranslation } from "react-i18next";

/**
 * Scope-driven hotel/group filter row for the calendar. Rendered only for
 * the roles that actually have a choice to make: an admin picks a group
 * then a hotel within it; a Regional Manager picks a hotel within their own
 * (fixed) group; a Hotel Manager has exactly one hotel and gets a static
 * label instead of a one-option dropdown; workers/checkers get nothing,
 * since the backend already self-scopes their rows.
 *
 * All filtering state lives in the parent page (app/(protected)/calendar/
 * page.tsx) — this component is presentation + the onChange wiring only, so
 * the parent's "hotel selected under the previous group is meaningless
 * under a new one" clearing logic stays in one place.
 */
export function CalendarFilters({
  isAdmin,
  scopeGroupId,
  scopeHotelId,
  groupFilter,
  onGroupFilterChange,
  hotelFilter,
  onHotelFilterChange,
  activeGroupId,
  groups,
  hotelOptions,
  hotelNameById,
}: {
  isAdmin: boolean;
  scopeGroupId: string | null;
  scopeHotelId: string | null;
  groupFilter: string;
  onGroupFilterChange: (groupId: string) => void;
  hotelFilter: string;
  onHotelFilterChange: (hotelId: string) => void;
  activeGroupId: string | null;
  groups: HotelGroup[];
  hotelOptions: Hotel[];
  hotelNameById: Map<string, string>;
}) {
  const { t } = useTranslation();
  if (!isAdmin && !scopeGroupId && !scopeHotelId) return null;

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
      {isAdmin && (
        <div className="w-full sm:w-64">
          <Select
            label={t("fields.hotelGroup")}
            value={groupFilter}
            onChange={(e) => onGroupFilterChange(e.target.value)}
            placeholder={t("filters.allGroups")}
            options={groups.map((g) => ({ value: g.id, label: g.name }))}
          />
        </div>
      )}
      {scopeHotelId ? (
        <div className="w-full sm:w-64">
          <p className="mb-1 text-sm font-medium text-gray-700 dark:text-gray-300">{t("fields.hotel")}</p>
          <p className="rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-600 dark:border-gray-700 dark:text-gray-400">
            {hotelNameById.get(scopeHotelId) ?? "Your hotel"}
          </p>
        </div>
      ) : (
        <div className="w-full sm:w-64">
          <Select
            label={t("fields.hotel")}
            value={hotelFilter}
            onChange={(e) => onHotelFilterChange(e.target.value)}
            placeholder={isAdmin && !activeGroupId ? "All hotels" : "All hotels in group"}
            options={hotelOptions.map((h) => ({ value: h.id, label: h.name }))}
          />
        </div>
      )}
    </div>
  );
}

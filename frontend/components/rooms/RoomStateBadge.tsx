"use client";

import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui";
import type { RoomState } from "@/lib/types";

/**
 * One room state, one label, one tone — shared by the worker's room list, the
 * manager's live view and the checker's picker.
 *
 * Kept in a component rather than a map inlined at each call site because the
 * three surfaces describe the same fact: a room that reads "Passed" on the
 * worker's screen and "Checked" on the manager's is two names for one state,
 * and that is how the old free-text room field and the manual rooms-completed
 * count came to disagree in the first place.
 *
 * REWORK_SUBMITTED is `info`, not `success`: the room auto-passes on the
 * worker's word (owner decision) and the checker still has to look at the
 * evidence, so it must not read as a settled pass.
 */
const TONES: Record<RoomState, "neutral" | "success" | "warning" | "info"> = {
  AWAITING_CHECK: "neutral",
  PASSED: "success",
  NEEDS_REWORK: "warning",
  REWORK_SUBMITTED: "info",
};

/**
 * Literal `t()` calls per state, not `t(\`rooms.state.${key}\`)`: a template
 * key is invisible to the catalogue-key checks both apps rely on, so a state
 * renamed here would ship as a raw key on screen.
 */
export function roomStateLabel(state: RoomState, t: (key: string) => string): string {
  switch (state) {
    case "AWAITING_CHECK":
      return t("rooms.state.awaitingCheck");
    case "PASSED":
      return t("rooms.state.passed");
    case "NEEDS_REWORK":
      return t("rooms.state.needsRework");
    case "REWORK_SUBMITTED":
      return t("rooms.state.reworkSubmitted");
  }
}

export function RoomStateBadge({ state }: { state: RoomState }) {
  const { t } = useTranslation();
  return <Badge tone={TONES[state]}>{roomStateLabel(state, t)}</Badge>;
}

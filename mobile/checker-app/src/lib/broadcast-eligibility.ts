import type { Broadcast, BroadcastEligibility, JobRequestSkillSlot } from '@/types/api';

/**
 * Resolves which open skill slot(s) the current worker is eligible for,
 * given the broadcast's own skill_slots (headcount/confirmed_count — the
 * authoritative fill state) and the eligibility response's per-slot
 * `eligible` flag (the backend computes this for the calling worker
 * server-side — no other worker's id or inclusion is ever present on the
 * response, so there is nothing to check against a local user id here).
 */
export function resolveMySlots(
  broadcast: Pick<Broadcast, 'skill_slots'>,
  eligibility: BroadcastEligibility | null,
): JobRequestSkillSlot[] {
  if (!eligibility) return [];
  const eligibleSkills = new Set(
    eligibility.slots.filter((s) => s.eligible === true).map((s) => s.skill),
  );
  return (broadcast.skill_slots ?? [])
    .filter((slot) => eligibleSkills.has(slot.skill) && slot.confirmed_count < slot.headcount);
}

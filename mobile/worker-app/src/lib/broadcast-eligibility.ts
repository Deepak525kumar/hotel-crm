import type { Broadcast, BroadcastEligibility, JobRequestSkillSlot } from '@/types/api';

/**
 * Resolves which open skill slot(s) the current worker is eligible for,
 * given the broadcast's own skill_slots (headcount/confirmed_count — the
 * authoritative fill state) and the eligibility response's per-slot
 * eligible_worker_ids (does this worker qualify for this slot).
 */
export function resolveMySlots(
  broadcast: Pick<Broadcast, 'skill_slots'>,
  eligibility: BroadcastEligibility | null,
  currentUserId: string | null | undefined,
): JobRequestSkillSlot[] {
  if (!eligibility || !currentUserId) return [];
  const eligibleSkills = new Set(
    eligibility.slots
      .filter((s) => s.eligible_worker_ids.includes(currentUserId))
      .map((s) => s.skill),
  );
  return (broadcast.skill_slots ?? [])
    .filter((slot) => eligibleSkills.has(slot.skill) && slot.confirmed_count < slot.headcount);
}

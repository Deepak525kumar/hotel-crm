-- Allows JobRequestSkillSlot.skill to be NULL, meaning "no specific skill
-- required" -- a broadcast slot open to every roster-eligible, free worker
-- at the hotel regardless of which (if any) skill tags they hold.
--
-- Additive and backward-compatible: every existing row already has a
-- non-null skill value, so relaxing the constraint changes nothing for
-- them. No data migration needed.
ALTER TABLE "JobRequestSkillSlot" ALTER COLUMN "skill" DROP NOT NULL;

-- Owner decision (2026-08-30): a room can be sent back more than once, and
-- each attempt's evidence must stay separable from the checker's original
-- photographs and from every other attempt.
--
-- Before this, a check carried ONE rework: one note, one completion time, and
-- the worker's photos appended into the same photo_urls array as the
-- checker's, with nothing marking the boundary. A second attempt was
-- impossible by construction -- assignRework claimed on rework_required =
-- false, which is only ever true once.

CREATE TABLE "ReworkRound" (
  "id"              TEXT NOT NULL,
  "verification_id" TEXT NOT NULL,
  "round_number"    INTEGER NOT NULL,
  "notes"           TEXT NOT NULL,
  "assigned_by_id"  TEXT NOT NULL,
  "assigned_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at"    TIMESTAMP(3),
  "photo_urls"      TEXT[],
  "assignment_id"   TEXT,
  "escalated_at"    TIMESTAMP(3),
  "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ReworkRound_pkey" PRIMARY KEY ("id"),
  -- A round with no instruction is a shift the worker cannot act on.
  CONSTRAINT "ReworkRound_notes_not_blank" CHECK (btrim("notes") <> ''),
  -- 1-based. Guards the numbering the checker and worker both read.
  CONSTRAINT "ReworkRound_round_number_positive" CHECK ("round_number" >= 1)
);

ALTER TABLE "ReworkRound" ADD CONSTRAINT "ReworkRound_verification_id_fkey"
  FOREIGN KEY ("verification_id") REFERENCES "QualityVerification"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReworkRound" ADD CONSTRAINT "ReworkRound_assigned_by_id_fkey"
  FOREIGN KEY ("assigned_by_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- SET NULL rather than CASCADE: losing the shift must not erase the record
-- that the room was sent back, or the evidence attached to that round.
ALTER TABLE "ReworkRound" ADD CONSTRAINT "ReworkRound_assignment_id_fkey"
  FOREIGN KEY ("assignment_id") REFERENCES "WorkerAssignment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX "ReworkRound_verification_id_round_number_key"
  ON "ReworkRound"("verification_id", "round_number");
CREATE INDEX "ReworkRound_verification_id_idx" ON "ReworkRound"("verification_id");
CREATE INDEX "ReworkRound_completed_at_escalated_at_assigned_at_idx"
  ON "ReworkRound"("completed_at", "escalated_at", "assigned_at");

-- Backfill: every existing rework becomes round 1, so history is not lost and
-- the new screens have something to show for work already done.
--
-- photo_urls is left EMPTY on these rows, deliberately. The worker's photos
-- were appended into QualityVerification.photo_urls with no boundary
-- recorded, so they cannot be split retroactively -- inventing a split point
-- would mislabel the checker's own photographs as proof of a fix. Those
-- pictures remain visible on the check itself; only the per-round grouping is
-- unavailable for rounds that predate this table.
INSERT INTO "ReworkRound" (
  "id", "verification_id", "round_number", "notes", "assigned_by_id",
  "assigned_at", "completed_at", "photo_urls", "assignment_id",
  "escalated_at", "created_at", "updated_at"
)
SELECT
  gen_random_uuid()::text,
  v."id",
  1,
  -- notes is NOT NULL here but rework_notes was nullable. A blank would fail
  -- the CHECK above, so an explicit placeholder records that the instruction
  -- was never captured rather than dropping the round.
  COALESCE(NULLIF(btrim(v."rework_notes"), ''), 'Rework assigned before per-round notes were recorded'),
  v."verified_by_id",
  v."created_at",
  v."rework_completed_at",
  ARRAY[]::TEXT[],
  (SELECT a."id" FROM "WorkerAssignment" a
    WHERE a."rework_verification_id" = v."id"
    ORDER BY a."confirmed_at" ASC NULLS LAST LIMIT 1),
  v."rework_escalated_at",
  v."created_at",
  CURRENT_TIMESTAMP
FROM "QualityVerification" v
WHERE v."rework_required" = true;

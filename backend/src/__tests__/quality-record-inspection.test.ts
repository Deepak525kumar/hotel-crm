import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'node:fs';

import { RecordInspectionSchema } from '../modules/quality/types.js';

/**
 * POST /quality/inspections — one inspection, one request.
 *
 * The checker app used to end an inspection with three sequential calls
 * (createRating, createVerification, assignRework), which uploaded the photos
 * twice, could not be atomic, and sent the worker up to three notifications
 * for one decision. The properties asserted here are the ones that made the
 * three-call version wrong; each is checked against the source because they
 * are structural (single transaction, single upload, single notification)
 * rather than observable from a return value.
 */
const body = () => {
  const src = readFileSync('src/modules/quality/service.ts', 'utf8');
  return src.slice(src.indexOf('async recordInspection('), src.indexOf('async createVerification('));
};

describe('RecordInspectionSchema (multipart)', () => {
  const base = {
    assignment_id: 'a1',
    worker_id: 'w1',
    // Required since 2026-08-29: a check always says which room.
    room_number: '412',
    score: '82',
    outcome: 'rework',
  };

  it('coerces score the way a multipart body sends it', () => {
    // Every multipart field arrives as a string. A bare z.number() here would
    // reject every photo-bearing inspection while JSON-bodied unit tests
    // passed -- the exact defect CreateQualityVerificationSchema already had.
    expect(RecordInspectionSchema.parse(base).score).toBe(82);
  });

  it('parses criteria_scores from a JSON string', () => {
    const parsed = RecordInspectionSchema.parse({
      ...base,
      criteria_scores: '{"bathroom":100,"mirror":0}',
    });
    expect(parsed.criteria_scores).toEqual({ bathroom: 100, mirror: 0 });
  });

  it('rejects malformed criteria_scores with a readable message, not a crash', () => {
    const result = RecordInspectionSchema.safeParse({ ...base, criteria_scores: '{oops' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.errors[0].message).toMatch(/valid JSON/);
    }
  });

  it('rejects an outcome outside the two the screen offers', () => {
    expect(RecordInspectionSchema.safeParse({ ...base, outcome: 'delete' }).success).toBe(false);
  });

  it('rejects a score outside 0-100 and a non-integer', () => {
    expect(RecordInspectionSchema.safeParse({ ...base, score: '101' }).success).toBe(false);
    expect(RecordInspectionSchema.safeParse({ ...base, score: '-1' }).success).toBe(false);
    expect(RecordInspectionSchema.safeParse({ ...base, score: '82.5' }).success).toBe(false);
  });

  it('does not require rework_notes at the schema layer', () => {
    // Enforced in the service instead, because it depends on `outcome` AND
    // falls back to `comment`. A schema-level requirement would reject a
    // rework request whose notes are carried by the comment field.
    expect(RecordInspectionSchema.safeParse(base).success).toBe(true);
  });
});

describe('recordInspection writes one inspection, once', () => {
  it('uploads the photos exactly once', () => {
    // Two uploadPhotos calls would restore the double upload the three-call
    // client had. The assertion that photoKeys was written to TWO records went
    // with the Rating merge (2026-08-29) -- there is one record now, which is
    // the stronger form of the same guarantee.
    const src = body();
    expect(src.match(/this\.uploadPhotos\(/g)).toHaveLength(1);
    expect(src.match(/photo_urls: photoKeys/g)).toHaveLength(1);
  });

  it('writes both records inside ONE transaction', () => {
    const src = body();
    expect(src.match(/\$transaction/g)).toHaveLength(1);
    const tx = src.slice(src.indexOf('$transaction'));
    expect(tx).toContain('tx.qualityVerification.create');
    // Was also `tx.rating.create` -- one visit wrote two rows until the models
    // merged (2026-08-29).
    expect(tx).not.toContain('tx.rating.create');
  });

  it('refreshes the rating aggregate inside that transaction (GD-04)', () => {
    // Single-writer rule: every path that writes a Rating must refresh
    // WorkerOverallRating in the same commit, or the aggregate goes stale
    // with nothing to indicate it.
    const tx = body().slice(body().indexOf('$transaction'));
    expect(tx).toContain('refreshWorkerOverallRating(tx, worker_id)');
  });

  it('sends exactly one notification per outcome', () => {
    // The three-call path sent RATING_RECEIVED plus a score-derived
    // REWORK_REQUIRED plus the real REWORK_REQUIRED. The rework branch here
    // delegates its single notification to createReworkAssignment; the
    // complete branch enqueues its own.
    const src = body();
    expect(src.match(/notificationService\.enqueue\(/g)).toHaveLength(1);
    expect(src).toContain('createReworkAssignment');
    // Matched as the enqueue FIELD, not the bare string: the method's own
    // doc comment names RATING_RECEIVED when explaining what it replaced, and
    // a substring check turned that prose into a failure.
    expect(src).not.toMatch(/type:\s*'RATING_RECEIVED'/);
  });

  it('lets the outcome override the score-derived status', () => {
    // Rework is the checker's decision at any score, and a row that says
    // PASSED while carrying a rework assignment contradicts itself.
    expect(body()).toContain(
      "outcome === 'rework' ? VerificationStatus.NEEDS_REWORK : derivedStatus"
    );
  });

  it('refuses rework with empty notes before writing anything', () => {
    const src = body();
    const guard = src.indexOf('Rework notes are required');
    const write = src.indexOf('$transaction');
    expect(guard).toBeGreaterThan(-1);
    // Ordering matters: a validation failure after the upload leaves orphaned
    // objects, and after the transaction leaves a half-recorded inspection.
    expect(guard).toBeLessThan(src.indexOf('this.uploadPhotos('));
    expect(guard).toBeLessThan(write);
  });

  it('authorizes before it validates', () => {
    // An actor who may not inspect this assignment must get a 403, not a
    // validation hint that tells them what the request should have looked
    // like. Same posture the two single-record writers already take.
    const src = body();
    expect(src.indexOf('assertCanInspect')).toBeLessThan(src.indexOf('A photo is required'));
  });
});

describe('the shared rework helper keeps the two producers in step', () => {
  it('is used by BOTH assignRework and recordInspection', () => {
    // The worker app deep-links a REWORK_REQUIRED push on
    // data.rework_assignment_id. Two hand-written payloads would mean a push
    // that opens the right screen or nothing at all depending on which path
    // created it.
    const src = readFileSync('src/modules/quality/service.ts', 'utf8');
    expect(src.match(/this\.createReworkAssignment\(/g)).toHaveLength(2);
  });

  it('still carries the fields the deep link reads', () => {
    const src = readFileSync('src/modules/quality/service.ts', 'utf8');
    const helper = src.slice(src.indexOf('private async createReworkAssignment('));
    expect(helper).toContain('rework_assignment_id: reworkAssignment.id');
    expect(helper).toContain('rework_of_assignment_id: original.id');
  });
});

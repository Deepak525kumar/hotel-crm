import { describe, it, expect } from '@jest/globals';
import { CheckinSchema, ListCheckinsQuerySchema, GEOFENCE_RADIUS_METERS, RETENTION_MONTHS } from '../modules/geo/types.js';

/**
 * SPEC-GEO-001 @0.1.2 FROZEN: request-shape validation for the geo module.
 */

describe('CheckinSchema', () => {
  it('accepts a valid check-in payload', () => {
    const result = CheckinSchema.safeParse({ hotel_id: 'h1', latitude: 52.52, longitude: 13.405 });
    expect(result.success).toBe(true);
  });

  it('rejects a missing hotel_id', () => {
    const result = CheckinSchema.safeParse({ latitude: 52.52, longitude: 13.405 });
    expect(result.success).toBe(false);
  });

  it('rejects latitude out of range (> 90)', () => {
    const result = CheckinSchema.safeParse({ hotel_id: 'h1', latitude: 91, longitude: 13.405 });
    expect(result.success).toBe(false);
  });

  it('rejects latitude out of range (< -90)', () => {
    const result = CheckinSchema.safeParse({ hotel_id: 'h1', latitude: -91, longitude: 13.405 });
    expect(result.success).toBe(false);
  });

  it('rejects longitude out of range (> 180)', () => {
    const result = CheckinSchema.safeParse({ hotel_id: 'h1', latitude: 52.52, longitude: 181 });
    expect(result.success).toBe(false);
  });

  it('rejects longitude out of range (< -180)', () => {
    const result = CheckinSchema.safeParse({ hotel_id: 'h1', latitude: 52.52, longitude: -181 });
    expect(result.success).toBe(false);
  });

  it('accepts boundary values (±90 lat, ±180 lon)', () => {
    expect(CheckinSchema.safeParse({ hotel_id: 'h1', latitude: 90, longitude: 180 }).success).toBe(true);
    expect(CheckinSchema.safeParse({ hotel_id: 'h1', latitude: -90, longitude: -180 }).success).toBe(true);
  });

  it('rejects a non-numeric latitude/longitude', () => {
    const result = CheckinSchema.safeParse({ hotel_id: 'h1', latitude: '52.52', longitude: 13.405 });
    expect(result.success).toBe(false);
  });
});

describe('ListCheckinsQuerySchema', () => {
  it('applies default pagination', () => {
    const result = ListCheckinsQuerySchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(1);
      expect(result.data.per_page).toBe(20);
    }
  });

  it('rejects per_page above the max (100)', () => {
    const result = ListCheckinsQuerySchema.safeParse({ per_page: '101' });
    expect(result.success).toBe(false);
  });

  it('accepts optional worker_id/hotel_id filters', () => {
    const result = ListCheckinsQuerySchema.safeParse({ worker_id: 'w1', hotel_id: 'h1' });
    expect(result.success).toBe(true);
  });
});

describe('constants', () => {
  it('GEOFENCE_RADIUS_METERS matches CRR §17 (100m)', () => {
    expect(GEOFENCE_RADIUS_METERS).toBe(100);
  });

  it('RETENTION_MONTHS matches CRR §25 Tier 1 (6 months)', () => {
    expect(RETENTION_MONTHS).toBe(6);
  });
});

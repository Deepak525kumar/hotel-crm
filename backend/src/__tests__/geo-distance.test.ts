import { describe, it, expect } from '@jest/globals';
import { haversineDistanceMeters } from '../modules/geo/distance.js';

/**
 * SPEC-GEO-001 @0.1.2 FROZEN, RULE-GEO-001: geofence distance calculation.
 * Pins the Haversine implementation's correctness against known distances,
 * independent of the service/RBAC layer.
 */

describe('haversineDistanceMeters', () => {
  it('returns 0 for identical coordinates', () => {
    expect(haversineDistanceMeters(52.52, 13.405, 52.52, 13.405)).toBeCloseTo(0, 5);
  });

  it('computes a known distance accurately (Berlin to Hamburg, ~255km)', () => {
    // Berlin (52.5200, 13.4050) to Hamburg (53.5511, 9.9937) is a well-known
    // reference distance (~255 km great-circle).
    const distance = haversineDistanceMeters(52.52, 13.405, 53.5511, 9.9937);
    expect(distance).toBeGreaterThan(253000);
    expect(distance).toBeLessThan(257000);
  });

  it('computes a small (sub-100m) distance accurately', () => {
    // ~0.0009 degrees latitude is approximately 100m at these latitudes.
    const distance = haversineDistanceMeters(52.52, 13.405, 52.5209, 13.405);
    expect(distance).toBeGreaterThan(90);
    expect(distance).toBeLessThan(110);
  });

  it('is symmetric (distance(A,B) === distance(B,A))', () => {
    const ab = haversineDistanceMeters(52.52, 13.405, 48.8566, 2.3522);
    const ba = haversineDistanceMeters(48.8566, 2.3522, 52.52, 13.405);
    expect(ab).toBeCloseTo(ba, 6);
  });

  it('handles coordinates crossing the equator/prime-meridian correctly', () => {
    const distance = haversineDistanceMeters(-1, -1, 1, 1);
    expect(distance).toBeGreaterThan(0);
    expect(Number.isFinite(distance)).toBe(true);
  });
});

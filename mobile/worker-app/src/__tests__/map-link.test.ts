import { describe, it, expect } from '@jest/globals';
import { formatHotelAddress, hasCoordinates, mapsUrlFor } from '@/lib/map-link';

/**
 * Hotel map links.
 *
 * Every hotel in the database currently has an address and NO coordinates
 * (verified: 19 hotels, 0 with latitude/longitude), so the address path is the
 * one that runs in practice and is tested first here. The coordinate path is
 * tested too, because it becomes the live one the moment hotels are geocoded.
 */
const WITHOUT_COORDS = {
  name: 'Downtown Hotel', address: '1 Main St', city: 'Berlin', country: 'Germany',
  latitude: null, longitude: null,
};
const WITH_COORDS = { ...WITHOUT_COORDS, latitude: 52.52, longitude: 13.405 };

describe('formatHotelAddress', () => {
  it('produces a geocodable single line including the hotel name', () => {
    expect(formatHotelAddress(WITHOUT_COORDS)).toBe('Downtown Hotel, 1 Main St, Berlin, Germany');
  });

  it('skips missing parts rather than leaving empty commas', () => {
    expect(formatHotelAddress({ ...WITHOUT_COORDS, city: '' })).toBe('Downtown Hotel, 1 Main St, Germany');
  });
});

describe('hasCoordinates', () => {
  it('is false when either coordinate is missing', () => {
    expect(hasCoordinates(WITHOUT_COORDS)).toBe(false);
    expect(hasCoordinates({ ...WITHOUT_COORDS, latitude: 52.52 })).toBe(false);
  });

  it('accepts 0 as a real coordinate', () => {
    // The null island is a legitimate value and must not be treated as absent
    // by a truthiness check.
    expect(hasCoordinates({ ...WITHOUT_COORDS, latitude: 0, longitude: 0 })).toBe(true);
  });
});

describe('mapsUrlFor', () => {
  it('uses the address when there are no coordinates', () => {
    expect(mapsUrlFor(WITHOUT_COORDS, 'ios')).toBe(
      'http://maps.apple.com/?q=Downtown%20Hotel%2C%201%20Main%20St%2C%20Berlin%2C%20Germany'
    );
    expect(mapsUrlFor(WITHOUT_COORDS, 'android')).toBe(
      'geo:0,0?q=Downtown%20Hotel%2C%201%20Main%20St%2C%20Berlin%2C%20Germany'
    );
  });

  it('prefers coordinates when present', () => {
    expect(mapsUrlFor(WITH_COORDS, 'ios')).toContain('ll=52.52,13.405');
    expect(mapsUrlFor(WITH_COORDS, 'android')).toContain('geo:52.52,13.405');
  });

  it('uses an https link on web, where custom schemes do nothing', () => {
    expect(mapsUrlFor(WITHOUT_COORDS, 'web')).toContain('https://www.google.com/maps/search/');
    expect(mapsUrlFor(WITH_COORDS, 'web')).toContain('query=52.52,13.405');
  });

  it('escapes the address so a street name with spaces or & cannot break the URL', () => {
    const url = mapsUrlFor({ ...WITHOUT_COORDS, address: 'A&B Straße 1' }, 'android');
    expect(url).not.toContain(' ');
    expect(url).toContain('A%26B');
  });
});

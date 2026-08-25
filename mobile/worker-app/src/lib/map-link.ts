/**
 * Builds the URL that opens a hotel in the device's map app.
 *
 * Pure, and takes the platform as an argument, so it is testable — this
 * project's jest config only collects `.test.ts`, so anything left inside a
 * component is untested by construction.
 *
 * Coordinates are preferred when present because they are unambiguous. They are
 * currently null for every hotel in the database, so the address path is the
 * one that actually runs today; it must stay first-class rather than being
 * treated as a fallback that nobody tried.
 *
 * Platform-specific schemes rather than one https URL: `maps://` and `geo:`
 * open the user's own map app directly, whereas a Google Maps https link opens
 * Safari on an iPhone without Google Maps installed. Web keeps the https form
 * because a custom scheme does nothing in a browser.
 */
export type MapPlatform = 'ios' | 'android' | 'web';

export interface MappableHotel {
  name: string;
  address: string;
  city: string;
  country: string;
  latitude?: number | null;
  longitude?: number | null;
}

/** A single-line, geocodable address. The hotel name is included so the map app can label the pin. */
export function formatHotelAddress(hotel: MappableHotel): string {
  return [hotel.name, hotel.address, hotel.city, hotel.country].filter(Boolean).join(', ');
}

export function hasCoordinates(hotel: MappableHotel): boolean {
  return typeof hotel.latitude === 'number' && typeof hotel.longitude === 'number';
}

export function mapsUrlFor(hotel: MappableHotel, platform: MapPlatform): string {
  if (hasCoordinates(hotel)) {
    const coords = `${hotel.latitude},${hotel.longitude}`;
    // The label is what the pin is called once the map app opens.
    const label = encodeURIComponent(hotel.name);
    if (platform === 'ios') return `http://maps.apple.com/?ll=${coords}&q=${label}`;
    if (platform === 'android') return `geo:${coords}?q=${coords}(${label})`;
    return `https://www.google.com/maps/search/?api=1&query=${coords}`;
  }

  const query = encodeURIComponent(formatHotelAddress(hotel));
  if (platform === 'ios') return `http://maps.apple.com/?q=${query}`;
  // geo:0,0?q=<address> is the documented form for an address-only search.
  if (platform === 'android') return `geo:0,0?q=${query}`;
  return `https://www.google.com/maps/search/?api=1&query=${query}`;
}

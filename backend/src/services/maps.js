'use strict';
// F.4 / F.8 - geocoding, reverse geocoding and routing.
//
// Two adapters share one interface:
//   osm    - Nominatim + OSRM, no API key, good enough for the lab demo
//   google - Geocoding API + Directions API, used when GOOGLE_MAPS_API_KEY is set
// If the provider is unreachable the service degrades to straight-line distance
// and an average-speed ETA rather than failing the dispatch (constraint C.2).
const config = require('../config');
const { haversineKm, fallbackEtaMinutes } = require('../utils/geo');

const TIMEOUT_MS = 7000;

async function httpJson(url, headers = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': `AmbulanceBookingSystem/1.0 (${config.maps.contactEmail})`, ...headers },
    });
    if (!res.ok) throw new Error(`Map provider responded ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// ------------------------------------------------------------------- OSM
async function osmGeocode(query, pincode) {
  const q = [query, pincode].filter(Boolean).join(' ');
  const url = `${config.maps.nominatimUrl}/search?format=jsonv2&limit=5&countrycodes=in&q=${encodeURIComponent(q)}`;
  const rows = await httpJson(url);
  return rows.map((r) => ({
    latitude: Number(Number(r.lat).toFixed(6)),
    longitude: Number(Number(r.lon).toFixed(6)),
    address_text: r.display_name,
    place_id: String(r.place_id),
  }));
}

async function osmReverse(lat, lng) {
  const url = `${config.maps.nominatimUrl}/reverse?format=jsonv2&lat=${lat}&lon=${lng}`;
  const r = await httpJson(url);
  return {
    latitude: Number(lat),
    longitude: Number(lng),
    address_text: r.display_name || null,
    place_id: r.place_id ? String(r.place_id) : null,
    pincode: r.address?.postcode || null,
  };
}

async function osmRoute(from, to) {
  const url =
    `${config.maps.osrmUrl}/route/v1/driving/` +
    `${from.longitude},${from.latitude};${to.longitude},${to.latitude}` +
    '?overview=full&geometries=polyline&alternatives=false&steps=false';
  const r = await httpJson(url);
  const route = r.routes?.[0];
  if (!route) throw new Error('No route returned');
  return {
    route_polyline: route.geometry,
    route_distance_km: Number((route.distance / 1000).toFixed(2)),
    eta_minutes: Math.max(1, Math.round(route.duration / 60)),
    source: 'osrm',
  };
}

// ---------------------------------------------------------------- Google
async function googleGeocode(query, pincode) {
  const q = [query, pincode].filter(Boolean).join(' ');
  const url =
    'https://maps.googleapis.com/maps/api/geocode/json' +
    `?address=${encodeURIComponent(q)}&region=in&key=${config.maps.googleKey}`;
  const r = await httpJson(url);
  return (r.results || []).map((res) => ({
    latitude: Number(res.geometry.location.lat.toFixed(6)),
    longitude: Number(res.geometry.location.lng.toFixed(6)),
    address_text: res.formatted_address,
    place_id: res.place_id,
  }));
}

async function googleReverse(lat, lng) {
  const url =
    'https://maps.googleapis.com/maps/api/geocode/json' +
    `?latlng=${lat},${lng}&key=${config.maps.googleKey}`;
  const r = await httpJson(url);
  const res = r.results?.[0];
  const postal = res?.address_components?.find((c) => c.types.includes('postal_code'));
  return {
    latitude: Number(lat),
    longitude: Number(lng),
    address_text: res?.formatted_address || null,
    place_id: res?.place_id || null,
    pincode: postal?.long_name || null,
  };
}

async function googleRoute(from, to) {
  const url =
    'https://maps.googleapis.com/maps/api/directions/json' +
    `?origin=${from.latitude},${from.longitude}&destination=${to.latitude},${to.longitude}` +
    `&mode=driving&departure_time=now&key=${config.maps.googleKey}`;
  const r = await httpJson(url);
  const route = r.routes?.[0];
  const leg = route?.legs?.[0];
  if (!leg) throw new Error('No route returned');
  return {
    route_polyline: route.overview_polyline?.points || null,
    route_distance_km: Number((leg.distance.value / 1000).toFixed(2)),
    eta_minutes: Math.max(1, Math.round((leg.duration_in_traffic?.value || leg.duration.value) / 60)),
    source: 'google',
  };
}

// --------------------------------------------------------- public surface
const useGoogle = () => config.maps.provider === 'google' && Boolean(config.maps.googleKey);

async function geocode(query, pincode) {
  if (!query) return [];
  try {
    return useGoogle() ? await googleGeocode(query, pincode) : await osmGeocode(query, pincode);
  } catch (err) {
    console.error('[maps] geocode failed:', err.message);
    return [];
  }
}

async function reverseGeocode(lat, lng) {
  try {
    return useGoogle() ? await googleReverse(lat, lng) : await osmReverse(lat, lng);
  } catch (err) {
    console.error('[maps] reverse geocode failed:', err.message);
    return { latitude: Number(lat), longitude: Number(lng), address_text: null, place_id: null, pincode: null };
  }
}

/** Road route with a straight-line fallback so tracking never goes blank. */
async function route(from, to) {
  try {
    return useGoogle() ? await googleRoute(from, to) : await osmRoute(from, to);
  } catch (err) {
    const straight = haversineKm(from.latitude, from.longitude, to.latitude, to.longitude);
    console.error('[maps] routing failed, using straight-line estimate:', err.message);
    return {
      route_polyline: null,
      route_distance_km: Number((straight * 1.3).toFixed(2)), // road factor
      eta_minutes: fallbackEtaMinutes(straight * 1.3),
      source: 'fallback',
    };
  }
}

module.exports = { geocode, reverseGeocode, route, provider: () => (useGoogle() ? 'google' : 'osm') };

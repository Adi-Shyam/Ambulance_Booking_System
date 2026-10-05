'use strict';

const EARTH_RADIUS_KM = 6371;
const toRad = (deg) => (deg * Math.PI) / 180;

/** Great-circle distance in kilometres between two WGS-84 points. */
function haversineKm(lat1, lon1, lat2, lon2) {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Rough ETA used when the routing provider is unreachable (constraint C.2). */
function fallbackEtaMinutes(distanceKm, avgSpeedKmph = 35) {
  return Math.max(1, Math.round((distanceKm / avgSpeedKmph) * 60));
}

/** Encoded-polyline (precision 5) decoder, so the apps can draw an OSRM route. */
function decodePolyline(str, precision = 5) {
  if (!str) return [];
  const factor = 10 ** precision;
  const coordinates = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < str.length) {
    let result = 1;
    let shift = 0;
    let b;
    do {
      b = str.charCodeAt(index++) - 63 - 1;
      result += b << shift;
      shift += 5;
    } while (b >= 0x1f);
    lat += result & 1 ? ~(result >> 1) : result >> 1;

    result = 1;
    shift = 0;
    do {
      b = str.charCodeAt(index++) - 63 - 1;
      result += b << shift;
      shift += 5;
    } while (b >= 0x1f);
    lng += result & 1 ? ~(result >> 1) : result >> 1;

    coordinates.push([lat / factor, lng / factor]);
  }
  return coordinates;
}

module.exports = { haversineKm, fallbackEtaMinutes, decodePolyline };

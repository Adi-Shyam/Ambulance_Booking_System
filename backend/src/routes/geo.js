'use strict';
// F.4 - address lookup and map-pin support, backed by DFD process 0.2.2.
const express = require('express');
const { authenticate } = require('../middleware/auth');
const maps = require('../services/maps');
const { staleCutoffIso, dispatchablePredicate } = require('../services/availability');
const v = require('../utils/validate');

const router = express.Router();
const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

router.use(authenticate);

router.get('/geocode', asyncRoute(async (req, res) => {
  const q = String(v.required(req.query.q, 'q')).trim();
  const results = await maps.geocode(q, req.query.pincode);
  res.json({ provider: maps.provider(), results });
}));

router.get('/reverse', asyncRoute(async (req, res) => {
  const latitude = v.coordinate(req.query.lat, 'lat', 'lat');
  const longitude = v.coordinate(req.query.lng, 'lng', 'lng');
  res.json({ provider: maps.provider(), location: await maps.reverseGeocode(latitude, longitude) });
}));

router.get('/route', asyncRoute(async (req, res) => {
  const from = {
    latitude: v.coordinate(req.query.from_lat, 'lat', 'from_lat'),
    longitude: v.coordinate(req.query.from_lng, 'lng', 'from_lng'),
  };
  const to = {
    latitude: v.coordinate(req.query.to_lat, 'lat', 'to_lat'),
    longitude: v.coordinate(req.query.to_lng, 'lng', 'to_lng'),
  };
  res.json({ provider: maps.provider(), route: await maps.route(from, to) });
}));

/** Ambulances visible near a point - powers the "nearby" pins on the map. */
router.get('/nearby-ambulances', asyncRoute(async (req, res) => {
  const latitude = v.coordinate(req.query.lat, 'lat', 'lat');
  const longitude = v.coordinate(req.query.lng, 'lng', 'lng');
  const { db } = require('../db');
  const { haversineKm } = require('../utils/geo');
  const radius = Math.min(Number(req.query.radius_km) || 15, 50);

  // Same definition the matcher uses, so what the patient is shown as available
  // is what could actually be dispatched to them (C.6).
  const rows = db.prepare(
    `SELECT provider_id, ambulance_type, latitude, longitude, availability_status
     FROM providers p
     WHERE ${dispatchablePredicate('p')}`
  ).all(staleCutoffIso());

  const nearby = rows
    .map((p) => ({
      ...p,
      distance_km: Number(haversineKm(latitude, longitude, p.latitude, p.longitude).toFixed(2)),
    }))
    .filter((p) => p.distance_km <= radius)
    .sort((a, b) => a.distance_km - b.distance_km)
    .slice(0, 25);

  res.json({ count: nearby.length, ambulances: nearby });
}));

module.exports = router;

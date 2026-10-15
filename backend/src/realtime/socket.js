'use strict';
// Persistent channel required by SRS 3.2.4: live tracking, dispatch offers and
// status changes are pushed over Socket.IO instead of being polled.
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const config = require('../config');
const { db } = require('../db');

let io = null;

/** Mirrors the ownership rule the REST layer applies to a booking. */
function mayViewBooking(bookingId, claims) {
  if (!claims) return false;
  if (claims.role === 'ADMIN') return true;

  const booking = db
    .prepare('SELECT user_id, assigned_provider_id FROM bookings WHERE booking_id = ?')
    .get(bookingId);
  if (!booking) return false;

  return (
    booking.user_id === claims.sub ||
    (Boolean(claims.providerId) && booking.assigned_provider_id === claims.providerId)
  );
}

const roomForUser = (userId) => `user:${userId}`;
const roomForProvider = (providerId) => `provider:${providerId}`;
const roomForBooking = (bookingId) => `booking:${bookingId}`;
const ADMIN_ROOM = 'admins';

function init(httpServer) {
  io = new Server(httpServer, {
    cors: { origin: config.corsOrigin === '*' ? true : config.corsOrigin.split(','), credentials: true },
  });

  // Same JWT that guards the REST API guards the socket (NF.3).
  io.use((socket, next) => {
    const token =
      socket.handshake.auth?.token ||
      (socket.handshake.headers?.authorization || '').replace(/^Bearer\s+/i, '');
    if (!token) return next(new Error('Authentication token missing'));
    try {
      socket.user = jwt.verify(token, config.jwtSecret);
      next();
    } catch {
      next(new Error('Invalid or expired token'));
    }
  });

  io.on('connection', (socket) => {
    const { sub: userId, role } = socket.user;
    socket.join(roomForUser(userId));
    if (role === 'ADMIN') socket.join(ADMIN_ROOM);

    // Read from the database, not from the token.
    //
    // A token is issued at sign-in, and a driver creates their vehicle
    // afterwards - that is the order the app asks for them. So the token of
    // the session that creates a profile still says there is no provider, and
    // trusting it meant that driver never joined their own room: no dispatch
    // offer, no verification result, nothing, until they signed out and in
    // again and got a token that knew.
    //
    // Identity belongs in the token. Which provider an account owns is
    // mutable state, and mutable state belongs where it can change.
    const owned = db
      .prepare('SELECT provider_id FROM providers WHERE user_id = ?')
      .get(userId);
    const providerId = owned?.provider_id || null;
    if (providerId) socket.join(roomForProvider(providerId));
    socket.user.providerId = providerId;

    // A booking room carries the patient's pickup address and the ambulance's
    // live position, so joining one is an authorisation decision, not a
    // formality: only the patient who placed it, the ambulance assigned to it,
    // and administrators may listen (NF.3, constraint C.1).
    socket.on('booking:subscribe', (bookingId) => {
      if (typeof bookingId !== 'string') return;
      if (!mayViewBooking(bookingId, socket.user)) {
        socket.emit('booking:subscribe:denied', { booking_id: bookingId });
        return;
      }
      socket.join(roomForBooking(bookingId));
    });

    socket.on('booking:unsubscribe', (bookingId) => {
      if (typeof bookingId === 'string') socket.leave(roomForBooking(bookingId));
    });

    socket.emit('connected', { userId, role, providerId: providerId || null });
  });

  return io;
}

function emit(room, event, payload) {
  if (!io) return;
  io.to(room).emit(event, payload);
}

const toUser = (userId, event, payload) => emit(roomForUser(userId), event, payload);
const toProvider = (providerId, event, payload) => emit(roomForProvider(providerId), event, payload);
const toBooking = (bookingId, event, payload) => emit(roomForBooking(bookingId), event, payload);
const toAdmins = (event, payload) => emit(ADMIN_ROOM, event, payload);

module.exports = {
  init, emit, toUser, toProvider, toBooking, toAdmins,
  roomForUser, roomForProvider, roomForBooking, ADMIN_ROOM,
};

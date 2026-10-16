import { useEffect } from 'react';
import { AppState } from 'react-native';
import { io } from 'socket.io-client';
// The address is read at connect time, not at import: it is a setting the
// person can change, so a socket opened later must use the current value.
import { getBaseUrl, getToken } from './api';

let socket = null;

/**
 * Every subscription, kept apart from any particular socket.
 *
 * A screen subscribes when it mounts, which is not necessarily when a socket
 * exists, and a socket is replaced whenever the connection is rebuilt. Binding
 * handlers straight to an instance meant a screen that mounted a moment too
 * early never heard anything at all, and one that survived a reconnect kept
 * listening to a socket nobody was speaking on.
 *
 * Both failures are silent, and both look like "live tracking does not work".
 */
const listeners = new Map();

const attach = (s) => {
  listeners.forEach((handlers, event) => handlers.forEach((h) => s.on(event, h)));
};

/** Persistent channel for booking updates, live tracking and notifications. */
export function connectSocket() {
  const token = getToken();
  if (!token) return null;
  if (socket?.connected) return socket;

  socket?.disconnect();
  socket = io(getBaseUrl(), {
    auth: { token },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 1000,
  });
  // Whatever is already listening carries over to the new connection.
  attach(socket);
  return socket;
}

export const getSocket = () => socket;

export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
}

/**
 * Subscribes a component to a socket event for as long as it is mounted,
 * whether or not a socket exists yet.
 */
export function useSocketEvent(event, handler, deps = []) {
  useEffect(() => {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(handler);
    socket?.on(event, handler);

    return () => {
      listeners.get(event)?.delete(handler);
      socket?.off(event, handler);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

/**
 * Re-runs a loader whenever the socket reconnects or the app returns to the
 * foreground. Events pushed while the device was asleep, backgrounded or
 * offline are not replayed, so the screen must re-read state on resume
 * (NF.1 - the driver must never silently miss a dispatch offer).
 *
 * Registered through the same list as any other subscription, for the same
 * reason: a screen that mounts before the socket does still has to be told
 * when one arrives.
 */
export function useResync(load, deps = []) {
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') load();
    });

    if (!listeners.has('connect')) listeners.set('connect', new Set());
    listeners.get('connect').add(load);
    socket?.on('connect', load);

    return () => {
      sub.remove();
      listeners.get('connect')?.delete(load);
      socket?.off('connect', load);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

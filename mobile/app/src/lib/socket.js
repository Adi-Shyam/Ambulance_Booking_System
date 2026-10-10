import { useEffect } from 'react';
import { AppState } from 'react-native';
import { io } from 'socket.io-client';
// The address is read at connect time, not at import: it is a setting the
// person can change, so a socket opened later must use the current value.
import { getBaseUrl, getToken } from './api';

let socket = null;

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
  return socket;
}

export const getSocket = () => socket;

export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
}

/** Subscribes a component to a socket event and cleans up on unmount. */
export function useSocketEvent(event, handler, deps = []) {
  useEffect(() => {
    const s = socket;
    if (!s) return undefined;
    s.on(event, handler);
    return () => s.off(event, handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

/**
 * Re-runs a loader whenever the socket reconnects or the app returns to the
 * foreground. Events pushed while the device was asleep, backgrounded or
 * offline are not replayed, so the screen must re-read state on resume
 * (NF.1 - the driver must never silently miss a dispatch offer).
 */
export function useResync(load, deps = []) {
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') load();
    });
    const s = socket;
    s?.on('connect', load);
    return () => {
      sub.remove();
      s?.off('connect', load);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

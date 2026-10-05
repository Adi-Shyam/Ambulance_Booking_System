import { io } from 'socket.io-client';
import { api, getToken } from './api';

let socket = null;

/** One shared socket for the whole dashboard; admins join the `admins` room. */
export function getSocket() {
  const token = getToken();
  if (!token) return null;
  if (socket && socket.auth?.token === token) return socket;
  if (socket) socket.disconnect();

  socket = io(api.base, {
    auth: { token },
    transports: ['websocket', 'polling'],
  });
  return socket;
}

export function closeSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}

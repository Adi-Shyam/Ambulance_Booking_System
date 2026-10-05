import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_URL } from './config';

const TOKEN_KEY = 'abs.customer.token';

let token = null;
let onUnauthorized = null;

export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn; };

export async function loadToken() {
  token = await AsyncStorage.getItem(TOKEN_KEY);
  return token;
}

export async function saveToken(value) {
  token = value;
  await AsyncStorage.setItem(TOKEN_KEY, value);
}

export async function clearToken() {
  token = null;
  await AsyncStorage.removeItem(TOKEN_KEY);
}

export const getToken = () => token;

export class ApiError extends Error {
  constructor(message, status, payload) {
    super(message);
    this.status = status;
    this.payload = payload;
  }
}

/**
 * The in-memory copy of the token is only a cache. Storage is the source of
 * truth, so a module re-evaluation (Metro fast refresh, a remounted provider)
 * cannot leave a signed-in user making unauthenticated requests — which the
 * 401 handler would otherwise read as a genuine sign-out.
 */
async function authHeader() {
  if (!token) await loadToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function request(method, path, body) {
  let res;
  try {
    res = await fetch(API_URL + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(await authHeader()),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch (err) {
    // Constraint C.2: the app must say something useful when the network is down.
    throw new ApiError(
      `Cannot reach the server at ${API_URL}. Check that the backend is running and that your phone is on the same network.`,
      0
    );
  }

  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) {
      await clearToken();
      onUnauthorized?.();
    }
    throw new ApiError(payload.error || `Request failed (${res.status})`, res.status, payload);
  }
  return payload;
}

export const api = {
  url: API_URL,
  get: (p) => request('GET', p),
  post: (p, b) => request('POST', p, b),
  patch: (p, b) => request('PATCH', p, b),
};

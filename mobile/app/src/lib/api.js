import AsyncStorage from '@react-native-async-storage/async-storage';
import { DEFAULT_API_URL } from './config';

const TOKEN_KEY = 'abs.token';
const BASE_KEY = 'abs.apiBase';

/**
 * Where requests actually go.
 *
 * A packaged APK has its backend address compiled in, which is wrong the
 * moment the laptop joins a different network. Rather than rebuild the app for
 * a new IP, the address is a stored setting the person can edit on the sign-in
 * screen; the compiled-in value is only the default it starts from.
 */
let baseUrl = DEFAULT_API_URL;

export const getBaseUrl = () => baseUrl;
export const isBaseUrlOverridden = () => baseUrl !== DEFAULT_API_URL;

/** Normalises what someone typed, or returns null if it is not usable. */
export function normaliseBaseUrl(input) {
  let v = String(input || '').trim().replace(/\/+$/, '');
  if (!v) return null;
  // A bare host or host:port is the common case; assume plain HTTP for a LAN.
  if (!/^https?:\/\//i.test(v)) v = `http://${v}`;
  if (!/^https?:\/\/[^\s/]+$/i.test(v)) return null;
  return v;
}

export async function loadBaseUrl() {
  const stored = await AsyncStorage.getItem(BASE_KEY);
  if (stored) baseUrl = stored;
  return baseUrl;
}

export async function setBaseUrl(input) {
  const next = normaliseBaseUrl(input);
  if (!next) throw new Error('That does not look like an address. Try 192.168.1.20:4000');
  baseUrl = next;
  await AsyncStorage.setItem(BASE_KEY, next);
  return next;
}

export async function resetBaseUrl() {
  baseUrl = DEFAULT_API_URL;
  await AsyncStorage.removeItem(BASE_KEY);
  return baseUrl;
}

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
 * cannot leave a signed-in driver making unauthenticated requests — which the
 * 401 handler would otherwise read as a genuine sign-out.
 */
async function authHeader() {
  if (!token) await loadToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * How long to wait before giving up on a request.
 *
 * `fetch` has no timeout of its own: a connection that is accepted and then
 * never answered - a phone that has moved between networks, a host that is
 * black-holing packets, a free-tier container waking from sleep - leaves the
 * promise pending for ever. Whatever was awaiting it then spins for ever too,
 * which is what a driver sees as a button that never stops loading.
 *
 * Generous rather than snappy, because a sleeping Render instance genuinely
 * takes most of a minute to answer its first request.
 */
const REQUEST_TIMEOUT_MS = 60_000;

async function request(method, path, body) {
  let res;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), REQUEST_TIMEOUT_MS);
  try {
    res = await fetch(baseUrl + path, {
      method,
      signal: abort.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(await authHeader()),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch (err) {
    // Constraint C.2: the app must say something useful when the network is down.
    if (err.name === 'AbortError') {
      throw new ApiError(
        `The server at ${baseUrl} did not answer within a minute. It may be asleep — try again, and it should be quicker the second time.`,
        0
      );
    }
    throw new ApiError(
      `Cannot reach the server at ${baseUrl}. Check the backend is running, that this phone is on the same network, and that the address above is right — you can change it on the sign-in screen.`,
      0
    );
  } finally {
    clearTimeout(timer);
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
  // A getter, not a snapshot: the address can change while the app is running.
  get url() { return baseUrl; },
  get: (p) => request('GET', p),
  post: (p, b) => request('POST', p, b),
  patch: (p, b) => request('PATCH', p, b),
  // Named `del` because `delete` is a reserved word.
  del: (p, b) => request('DELETE', p, b),
};

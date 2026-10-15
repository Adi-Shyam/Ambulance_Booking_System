import * as Location from 'expo-location';

/**
 * Reads the device's position, or gives up.
 *
 * `getCurrentPositionAsync` waits for a fix and has no timeout of its own.
 * Indoors, in a basement, or on a phone that has just been switched on, that
 * wait does not end - and the caller, typically a driver tapping "go on
 * duty", watches a button load for ever.
 *
 * So: try the fix the phone already has, then ask for a fresh one with a
 * deadline, then fall back to a stale fix rather than nothing. A position from
 * two minutes ago is a far better answer than an infinite wait, and the
 * 20-second ping loop corrects it almost immediately.
 */

const FRESH_TIMEOUT_MS = 12_000;
const LAST_KNOWN_MAX_AGE_MS = 2 * 60_000;

/** Rejects rather than hanging, so a caller's `finally` always runs. */
function withDeadline(promise, ms, message) {
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error(message), { code: 'TIMEOUT' })), ms);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

const shape = (pos) => ({
  latitude: Number(pos.coords.latitude.toFixed(6)),
  longitude: Number(pos.coords.longitude.toFixed(6)),
  speed_kmph:
    pos.coords.speed != null && pos.coords.speed >= 0
      ? Number((pos.coords.speed * 3.6).toFixed(1))
      : undefined,
});

/**
 * Asks once, and only when the answer is not already on record. Asking on
 * every attempt is how an app teaches people to tap Deny.
 */
export async function ensureLocationPermission() {
  const existing = await Location.getForegroundPermissionsAsync();
  if (existing.granted) return true;
  if (!existing.canAskAgain) return false;
  const asked = await Location.requestForegroundPermissionsAsync();
  return asked.granted;
}

/**
 * Returns `{ latitude, longitude, speed_kmph? }`, or throws with a message
 * worth showing. `stale` is true when the fix came from the cache.
 */
export async function readPosition({ accuracy = Location.Accuracy.Balanced } = {}) {
  if (!(await ensureLocationPermission())) {
    throw Object.assign(
      new Error('Location permission was declined. Set your position on the map instead.'),
      { code: 'DENIED' }
    );
  }

  // Instant when the phone already knows where it is, which is most of the
  // time outdoors with another app having asked recently.
  try {
    const known = await Location.getLastKnownPositionAsync({ maxAge: LAST_KNOWN_MAX_AGE_MS });
    if (known) return { ...shape(known), stale: false };
  } catch {
    // Not worth reporting: the fresh read below is the real attempt.
  }

  try {
    const fresh = await withDeadline(
      Location.getCurrentPositionAsync({ accuracy }),
      FRESH_TIMEOUT_MS,
      'Could not get a GPS fix'
    );
    return { ...shape(fresh), stale: false };
  } catch (err) {
    // A fix of any age beats refusing to answer.
    const known = await Location.getLastKnownPositionAsync({}).catch(() => null);
    if (known) return { ...shape(known), stale: true };

    throw Object.assign(
      new Error(
        err.code === 'TIMEOUT'
          ? 'No GPS fix yet. Move somewhere with a clearer view of the sky, or set your position on the map.'
          : err.message
      ),
      { code: err.code || 'UNAVAILABLE' }
    );
  }
}

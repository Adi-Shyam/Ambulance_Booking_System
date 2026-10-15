import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { api, clearToken, loadBaseUrl, loadToken, saveToken, setUnauthorizedHandler } from './api';
import { registerForPush, unregisterPush } from './push';
import { connectSocket, disconnectSocket } from './socket';
import { modeForRoleCode, roleFor } from './config';

const AuthContext = createContext(null);

/**
 * One session for the whole app (F.1, F.2).
 *
 * `mode` is the role the person chose at sign-in - it decides which set of tabs
 * the navigator mounts. It is derived from the account's own role_code rather
 * than trusted from the picker, so a stored session restores into the right
 * console on restart without the picker being involved at all.
 */
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [provider, setProvider] = useState(null);
  const [mode, setMode] = useState(null);
  const [booting, setBooting] = useState(true);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setUser(null);
      setProvider(null);
      setMode(null);
    });

    (async () => {
      // One try/finally around the whole thing. `booting` gates the entire
      // app behind a "Starting up..." screen, so anything that throws before
      // it is cleared - storage unavailable, a malformed stored address -
      // leaves the app on that screen with no way forward.
      try {
        // The stored backend address has to be in place before the first
        // request, otherwise boot would talk to the compiled-in default.
        await loadBaseUrl();

        const token = await loadToken();
        if (!token) return;

        const me = await api.get('/api/auth/me');
        setUser(me.user);
        setProvider(me.provider);
        setMode(modeForRoleCode(me.user.role_code));
        connectSocket();
      } catch (err) {
        // A token that cannot be used is worse than none: it would send the
        // app to a signed-in screen that then fails every request.
        console.warn('[auth] starting signed out:', err.message);
        await clearToken().catch(() => {});
      } finally {
        setBooting(false);
      }
    })();
  }, []);

  /**
   * Accepts a fresh session only if the account matches the mode that was
   * chosen. A token that is issued and then discarded locally is still live on
   * the server for 24 hours, so a rejected session is revoked, not forgotten.
   */
  async function adopt(session, roleKey) {
    await saveToken(session.session_token);

    const wanted = roleFor(roleKey);
    const actual = session.user.role_code;

    if (wanted && !wanted.accepts.includes(actual)) {
      await api.post('/api/auth/logout', {}).catch(() => {});
      await clearToken();
      const theirMode = roleFor(modeForRoleCode(actual));
      throw new Error(
        theirMode
          ? `This account signs in under "${theirMode.title}". Go back and choose that mode.`
          : 'This account cannot be used here.'
      );
    }

    setUser(session.user);
    setProvider(session.provider || null);
    setMode(modeForRoleCode(actual));
    connectSocket();

    // Register this handset for push every time somebody signs in, not once
    // on install: the token has to follow whoever is actually signed in here,
    // and it can rotate. Deliberately not awaited - a driver should not wait
    // on a permission dialog to reach their console, and a refusal is not an
    // error worth surfacing at sign-in.
    registerForPush().catch(() => {});

    return session.user;
  }

  const value = useMemo(
    () => ({
      user,
      provider,
      mode,
      booting,

      /**
       * F.2: the chosen mode is sent as role_code where the server can check it,
       * and verified here where it cannot (the provider console covers two role
       * codes, and /api/auth/login only accepts one).
       */
      /**
       * `identifier` is an email address or a mobile number. An account made
       * by verifying an address knows that address; it may not remember which
       * number it typed at sign-up, so either has to work.
       */
      async signIn(roleKey, identifier, password) {
        const role = roleFor(roleKey);
        const body = {
          ...(String(identifier).includes('@')
            ? { email_id: identifier }
            : { phone_no: identifier }),
          password,
        };
        if (role?.roleCode) body.role_code = role.roleCode;
        return adopt(await api.post('/api/auth/login', body), roleKey);
      },

      /**
       * Starts a registration: the server checks the details and emails a
       * code. It does not create the account - `verifyOtp` does, once the
       * code comes back - so there is no session to adopt here.
       */
      startRegistration: (details) => api.post('/api/auth/register', details),

      /**
       * Forgotten password, in two steps like registration.
       *
       * `forgotPassword` answers the same way whether or not the address has
       * an account, so the screen cannot be used to ask which addresses are
       * registered. The person who mistyped theirs finds out from the email
       * that never arrives.
       */
      forgotPassword: (email_id) => api.post('/api/auth/password/forgot', { email_id }),

      resetPassword: (email_id, otp_code, new_password) =>
        api.post('/api/auth/password/reset', { email_id, otp_code, new_password }),

      /**
       * Asks for a code against one contact detail. `identifier` is an email
       * address or a mobile number; the server works out which from the shape
       * it arrives in, so the screen does not have to.
       *
       * REGISTER rather than the LOGIN default, because this one screen serves
       * both signing in and signing up, and LOGIN refuses an address it does
       * not know.
       */
      requestOtp: (identifier, options = {}) =>
        api.post('/api/auth/otp/request', {
          ...(String(identifier).includes('@')
            ? { email_id: identifier }
            : { phone_no: identifier }),
          purpose: 'REGISTER',
          ...options,
        }),

      /**
       * A correct code on an unknown number registers it (F.1). The server
       * asks for a name when it needs one rather than failing, so `details`
       * carries whatever the screen has collected.
       */
      async verifyOtp(roleKey, identifier, otp_code, details = {}) {
        const role = roleFor(roleKey);
        const body = {
          ...(String(identifier).includes('@')
            ? { email_id: identifier }
            : { phone_no: identifier }),
          otp_code,
          ...details,
        };
        // The provider console covers two role codes; default new accounts
        // there to DRIVER, which the person can turn into an organisation when
        // they add their vehicle.
        if (!body.role_code) body.role_code = role?.roleCode || (roleKey === 'PROVIDER' ? 'DRIVER' : 'USER');
        return adopt(await api.post('/api/auth/otp/verify', body), roleKey);
      },

      /**
       * Re-reads the account and, if there is one, its vehicle profile.
       *
       * Exposed under two names because the callers mean different things by
       * it: a patient editing their own details wants `refresh`, while a driver
       * waiting on an administrator wants `refreshProvider` - the same request
       * either way, since /api/auth/me returns both.
       */
      async refresh() {
        const me = await api.get('/api/auth/me');
        setUser(me.user);
        setProvider(me.provider);
        return me;
      },

      async refreshProvider() {
        const me = await api.get('/api/auth/me');
        setUser(me.user);
        setProvider(me.provider);
        return me.provider;
      },

      async signOut() {
        // Before the token is revoked, while the request can still be
        // authorised: a shared phone must not keep delivering this driver's
        // dispatch offers to whoever picks it up next.
        await unregisterPush();

        // Revoke server-side first; clearing the token locally alone would leave
        // a usable token in existence for the rest of its 24 hours.
        await api.post('/api/auth/logout', {}).catch(() => {});
        await clearToken();
        disconnectSocket();
        setUser(null);
        setProvider(null);
        setMode(null);
      },
    }),
    [user, provider, mode, booting]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);

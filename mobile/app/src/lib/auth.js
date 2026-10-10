import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { api, clearToken, loadBaseUrl, loadToken, saveToken, setUnauthorizedHandler } from './api';
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
      // The stored backend address has to be in place before the first
      // request, otherwise boot would talk to the compiled-in default.
      await loadBaseUrl();

      const token = await loadToken();
      if (!token) {
        setBooting(false);
        return;
      }
      try {
        const me = await api.get('/api/auth/me');
        setUser(me.user);
        setProvider(me.provider);
        setMode(modeForRoleCode(me.user.role_code));
        connectSocket();
      } catch {
        await clearToken();
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
      async signIn(roleKey, phone_no, password) {
        const role = roleFor(roleKey);
        const body = { phone_no, password };
        if (role?.roleCode) body.role_code = role.roleCode;
        return adopt(await api.post('/api/auth/login', body), roleKey);
      },

      async register(roleKey, details) {
        return adopt(await api.post('/api/auth/register', details), roleKey);
      },

      requestOtp: (phone_no) => api.post('/api/auth/otp/request', { phone_no }),

      async verifyOtp(roleKey, phone_no, otp_code) {
        return adopt(await api.post('/api/auth/otp/verify', { phone_no, otp_code }), roleKey);
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

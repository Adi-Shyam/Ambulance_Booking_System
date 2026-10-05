import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { api, clearToken, loadToken, saveToken, setUnauthorizedHandler } from './api';
import { connectSocket, disconnectSocket } from './socket';

const AuthContext = createContext(null);

// F.2: this console serves the two provider-side roles. A patient or an
// administrator account exists in the same table, so the app has to turn them
// away itself rather than let them in with a useless session.
const PROVIDER_ROLES = ['DRIVER', 'ORG'];

const ROLE_LABEL = {
  USER: 'a patient',
  ADMIN: 'an administrator',
};

const WRONG_APP = {
  USER: 'Use the patient app to book an ambulance.',
  ADMIN: 'Use the control-room dashboard in a browser.',
};

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [provider, setProvider] = useState(null);
  const [booting, setBooting] = useState(true);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setUser(null);
      setProvider(null);
    });

    (async () => {
      const token = await loadToken();
      if (!token) {
        setBooting(false);
        return;
      }
      try {
        const me = await api.get('/api/auth/me');
        setUser(me.user);
        setProvider(me.provider);
        connectSocket();
      } catch {
        await clearToken();
      } finally {
        setBooting(false);
      }
    })();
  }, []);

  /**
   * Accepts a fresh session only if the account is a provider one. A token that
   * is issued and then discarded locally is still live on the server for 24
   * hours, so the rejected session is revoked rather than merely forgotten.
   */
  async function adopt(session) {
    await saveToken(session.session_token);

    if (!PROVIDER_ROLES.includes(session.user.role_code)) {
      await api.post('/api/auth/logout', {}).catch(() => {});
      await clearToken();
      const role = ROLE_LABEL[session.user.role_code] || session.user.role_code;
      throw new Error(
        `This account is registered as ${role}, not a driver. ${WRONG_APP[session.user.role_code] || ''}`.trim()
      );
    }

    setUser(session.user);
    setProvider(session.provider || null);
    connectSocket();
    return session.user;
  }

  const value = useMemo(
    () => ({
      user,
      provider,
      booting,

      async signIn(phone_no, password) {
        return adopt(await api.post('/api/auth/login', { phone_no, password }));
      },

      // F.1: a driver registers themselves; an organisation registers the fleet
      // account and adds its vehicle in the next step.
      async register(details) {
        return adopt(await api.post('/api/auth/register', details));
      },

      requestOtp: (phone_no) => api.post('/api/auth/otp/request', { phone_no }),

      async verifyOtp(phone_no, otp_code) {
        return adopt(await api.post('/api/auth/otp/verify', { phone_no, otp_code }));
      },

      /**
       * Re-reads the vehicle profile. Called after the profile is first created,
       * and whenever an administrator changes its verification status (F.13), so
       * the console unlocks without the driver restarting the app.
       */
      async refreshProvider() {
        const me = await api.get('/api/auth/me');
        setUser(me.user);
        setProvider(me.provider);
        return me.provider;
      },

      async signOut() {
        // Tell the server first so the session is revoked in D1; clearing the
        // token locally alone would leave a usable token in existence.
        await api.post('/api/auth/logout', {}).catch(() => {});
        await clearToken();
        disconnectSocket();
        setUser(null);
        setProvider(null);
      },
    }),
    [user, provider, booting]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { api, clearToken, loadToken, saveToken, setUnauthorizedHandler } from './api';
import { connectSocket, disconnectSocket } from './socket';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [booting, setBooting] = useState(true);

  useEffect(() => {
    setUnauthorizedHandler(() => setUser(null));

    (async () => {
      const token = await loadToken();
      if (!token) {
        setBooting(false);
        return;
      }
      try {
        const me = await api.get('/api/auth/me');
        setUser(me.user);
        connectSocket();
      } catch {
        await clearToken();
      } finally {
        setBooting(false);
      }
    })();
  }, []);

  const value = useMemo(
    () => ({
      user,
      booting,

      // F.2: the patient app always signs in as the USER role.
      async signIn(phone_no, password) {
        const r = await api.post('/api/auth/login', { phone_no, password, role_code: 'USER' });
        await saveToken(r.session_token);
        setUser(r.user);
        connectSocket();
        return r.user;
      },

      // F.1: registration with basic details.
      async register(details) {
        const r = await api.post('/api/auth/register', { ...details, role_code: 'USER' });
        await saveToken(r.session_token);
        setUser(r.user);
        connectSocket();
        return r.user;
      },

      // F.1: passwordless sign-in through a one-time password.
      requestOtp: (phone_no) => api.post('/api/auth/otp/request', { phone_no }),

      async verifyOtp(phone_no, otp_code) {
        const r = await api.post('/api/auth/otp/verify', { phone_no, otp_code });
        await saveToken(r.session_token);
        setUser(r.user);
        connectSocket();
        return r.user;
      },

      async signOut() {
        // Tell the server first so the session is revoked in D1; clearing the
        // token locally alone would leave a usable token in existence.
        await api.post('/api/auth/logout', {}).catch(() => {});
        await clearToken();
        disconnectSocket();
        setUser(null);
      },

      async refresh() {
        const me = await api.get('/api/auth/me');
        setUser(me.user);
        return me.user;
      },
    }),
    [user, booting]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);

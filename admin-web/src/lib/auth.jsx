import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { api, getToken, setToken, clearToken } from './api';
import { closeSocket } from './socket';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(Boolean(getToken()));

  useEffect(() => {
    if (!getToken()) return;
    api
      .get('/api/auth/me')
      .then((r) => setUser(r.user))
      .catch(() => clearToken())
      .finally(() => setLoading(false));
  }, []);

  const value = useMemo(
    () => ({
      user,
      loading,
      async signIn(phone_no, password) {
        // F.2: the administrator mode is requested explicitly at sign-in.
        const r = await api.post('/api/auth/login', { phone_no, password, role_code: 'ADMIN' });
        setToken(r.session_token);
        setUser(r.user);
        return r.user;
      },
      signOut() {
        // Revoke server-side first, then drop the local token.
        api.post('/api/auth/logout', {}).catch(() => {});
        clearToken();
        closeSocket();
        setUser(null);
      },
    }),
    [user, loading]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);

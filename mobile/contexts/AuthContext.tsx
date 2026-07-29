import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { authApi } from '../services/api';
import { saveAuth, getToken, clearAuth, getSavedUser } from '../services/auth';
import { registerForPushNotifications } from '../services/notifications';
import type { User } from '../types';

interface AuthContextValue {
  user: User | null;
  token: string | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<User>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Re-hydrate from secure storage on startup
  useEffect(() => {
    (async () => {
      try {
        const [savedToken, savedUser] = await Promise.all([getToken(), getSavedUser()]);

        if (savedToken) {
          // Immediately set what we have so the app doesn't flash the login screen.
          setToken(savedToken);
          if (savedUser) {
            setUser(savedUser as User);
          }
          setLoading(false);

          try {
            // Verify token in background and refresh cached profile.
            const me = await authApi.me();
            setUser(me);
            await saveAuth(savedToken, me);
            // Register push notifications after auth is restored
            registerForPushNotifications().catch(() => {});
          } catch (err: any) {
            // Only clear on auth errors; keep session for transient network issues.
            if (err.message?.includes('401')) {
              await clearAuth();
              setToken(null);
              setUser(null);
            }
          }
        } else {
          setLoading(false);
        }
      } catch (e) {
        setLoading(false);
      }
    })();
  }, []);

  const login = useCallback(async (email: string, password: string): Promise<User> => {
    const res = await authApi.login({ email, password });
    await saveAuth(res.access_token, res.user);
    setToken(res.access_token);
    setUser(res.user);
    // Register push token after login (non-blocking)
    registerForPushNotifications().catch(() => {});
    return res.user;
  }, []);

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } catch {}
    await clearAuth();
    setToken(null);
    setUser(null);
  }, []);

  const refreshUser = useCallback(async () => {
    try {
      const me = await authApi.me();
      setUser(me);
    } catch {}
  }, []);

  return (
    <AuthContext.Provider value={{ user, token, loading, login, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

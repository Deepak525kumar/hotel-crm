import { create } from 'zustand';
import { deleteItem, getItem, setItem } from '@/lib/persistent-storage';
import { router } from 'expo-router';
import { api, setAccessToken, setRefreshToken, setOnTokenRefreshed, setOnAuthFailure, getAccessToken, getRefreshToken } from '@/lib/api';
import type { User } from '@/types/api';
import { ALLOWED_ROLES } from '@/constants/app-config';

/**
 * Thrown when the credentials are valid but the account's role has no business
 * in this app. Enforced here rather than on the login screen because the screen
 * is not the only way a session enters the store: a session restored from
 * storage on launch never passes through it, so a role check that lives only
 * there lets a previously-signed-in account of the wrong role back in on every
 * subsequent launch. Setting `user` also releases the AuthGuard, which
 * navigates into `(app)` the moment it sees a user -- so the check has to run
 * *before* the store is populated, not after.
 */
export class RoleNotAllowedError extends Error {
  constructor() {
    super('This account does not have access to this app');
    this.name = 'RoleNotAllowedError';
  }
}

const isAllowedRole = (user: User | null | undefined): boolean =>
  !!user && ALLOWED_ROLES.includes(user.role);

const KEYS = {
  ACCESS_TOKEN: 'hotel_crm_access_token',
  REFRESH_TOKEN: 'hotel_crm_refresh_token',
} as const;

interface AuthState {
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
  isLoading: boolean;
  isInitialized: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  initialize: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  accessToken: null,
  refreshToken: null,
  isLoading: false,
  isInitialized: false,

  initialize: async () => {
    try {
      const accessToken = await getItem(KEYS.ACCESS_TOKEN);
      const refreshToken = await getItem(KEYS.REFRESH_TOKEN);

      if (accessToken) {
        setAccessToken(accessToken);
        setRefreshToken(refreshToken);
        try {
          const user = await api.auth.me();
          if (!isAllowedRole(user)) {
            // A stored session for an account of the wrong role: drop it and
            // start signed out rather than restoring it.
            throw new RoleNotAllowedError();
          }
          // Read tokens from the module mirror after me() returns: a transparent startup
          // refresh inside request() updates _accessToken/_refreshToken before returning,
          // so these values are always current regardless of whether a refresh occurred.
          set({ user, accessToken: getAccessToken(), refreshToken: getRefreshToken(), isInitialized: true });
          return;
        } catch {
          setAccessToken(null);
          setRefreshToken(null);
          await deleteItem(KEYS.ACCESS_TOKEN);
          await deleteItem(KEYS.REFRESH_TOKEN);
        }
      }
    } catch {
      // ignore storage errors on first run
    }
    set({ isInitialized: true });
  },

  login: async (email, password) => {
    set({ isLoading: true });
    try {
      // Normalized here, not at the call site, so every entry point benefits.
      // Reported from the field: a valid credential was rejected as "Invalid
      // credentials". Cause: signup stores the address lowercased, the backend
      // looked users up by literal email, and Postgres compares
      // case-sensitively — so any capital letter the user typed produced a 401
      // on their own account. The backend is being fixed too, but normalizing
      // client-side means a build keeps working against a backend that has not
      // been updated yet, and email addresses are case-insensitive in practice
      // regardless.
      const response = await api.auth.login(email.trim().toLowerCase(), password);
      setAccessToken(response.access_token);
      setRefreshToken(response.refresh_token);
      if (!isAllowedRole(response.user)) {
        // Revoke the tokens the backend just issued, then leave the store
        // untouched so no session -- not even a momentary one -- exists.
        try {
          await api.auth.logout();
        } catch {
          // ignore -- the local session is discarded either way
        }
        setAccessToken(null);
        setRefreshToken(null);
        set({ isLoading: false });
        throw new RoleNotAllowedError();
      }
      await setItem(KEYS.ACCESS_TOKEN, response.access_token);
      await setItem(KEYS.REFRESH_TOKEN, response.refresh_token);
      set({
        user: response.user,
        accessToken: response.access_token,
        refreshToken: response.refresh_token,
        isLoading: false,
      });
    } catch (error) {
      set({ isLoading: false });
      throw error;
    }
  },

  logout: async () => {
    try {
      await api.auth.logout();
    } catch {
      // ignore – clear local state regardless
    }
    setAccessToken(null);
    setRefreshToken(null);
    await deleteItem(KEYS.ACCESS_TOKEN);
    await deleteItem(KEYS.REFRESH_TOKEN);
    set({ user: null, accessToken: null, refreshToken: null });
  },
}));

// Register API callbacks once at module load time.
// These persist for the lifetime of the app process.

setOnTokenRefreshed(async (access: string, refresh: string) => {
  await setItem(KEYS.ACCESS_TOKEN, access);
  await setItem(KEYS.REFRESH_TOKEN, refresh);
  useAuthStore.setState({ accessToken: access, refreshToken: refresh });
});

setOnAuthFailure(async () => {
  setAccessToken(null);
  setRefreshToken(null);
  await deleteItem(KEYS.ACCESS_TOKEN);
  await deleteItem(KEYS.REFRESH_TOKEN);
  useAuthStore.setState({ user: null, accessToken: null, refreshToken: null });
});

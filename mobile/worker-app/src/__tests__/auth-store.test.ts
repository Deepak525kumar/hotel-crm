// jest.mock calls are hoisted before imports — mocks are in place before
// auth-store.ts runs its module-level setOnTokenRefreshed/setOnAuthFailure calls.
import * as SecureStore from 'expo-secure-store';
import { useAuthStore } from '@/stores/auth-store';
import { api, setAccessToken, setRefreshToken, getAccessToken, getRefreshToken } from '@/lib/api';

jest.mock('expo-router', () => ({ router: { replace: jest.fn() } }));
jest.mock('@/lib/api', () => ({
  api: {
    auth: {
      me: jest.fn(),
      login: jest.fn(),
      logout: jest.fn(),
    },
  },
  setAccessToken: jest.fn(),
  setRefreshToken: jest.fn(),
  setOnTokenRefreshed: jest.fn(),
  setOnAuthFailure: jest.fn(),
  getAccessToken: jest.fn(),
  getRefreshToken: jest.fn(),
}));

const mockSecureStore = SecureStore as unknown as {
  getItemAsync: jest.Mock;
  setItemAsync: jest.Mock;
  deleteItemAsync: jest.Mock;
  _reset: () => void;
};

const mockApi = api as unknown as {
  auth: {
    me: jest.Mock;
    login: jest.Mock;
    logout: jest.Mock;
  };
};

const mockSetAccessToken = setAccessToken as jest.Mock;
const mockSetRefreshToken = setRefreshToken as jest.Mock;
const mockGetAccessToken = getAccessToken as jest.Mock;
const mockGetRefreshToken = getRefreshToken as jest.Mock;

const storeReset = {
  user: null,
  accessToken: null,
  refreshToken: null,
  isLoading: false,
  isInitialized: false,
};

const mockUser = {
  id: 'u1',
  email: 'worker@hotel.com',
  first_name: 'Ada',
  last_name: 'Lovelace',
  role: 'worker' as const,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockSecureStore._reset();
  useAuthStore.setState(storeReset);
});

// ---------------------------------------------------------------------------
// initialize()
// ---------------------------------------------------------------------------

describe('initialize()', () => {
  it('sets isInitialized with no stored tokens — stays logged out', async () => {
    mockSecureStore.getItemAsync.mockResolvedValue(null);

    await useAuthStore.getState().initialize();

    const state = useAuthStore.getState();
    expect(state.isInitialized).toBe(true);
    expect(state.user).toBeNull();
    expect(mockApi.auth.me).not.toHaveBeenCalled();
  });

  it('restores session when stored tokens are valid', async () => {
    mockSecureStore.getItemAsync
      .mockResolvedValueOnce('stored-access')
      .mockResolvedValueOnce('stored-refresh');
    mockApi.auth.me.mockResolvedValue(mockUser);
    mockGetAccessToken.mockReturnValue('stored-access');
    mockGetRefreshToken.mockReturnValue('stored-refresh');

    await useAuthStore.getState().initialize();

    const state = useAuthStore.getState();
    expect(state.isInitialized).toBe(true);
    expect(state.user).toEqual(mockUser);
    expect(mockSetAccessToken).toHaveBeenCalledWith('stored-access');
    expect(mockSetRefreshToken).toHaveBeenCalledWith('stored-refresh');
  });

  it('clears storage and stays logged out when api.auth.me() throws', async () => {
    mockSecureStore.getItemAsync
      .mockResolvedValueOnce('stored-access')
      .mockResolvedValueOnce('stored-refresh');
    mockApi.auth.me.mockRejectedValue(new Error('network'));

    await useAuthStore.getState().initialize();

    const state = useAuthStore.getState();
    expect(state.isInitialized).toBe(true);
    expect(state.user).toBeNull();
    expect(mockSecureStore.deleteItemAsync).toHaveBeenCalledWith('hotel_crm_access_token');
    expect(mockSecureStore.deleteItemAsync).toHaveBeenCalledWith('hotel_crm_refresh_token');
    // api module token cleared
    expect(mockSetAccessToken).toHaveBeenCalledWith(null);
    expect(mockSetRefreshToken).toHaveBeenCalledWith(null);
  });

  it('swallows SecureStore errors and sets isInitialized', async () => {
    mockSecureStore.getItemAsync.mockRejectedValue(new Error('SecureStore unavailable'));

    await useAuthStore.getState().initialize();

    const state = useAuthStore.getState();
    expect(state.isInitialized).toBe(true);
    expect(state.user).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// login()
// ---------------------------------------------------------------------------

describe('login()', () => {
  it('sets user and tokens on success', async () => {
    const authResponse = {
      user: mockUser,
      access_token: 'new-access',
      refresh_token: 'new-refresh',
      expires_in: 3600,
    };
    mockApi.auth.login.mockResolvedValue(authResponse);

    await useAuthStore.getState().login('worker@hotel.com', 'pass123');

    const state = useAuthStore.getState();
    expect(state.user).toEqual(mockUser);
    expect(state.accessToken).toBe('new-access');
    expect(state.refreshToken).toBe('new-refresh');
    expect(state.isLoading).toBe(false);
  });

  it('writes tokens to SecureStore on success', async () => {
    const authResponse = {
      user: mockUser,
      access_token: 'new-access',
      refresh_token: 'new-refresh',
      expires_in: 3600,
    };
    mockApi.auth.login.mockResolvedValue(authResponse);

    await useAuthStore.getState().login('worker@hotel.com', 'pass123');

    expect(mockSecureStore.setItemAsync).toHaveBeenCalledWith('hotel_crm_access_token', 'new-access');
    expect(mockSecureStore.setItemAsync).toHaveBeenCalledWith('hotel_crm_refresh_token', 'new-refresh');
  });

  it('sets isLoading: false and rethrows on failure', async () => {
    const err = new Error('invalid credentials');
    mockApi.auth.login.mockRejectedValue(err);

    await expect(useAuthStore.getState().login('bad@email.com', 'wrong')).rejects.toThrow('invalid credentials');

    const state = useAuthStore.getState();
    expect(state.isLoading).toBe(false);
    expect(state.user).toBeNull();
  });

  it('does not write to SecureStore on failure', async () => {
    mockApi.auth.login.mockRejectedValue(new Error('bad'));

    await expect(useAuthStore.getState().login('a@b.com', 'x')).rejects.toThrow();

    expect(mockSecureStore.setItemAsync).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// logout()
// ---------------------------------------------------------------------------

describe('logout()', () => {
  it('clears user, tokens, and SecureStore on success', async () => {
    useAuthStore.setState({ user: mockUser, accessToken: 'tok', refreshToken: 'ref' });
    mockApi.auth.logout.mockResolvedValue(undefined);

    await useAuthStore.getState().logout();

    const state = useAuthStore.getState();
    expect(state.user).toBeNull();
    expect(state.accessToken).toBeNull();
    expect(state.refreshToken).toBeNull();
    expect(mockSecureStore.deleteItemAsync).toHaveBeenCalledWith('hotel_crm_access_token');
    expect(mockSecureStore.deleteItemAsync).toHaveBeenCalledWith('hotel_crm_refresh_token');
  });

  it('clears local state even when api.auth.logout() throws', async () => {
    useAuthStore.setState({ user: mockUser, accessToken: 'tok', refreshToken: 'ref' });
    mockApi.auth.logout.mockRejectedValue(new Error('network'));

    await useAuthStore.getState().logout();

    const state = useAuthStore.getState();
    expect(state.user).toBeNull();
    expect(state.accessToken).toBeNull();
    expect(mockSecureStore.deleteItemAsync).toHaveBeenCalledTimes(2);
  });

  it('clears api module tokens on logout', async () => {
    mockApi.auth.logout.mockResolvedValue(undefined);

    await useAuthStore.getState().logout();

    expect(mockSetAccessToken).toHaveBeenCalledWith(null);
    expect(mockSetRefreshToken).toHaveBeenCalledWith(null);
  });
});

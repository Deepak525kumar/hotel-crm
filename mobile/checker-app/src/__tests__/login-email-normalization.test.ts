import { describe, it, expect, jest, beforeEach } from '@jest/globals';

/**
 * Login email normalization.
 *
 * Reported from the field: a valid credential was rejected as "Invalid
 * credentials". Reproduced against a real backend — signup stores the address
 * lowercased, login looked the user up by literal email, and Postgres compares
 * case-sensitively:
 *
 *   signup { email: "ctrA-1@test.local" } -> stored "ctra-1@test.local"
 *   login  { email: "ctrA-1@test.local" } -> 401 Invalid credentials
 *   login  { email: "ctra-1@test.local" } -> 200
 *
 * The backend is fixed separately. This pins the client half, which matters
 * independently: an installed build keeps working against a backend that has
 * not been updated yet, and a mobile app cannot be redeployed as quickly as
 * the server.
 *
 * Trimming is asserted alongside because a soft keyboard's trailing space is
 * the other way a user's own address stops matching.
 */

// Mock created inside the factory and read back afterwards: ES imports are
// hoisted above module-scope consts, so a factory closing over an outer const
// hits the temporal dead zone.
jest.mock('@/lib/api', () => ({
  api: { auth: { login: jest.fn(), me: jest.fn() } },
  setAccessToken: jest.fn(),
  setRefreshToken: jest.fn(),
  getAccessToken: jest.fn(),
  getRefreshToken: jest.fn(),
  // The store registers a refresh callback at module load; without this the
  // import throws before any test runs.
  setOnTokenRefreshed: jest.fn(),
  setOnAuthFailure: jest.fn(),
  ApiError: class ApiError extends Error {},
}));
jest.mock('@/lib/persistent-storage', () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
  deleteItem: jest.fn(async () => undefined),
}));

import { useAuthStore } from '@/stores/auth-store';

const { api } = require('@/lib/api');
const login = api.auth.login as jest.MockedFunction<(...a: any[]) => any>;

describe('login email normalization', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    login.mockResolvedValue({
      access_token: 'a', refresh_token: 'r',
      user: { id: 'u1', email: 'john@example.com', role: 'checker' },
    });
  });

  it('lowercases the email before sending it', async () => {
    await useAuthStore.getState().login('John.Smith@Example.COM', 'pw');
    expect(login).toHaveBeenCalledWith('john.smith@example.com', 'pw');
  });

  it('trims surrounding whitespace', async () => {
    await useAuthStore.getState().login('  john@example.com  ', 'pw');
    expect(login).toHaveBeenCalledWith('john@example.com', 'pw');
  });

  it('leaves the password untouched', async () => {
    // Passwords are case-sensitive; normalizing one would break every account.
    await useAuthStore.getState().login('J@E.CO', '  MixedCase PW  ');
    expect(login).toHaveBeenCalledWith('j@e.co', '  MixedCase PW  ');
  });
});

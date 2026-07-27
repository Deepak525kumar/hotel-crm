// Epic 7 PR 7.7: device push-token registration.
// jest.mock calls are hoisted before imports, matching auth-store.test.ts.
jest.mock('expo-notifications', () => ({
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  getDevicePushTokenAsync: jest.fn(),
  setNotificationHandler: jest.fn(),
  addNotificationResponseReceivedListener: jest.fn(),
}));
jest.mock('@/lib/api', () => ({
  api: { notifications: { registerPushToken: jest.fn() } },
}));

import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { api } from '@/lib/api';
import { registerForPushNotificationsAsync, subscribeToPushNotifications } from '@/lib/push-notifications';

const mockNotifications = Notifications as unknown as {
  getPermissionsAsync: jest.Mock;
  requestPermissionsAsync: jest.Mock;
  getDevicePushTokenAsync: jest.Mock;
  setNotificationHandler: jest.Mock;
  addNotificationResponseReceivedListener: jest.Mock;
};

const mockRegister = (api as unknown as {
  notifications: { registerPushToken: jest.Mock };
}).notifications.registerPushToken;

function setPlatform(os: string) {
  Object.defineProperty(Platform, 'OS', { value: os, configurable: true });
}

// The failure paths log intentionally (see push-notifications.ts); silence it
// so a passing run has clean output, while still asserting the return value.
let warnSpy: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  setPlatform('ios');
  mockNotifications.getPermissionsAsync.mockResolvedValue({ status: 'granted' });
  mockNotifications.requestPermissionsAsync.mockResolvedValue({ status: 'granted' });
  mockNotifications.getDevicePushTokenAsync.mockResolvedValue({ type: 'ios', data: 'apns-token-abc' });
  mockRegister.mockResolvedValue({ id: 'pt1' });
});

afterEach(() => {
  warnSpy.mockRestore();
});

describe('registerForPushNotificationsAsync', () => {
  it('registers an iOS token with platform IOS and this build’s app', async () => {
    await expect(registerForPushNotificationsAsync()).resolves.toBe('registered');

    expect(mockRegister).toHaveBeenCalledWith({
      token: 'apns-token-abc',
      platform: 'IOS',
      app: 'CHECKER',
    });
  });

  it('registers an Android token with platform ANDROID', async () => {
    setPlatform('android');
    mockNotifications.getDevicePushTokenAsync.mockResolvedValue({ type: 'android', data: 'fcm-token-xyz' });

    await expect(registerForPushNotificationsAsync()).resolves.toBe('registered');

    expect(mockRegister).toHaveBeenCalledWith({
      token: 'fcm-token-xyz',
      platform: 'ANDROID',
      app: 'CHECKER',
    });
  });

  it('does not re-prompt when permission is already granted', async () => {
    await registerForPushNotificationsAsync();

    expect(mockNotifications.requestPermissionsAsync).not.toHaveBeenCalled();
  });

  it('prompts when permission is undetermined, then registers on grant', async () => {
    mockNotifications.getPermissionsAsync.mockResolvedValue({ status: 'undetermined' });
    mockNotifications.requestPermissionsAsync.mockResolvedValue({ status: 'granted' });

    await expect(registerForPushNotificationsAsync()).resolves.toBe('registered');
    expect(mockNotifications.requestPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(mockRegister).toHaveBeenCalledTimes(1);
  });

  it('returns permission-denied and never reads a token or calls the API when denied', async () => {
    mockNotifications.getPermissionsAsync.mockResolvedValue({ status: 'undetermined' });
    mockNotifications.requestPermissionsAsync.mockResolvedValue({ status: 'denied' });

    await expect(registerForPushNotificationsAsync()).resolves.toBe('permission-denied');
    expect(mockNotifications.getDevicePushTokenAsync).not.toHaveBeenCalled();
    expect(mockRegister).not.toHaveBeenCalled();
  });

  it('returns unsupported-platform on web without touching the permission API', async () => {
    setPlatform('web');

    await expect(registerForPushNotificationsAsync()).resolves.toBe('unsupported-platform');
    expect(mockNotifications.getPermissionsAsync).not.toHaveBeenCalled();
    expect(mockRegister).not.toHaveBeenCalled();
  });

  // Push is an enhancement: no failure below may propagate and break the app.
  it('returns failed (does not throw) when the backend registration rejects', async () => {
    mockRegister.mockRejectedValue(new Error('500 Internal Server Error'));

    await expect(registerForPushNotificationsAsync()).resolves.toBe('failed');
    // Failures are swallowed, but must remain diagnosable from device logs.
    expect(warnSpy).toHaveBeenCalled();
  });

  it('returns failed (does not throw) when the device token cannot be read', async () => {
    mockNotifications.getDevicePushTokenAsync.mockRejectedValue(new Error('no push capability'));

    await expect(registerForPushNotificationsAsync()).resolves.toBe('failed');
    expect(mockRegister).not.toHaveBeenCalled();
  });

  it('returns failed (does not throw) when the permission check itself rejects', async () => {
    mockNotifications.getPermissionsAsync.mockRejectedValue(new Error('permission API unavailable'));

    await expect(registerForPushNotificationsAsync()).resolves.toBe('failed');
  });
});

describe('subscribeToPushNotifications', () => {
  const mockRemove = jest.fn();
  const mockRouter = { push: jest.fn() } as unknown as Parameters<typeof subscribeToPushNotifications>[0];

  beforeEach(() => {
    mockRemove.mockReset();
    (mockRouter.push as jest.Mock).mockReset();
    mockNotifications.addNotificationResponseReceivedListener.mockReturnValue({ remove: mockRemove });
  });

  it('registers a foreground handler that shows the banner/sound/badge/list', () => {
    subscribeToPushNotifications(mockRouter);

    expect(mockNotifications.setNotificationHandler).toHaveBeenCalledWith(
      expect.objectContaining({ handleNotification: expect.any(Function) }),
    );
  });

  it('navigates to the Alerts tab when a delivered notification is tapped', () => {
    subscribeToPushNotifications(mockRouter);

    const onResponse = mockNotifications.addNotificationResponseReceivedListener.mock.calls[0][0];
    onResponse();

    expect(mockRouter.push).toHaveBeenCalledWith('/notifications');
  });

  it('returns an unsubscribe function that removes the response listener', () => {
    const unsubscribe = subscribeToPushNotifications(mockRouter);
    expect(mockRemove).not.toHaveBeenCalled();

    unsubscribe();

    expect(mockRemove).toHaveBeenCalledTimes(1);
  });
});

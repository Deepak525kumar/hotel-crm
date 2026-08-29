// Epic 7 PR 7.7: device push-token registration.
// jest.mock calls are hoisted before imports, matching auth-store.test.ts.
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { api } from '@/lib/api';
import { registerForPushNotificationsAsync, subscribeToPushNotifications, resolvePushTapRoute } from '@/lib/push-notifications';

jest.mock('expo-notifications', () => ({
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  getDevicePushTokenAsync: jest.fn(),
  setNotificationHandler: jest.fn(),
  addNotificationResponseReceivedListener: jest.fn(),
  addNotificationReceivedListener: jest.fn(),
}));
jest.mock('@/lib/api', () => ({
  api: { notifications: { registerPushToken: jest.fn() } },
}));

const mockNotifications = Notifications as unknown as {
  getPermissionsAsync: jest.Mock;
  requestPermissionsAsync: jest.Mock;
  getDevicePushTokenAsync: jest.Mock;
  setNotificationHandler: jest.Mock;
  addNotificationResponseReceivedListener: jest.Mock;
  addNotificationReceivedListener: jest.Mock;
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
      app: 'WORKER',
    });
  });

  it('registers an Android token with platform ANDROID', async () => {
    setPlatform('android');
    mockNotifications.getDevicePushTokenAsync.mockResolvedValue({ type: 'android', data: 'fcm-token-xyz' });

    await expect(registerForPushNotificationsAsync()).resolves.toBe('registered');

    expect(mockRegister).toHaveBeenCalledWith({
      token: 'fcm-token-xyz',
      platform: 'ANDROID',
      app: 'WORKER',
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

// Job Dispatch Phase 2: resolvePushTapRoute() is the pure routing decision
// extracted from the listener callback — tested directly here without
// mocking expo-notifications' response shape.
describe('resolvePushTapRoute', () => {
  it('opens the shift when the end-of-shift digest is tapped', () => {
    // The digest is about a whole shift, so it lands where the per-room checks
    // are listed rather than on the Alerts tab.
    expect(
      resolvePushTapRoute({ type: 'QUALITY_VERIFICATION_SUBMITTED', assignment_id: 'a1' })
    ).toBe('/shift/a1');
  });

  it('falls back to Alerts when the digest payload has no assignment', () => {
    // A malformed or older payload must not produce '/shift/undefined'.
    expect(resolvePushTapRoute({ type: 'QUALITY_VERIFICATION_SUBMITTED' })).toBe('/notifications');
    expect(
      resolvePushTapRoute({ type: 'QUALITY_VERIFICATION_SUBMITTED', assignment_id: 42 })
    ).toBe('/notifications');
  });

  it('routes a JOB_REQUEST_BROADCAST payload to its offer detail screen', () => {
    const route = resolvePushTapRoute({ type: 'JOB_REQUEST_BROADCAST', work_request_id: 'jr1', hotel_id: 'h1', skill: 'CLEANER' });
    expect(route).toBe('/offer/jr1');
  });

  it('falls back to the Alerts tab for a JOB_REQUEST_BROADCAST payload missing work_request_id', () => {
    const route = resolvePushTapRoute({ type: 'JOB_REQUEST_BROADCAST' });
    expect(route).toBe('/notifications');
  });

  it('falls back to the Alerts tab for a recognized-but-different type', () => {
    const route = resolvePushTapRoute({ type: 'ASSIGNMENT_CONFIRMED', assignment_id: 'a1' });
    expect(route).toBe('/notifications');
  });

  it('falls back to the Alerts tab when data is undefined', () => {
    expect(resolvePushTapRoute(undefined)).toBe('/notifications');
  });

  it('falls back to the Alerts tab when data is null', () => {
    expect(resolvePushTapRoute(null)).toBe('/notifications');
  });

  it('falls back to the Alerts tab when data is an empty object', () => {
    expect(resolvePushTapRoute({})).toBe('/notifications');
  });
});

describe('subscribeToPushNotifications', () => {
  const mockRemove = jest.fn();
  const mockRouter = { push: jest.fn() } as unknown as Parameters<typeof subscribeToPushNotifications>[0];

  function makeResponse(data?: Record<string, unknown>) {
    return { notification: { request: { content: { data } } } } as any;
  }

  beforeEach(() => {
    mockRemove.mockReset();
    (mockRouter.push as jest.Mock).mockReset();
    mockNotifications.addNotificationResponseReceivedListener.mockReturnValue({ remove: mockRemove });
    mockNotifications.addNotificationReceivedListener.mockReturnValue({ remove: jest.fn() });
  });

  // Web guard. expo-notifications has no working foreground handler on web,
  // and calling setNotificationHandler there can throw -- which would take out
  // the whole component tree, since this runs from PushRegistration on mount.
  // registerForPushNotificationsAsync already bailed out on web the same way
  // (see its own 'web' case above); this makes the sibling consistent.
  describe('on web', () => {
    afterEach(() => setPlatform('ios'));

    it('does not touch expo-notifications at all', () => {
      setPlatform('web');
      subscribeToPushNotifications(mockRouter);

      expect(mockNotifications.setNotificationHandler).not.toHaveBeenCalled();
      expect(
        mockNotifications.addNotificationResponseReceivedListener,
      ).not.toHaveBeenCalled();
    });

    it('still returns a callable unsubscribe, so cleanup does not crash', () => {
      setPlatform('web');
      const unsubscribe = subscribeToPushNotifications(mockRouter);

      // The caller unconditionally invokes this in a useEffect teardown; a
      // guard that returned undefined would turn "push is unavailable" into
      // a crash on unmount.
      expect(typeof unsubscribe).toBe('function');
      expect(() => unsubscribe()).not.toThrow();
    });
  });

  it('registers a foreground handler that shows the banner/sound/badge/list', () => {
    subscribeToPushNotifications(mockRouter);

    expect(mockNotifications.setNotificationHandler).toHaveBeenCalledWith(
      expect.objectContaining({ handleNotification: expect.any(Function) }),
    );
  });

  it('navigates to the Alerts tab when a delivered notification with no recognized data is tapped', () => {
    subscribeToPushNotifications(mockRouter);

    const onResponse = mockNotifications.addNotificationResponseReceivedListener.mock.calls[0][0];
    onResponse(makeResponse(undefined));

    expect(mockRouter.push).toHaveBeenCalledWith('/notifications');
  });

  it('navigates directly to the offer screen when a JOB_REQUEST_BROADCAST notification is tapped', () => {
    subscribeToPushNotifications(mockRouter);

    const onResponse = mockNotifications.addNotificationResponseReceivedListener.mock.calls[0][0];
    onResponse(makeResponse({ type: 'JOB_REQUEST_BROADCAST', work_request_id: 'jr1', hotel_id: 'h1', skill: 'CLEANER' }));

    expect(mockRouter.push).toHaveBeenCalledWith('/offer/jr1');
  });

  it('returns an unsubscribe function that removes the response listener', () => {
    const unsubscribe = subscribeToPushNotifications(mockRouter);
    expect(mockRemove).not.toHaveBeenCalled();

    unsubscribe();

    expect(mockRemove).toHaveBeenCalledTimes(1);
  });
});

// CRR §14: the rework push must open the screen where the worker uploads
// evidence, not the generic notifications list -- a worker has 20 minutes
// before the escalation fires, so an extra hop to find the task is not free.
describe('resolvePushTapRoute — rework (CRR §14)', () => {
  it('routes to the rework screen and carries the note', () => {
    const route = resolvePushTapRoute({
      type: 'REWORK_REQUIRED',
      rework_assignment_id: 'a1',
      notes: 'Bathroom mirror',
    });
    expect(route).toBe('/rework/a1?notes=Bathroom%20mirror');
  });

  it('still routes when the note is absent', () => {
    const route = resolvePushTapRoute({ type: 'REWORK_REQUIRED', rework_assignment_id: 'a1' });
    expect(route).toBe('/rework/a1?notes=');
  });

  it('falls back to the list when the assignment id is missing', () => {
    // An older backend, or a payload shape this app version predates, must not
    // navigate to /rework/undefined.
    expect(resolvePushTapRoute({ type: 'REWORK_REQUIRED' })).toBe('/notifications');
  });
});

import { useNotificationStore } from '@/stores/notification-store';
import { api } from '@/lib/api';

jest.mock('@/lib/api', () => ({ api: { notifications: { list: jest.fn() } } }));
jest.mock('react-native', () => ({
  AppState: { addEventListener: jest.fn(() => ({ remove: jest.fn() })) },
}));

const list = api.notifications.list as jest.MockedFunction<typeof api.notifications.list>;

function notif(read_at: string | null) {
  return { id: Math.random().toString(), user_id: 'u', type: 'SYSTEM', title: '', message: '', read_at, created_at: '' };
}

describe('notification store', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useNotificationStore.setState({ unread: 0 });
  });

  it('counts only unread notifications', async () => {
    list.mockResolvedValue([notif(null), notif('2026-01-01'), notif(null)] as never);
    await useNotificationStore.getState().refresh();
    expect(useNotificationStore.getState().unread).toBe(2);
  });

  // Several bells are mounted at once (Expo Router keeps visited tabs alive)
  // and all refresh on foreground. Without single-flight that was N requests,
  // and a slow earlier response could overwrite a newer count.
  it('shares one request between concurrent callers', async () => {
    list.mockResolvedValue([notif(null)] as never);
    const { refresh } = useNotificationStore.getState();
    await Promise.all([refresh(), refresh(), refresh()]);
    expect(list).toHaveBeenCalledTimes(1);
  });

  it('issues a new request once the previous one has settled', async () => {
    list.mockResolvedValue([notif(null)] as never);
    await useNotificationStore.getState().refresh();
    await useNotificationStore.getState().refresh();
    expect(list).toHaveBeenCalledTimes(2);
  });

  // A poll failing on one screen must not blank the badge everywhere.
  it('keeps the previous count when a poll fails', async () => {
    list.mockResolvedValue([notif(null), notif(null)] as never);
    await useNotificationStore.getState().refresh();
    list.mockRejectedValue(new Error('offline'));
    await expect(useNotificationStore.getState().refresh()).resolves.toBeUndefined();
    expect(useNotificationStore.getState().unread).toBe(2);
  });

  it('starts one timer for many subscribers and stops on the last unsubscribe', () => {
    const a = useNotificationStore.getState().subscribe();
    const b = useNotificationStore.getState().subscribe();
    // One AppState listener, not one per subscriber.
    expect(jest.requireMock('react-native').AppState.addEventListener).toHaveBeenCalledTimes(1);
    a();
    b();
    expect(() => a()).not.toThrow();
  });
});

import { describe, it, expect, jest, afterEach } from '@jest/globals';
import { ResendProviderClient, SendgridProviderClient } from '../modules/notifications/email-provider.js';

const originalFetch = global.fetch;

function mockFetchOnce(response: { ok: boolean; status?: number; statusText?: string; body?: string }) {
  const fn = jest.fn(async () => ({
    ok: response.ok,
    status: response.status ?? (response.ok ? 200 : 500),
    statusText: response.statusText ?? (response.ok ? 'OK' : 'Internal Server Error'),
    text: async () => response.body ?? '',
  })) as unknown as typeof fetch;
  global.fetch = fn;
  return fn;
}

describe('SendgridProviderClient (Epic 7 PR 7.4, ADR-029 §4)', () => {
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('POSTs to the SendGrid v3 mail/send endpoint with the correct payload shape', async () => {
    const fetchMock = mockFetchOnce({ ok: true });
    const client = new SendgridProviderClient('sg-secret-key');

    await client.send({ to: 'worker@example.com', from: 'no-reply@hotelcrm.app', subject: 'Hi', text: 'Body text' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = (fetchMock as jest.Mock).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.sendgrid.com/v3/mail/send');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sg-secret-key');
    const body = JSON.parse(init.body as string);
    expect(body.personalizations).toEqual([{ to: [{ email: 'worker@example.com' }] }]);
    expect(body.from).toEqual({ email: 'no-reply@hotelcrm.app' });
    expect(body.subject).toBe('Hi');
    expect(body.content).toEqual([{ type: 'text/plain', value: 'Body text' }]);
  });

  it('throws on a non-2xx response, without leaking the API key', async () => {
    mockFetchOnce({ ok: false, status: 401, statusText: 'Unauthorized', body: 'bad auth' });
    const client = new SendgridProviderClient('sg-secret-key');

    await expect(
      client.send({ to: 'a@b.com', from: 'x@y.com', subject: 's', text: 't' })
    ).rejects.toThrow(/401/);
    await expect(
      client.send({ to: 'a@b.com', from: 'x@y.com', subject: 's', text: 't' })
    ).rejects.not.toThrow(/sg-secret-key/);
  });

  it('propagates a network-level fetch rejection', async () => {
    global.fetch = jest.fn(async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;
    const client = new SendgridProviderClient('sg-secret-key');

    await expect(client.send({ to: 'a@b.com', from: 'x@y.com', subject: 's', text: 't' })).rejects.toThrow(
      'ECONNREFUSED'
    );
  });
});

describe('ResendProviderClient (Epic 7 PR 7.4, ADR-029 §4)', () => {
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('POSTs to the Resend emails endpoint with the correct payload shape', async () => {
    const fetchMock = mockFetchOnce({ ok: true });
    const client = new ResendProviderClient('re-secret-key');

    await client.send({ to: 'worker@example.com', from: 'no-reply@hotelcrm.app', subject: 'Hi', text: 'Body text' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = (fetchMock as jest.Mock).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.resend.com/emails');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer re-secret-key');
    const body = JSON.parse(init.body as string);
    expect(body.from).toBe('no-reply@hotelcrm.app');
    expect(body.to).toEqual(['worker@example.com']);
    expect(body.subject).toBe('Hi');
    expect(body.text).toBe('Body text');
  });

  it('throws on a non-2xx response, without leaking the API key', async () => {
    mockFetchOnce({ ok: false, status: 429, statusText: 'Too Many Requests', body: 'rate limited' });
    const client = new ResendProviderClient('re-secret-key');

    await expect(
      client.send({ to: 'a@b.com', from: 'x@y.com', subject: 's', text: 't' })
    ).rejects.toThrow(/429/);
    await expect(
      client.send({ to: 'a@b.com', from: 'x@y.com', subject: 's', text: 't' })
    ).rejects.not.toThrow(/re-secret-key/);
  });

  it('propagates a network-level fetch rejection', async () => {
    global.fetch = jest.fn(async () => {
      throw new Error('ETIMEDOUT');
    }) as unknown as typeof fetch;
    const client = new ResendProviderClient('re-secret-key');

    await expect(client.send({ to: 'a@b.com', from: 'x@y.com', subject: 's', text: 't' })).rejects.toThrow(
      'ETIMEDOUT'
    );
  });
});

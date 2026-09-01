/**
 * EMAIL transport provider clients (Epic 7 PR 7.4, ADR-029 SS4).
 *
 * Each client owns everything specific to its provider — endpoint, auth
 * header shape, request/response payload — behind the one generic
 * `EmailProviderClient.send()` contract. `EmailTransportHandler`
 * (outbox-transport.ts) depends only on that contract; it must never branch
 * on which provider is configured or construct a provider-specific request.
 *
 * Implemented via the platform `fetch` (Node 20) against each provider's
 * plain HTTP send endpoint — no SDK dependency, keeping the footprint (and
 * what a reviewer has to trust) small. MIG-GAP-11 carryover: the API key is
 * read once at construction and used only in the Authorization header of
 * this module's own requests — never logged, never included in a thrown
 * error's message.
 */

import { wrapHtmlEmail } from './email-template.js';

export interface EmailProviderClient {
  send(input: { to: string; from: string; subject: string; text: string }): Promise<void>;
}

async function readErrorBody(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 500);
  } catch {
    return '<unreadable response body>';
  }
}

export class SendgridProviderClient implements EmailProviderClient {
  constructor(private readonly apiKey: string) {}

  async send(input: { to: string; from: string; subject: string; text: string }): Promise<void> {
    const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: input.to }] }],
        from: { email: input.from },
        subject: input.subject,
        content: [{ type: 'text/html', value: wrapHtmlEmail(input.subject, input.text) }],
      }),
    });

    if (!res.ok) {
      throw new Error(`SendGrid send failed: ${res.status} ${res.statusText} — ${await readErrorBody(res)}`);
    }
  }
}

export class ResendProviderClient implements EmailProviderClient {
  constructor(private readonly apiKey: string) {}

  async send(input: { to: string; from: string; subject: string; text: string }): Promise<void> {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: input.from,
        to: [input.to],
        subject: input.subject,
        html: wrapHtmlEmail(input.subject, input.text),
      }),
    });

    if (!res.ok) {
      throw new Error(`Resend send failed: ${res.status} ${res.statusText} — ${await readErrorBody(res)}`);
    }
  }
}

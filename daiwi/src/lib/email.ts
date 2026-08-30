/**
 * Outbound email, used only for password resets.
 *
 * Implemented against Resend's plain HTTP endpoint rather than an SDK — the same
 * choice the CRM made in backend/src/modules/notifications/email-provider.ts, and
 * for the same reason: one fetch call is less to install and less to trust.
 *
 * The API key is read once here and only ever appears in this module's own
 * Authorization header. It is never logged, and never included in a thrown error.
 */

/**
 * Overridable so a local run can point at a capture server and exercise the real
 * send path end to end. Production leaves it unset and uses Resend directly.
 */
const RESEND_ENDPOINT = process.env.RESEND_ENDPOINT || "https://api.resend.com/emails";

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

export async function sendEmail(message: EmailMessage): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM_ADDRESS;

  if (!apiKey || !from) {
    // Loud in the log, silent to the caller's user: a reset request must not
    // reveal whether delivery is even possible.
    console.error("email: RESEND_API_KEY / EMAIL_FROM_ADDRESS not set — message dropped");
    throw new Error("email transport not configured");
  }

  const res = await fetch(RESEND_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [message.to],
      subject: message.subject,
      text: message.text,
    }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    let detail = "";
    try {
      detail = (await res.text()).slice(0, 300);
    } catch {
      detail = "<unreadable response body>";
    }
    throw new Error(`email provider returned ${res.status}: ${detail}`);
  }
}

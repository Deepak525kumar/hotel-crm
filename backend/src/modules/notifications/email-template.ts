function escapeHtml(unsafe: string): string {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function wrapHtmlEmail(subject: string, text: string): string {
  const safeSubject = escapeHtml(subject);
  
  // Truncate text to 10000 chars to prevent email clipping (Gmail clips at 102KB)
  let truncatedText = text;
  if (truncatedText.length > 10000) {
    truncatedText = truncatedText.slice(0, 10000) + '... [Message Truncated]';
  }
  
  let htmlBody = escapeHtml(truncatedText);
  
  // Very basic markdown/text link conversion: 
  // If the text contains a raw http:// or https:// link that looks like a call to action
  // e.g. "Click this link to reset it: http://..."
  // We'll wrap standalone links in a button
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  
  htmlBody = htmlBody.replace(urlRegex, (url) => {
    return `<br><br><a href="${url}" style="display: inline-block; padding: 12px 24px; background-color: #2563eb; color: #ffffff; text-decoration: none; border-radius: 6px; font-weight: bold; margin: 16px 0;">Access Link</a><br><br><span style="font-size: 12px; color: #6b7280;">If the button doesn't work, copy and paste this link: <a href="${url}" style="color: #2563eb;">${url}</a></span>`;
  });

  // Convert newlines to <br> tags for basic paragraph structure
  htmlBody = htmlBody.replace(/\n/g, '<br>');

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${safeSubject}</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f3f4f6; margin: 0; padding: 0; line-height: 1.6;">
  <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #f3f4f6; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="100%" max-width="600" border="0" cellspacing="0" cellpadding="0" style="max-width: 600px; background-color: #ffffff; border-radius: 8px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06); overflow: hidden;">
          <!-- Header -->
          <tr>
            <td style="background-color: #1e293b; padding: 24px 32px; text-align: center;">
              <h1 style="color: #ffffff; margin: 0; font-size: 24px; font-weight: 600; letter-spacing: -0.5px;">Hotel CRM</h1>
            </td>
          </tr>
          
          <!-- Content -->
          <tr>
            <td style="padding: 40px 32px; color: #334155; font-size: 16px;">
              <h2 style="color: #0f172a; margin-top: 0; margin-bottom: 24px; font-size: 20px;">${safeSubject}</h2>
              <p style="margin: 0; color: #475569;">
                ${htmlBody}
              </p>
            </td>
          </tr>
          
          <!-- Footer -->
          <tr>
            <td style="background-color: #f8fafc; padding: 24px 32px; text-align: center; border-top: 1px solid #e2e8f0;">
              <p style="margin: 0; color: #94a3b8; font-size: 14px;">
                This is an automated message from Hotel CRM.<br>
                Please do not reply directly to this email.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}

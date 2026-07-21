/** A new-message notification email, sent only when the recipient's
 * school_profiles.email_notify_messages is true and they have an email on
 * file. Simpler than waitlistConfirmation.ts's full VML/mso-fallback
 * treatment since this is a routine notification, not a first-touch
 * milestone email -- same brand colors, plain inline styles. */
export function buildMessageNotificationEmail({
  title,
  excerpt,
  appUrl,
}: {
  title: string;
  excerpt: string;
  appUrl: string;
}): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0; padding:0; background-color:#0a0d1c; font-family:Helvetica, Arial, sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#0a0d1c;">
    <tr>
      <td align="center" style="padding:36px 16px;">
        <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="width:480px; max-width:480px;">
          <tr>
            <td style="background-color:#141935; border:1px solid #2b3260; border-radius:16px; padding:32px 36px;">
              <p style="margin:0 0 8px; color:#b09cdc; font-size:11px; letter-spacing:0.08em; text-transform:uppercase;">New message</p>
              <h1 style="margin:0 0 12px; color:#f7f2e6; font-size:20px; font-weight:600;">${title}</h1>
              <p style="margin:0 0 24px; color:rgba(247,242,230,0.75); font-size:14px; line-height:1.6;">${excerpt}</p>
              <a href="${appUrl}" style="display:inline-block; padding:10px 22px; background-color:#c7a252; color:#0a0d1c; font-size:13px; font-weight:700; text-decoration:none; border-radius:18px;">View message</a>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 4px 0;" align="center">
              <p style="margin:0; color:rgba(247,242,230,0.4); font-size:11px;">FreeLoom &middot; you can turn these off in Settings &rarr; Notifications</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

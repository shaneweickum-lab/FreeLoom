/** The waitlist confirmation email's HTML, built from a design the user
 * supplied directly (table-based layout, mso/VML fallbacks, a hidden
 * preheader) rather than the plain inline-styled snippet this route used
 * to send. Kept as its own module since it's a large literal, not logic. */
export const WAITLIST_CONFIRMATION_HTML = `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<title>You're on the FreeLoom list</title>
<!--[if mso]>
<noscript>
  <xml>
    <o:OfficeDocumentSettings>
      <o:PixelsPerInch>96</o:PixelsPerInch>
    </o:OfficeDocumentSettings>
  </xml>
</noscript>
<![endif]-->
<style>
  /* Client resets */
  body, table, td, a { -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }
  table, td { mso-table-lspace:0pt; mso-table-rspace:0pt; }
  img { border:0; height:auto; line-height:100%; outline:none; text-decoration:none; -ms-interpolation-mode:bicubic; }
  table { border-collapse:collapse !important; }
  body { margin:0; padding:0; width:100% !important; height:100% !important; background-color:#0a0d1c; }

  /* Web font — will fall back gracefully where blocked (Outlook desktop, some Gmail contexts) */
  @media screen {
    @font-face {
      font-family:'Fraunces';
      src: url('https://fonts.gstatic.com/s/fraunces/v31/6NUh8FyLNQOQZAnv9bYEvDiIdE9Ea92uemAn5Q.ttf') format('truetype');
      font-weight:500;
    }
  }

  .heading { font-family:'Fraunces', Georgia, 'Times New Roman', serif; }
  .body-font { font-family:'Helvetica Neue', Helvetica, Arial, sans-serif; }
  .mono { font-family:'Courier New', Courier, monospace; }

  @media only screen and (max-width:600px) {
    .email-container { width:100% !important; }
    .fluid-pad { padding-left:20px !important; padding-right:20px !important; }
    .demo-stack td { display:block !important; width:100% !important; }
    .demo-connector { display:none !important; }
  }
</style>
</head>
<body style="margin:0; padding:0; background-color:#0a0d1c;">

  <!-- Preheader (hidden preview text) -->
  <div style="display:none; max-height:0; overflow:hidden; mso-hide:all;">
    You're on the FreeLoom waitlist — real learning, formally recorded. We'll let you know the moment it's your turn.
  </div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#0a0d1c;">
    <tr>
      <td align="center" style="padding:36px 16px;">

        <table role="presentation" class="email-container" width="600" cellpadding="0" cellspacing="0" style="width:600px; max-width:600px;">

          <!-- Logo mark -->
          <tr>
            <td align="center" style="padding-bottom:28px;">
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="background-color:#1c2242; border-radius:10px; width:44px; height:44px;" align="center" valign="middle">
                    <span class="heading" style="color:#c7a252; font-size:20px; font-weight:600;">F</span>
                  </td>
                  <td style="width:12px;">&nbsp;</td>
                  <td valign="middle">
                    <span class="heading" style="color:#f7f2e6; font-size:19px; font-weight:600; letter-spacing:0.02em;">FreeLoom</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Main card -->
          <tr>
            <td class="fluid-pad" style="background-color:#141935; border:1px solid #2b3260; border-radius:16px; padding:44px 48px;">

              <!-- Eyebrow -->
              <table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:0 auto 22px;">
                <tr>
                  <td style="border:1px solid rgba(137,104,201,0.5); border-radius:20px; padding:7px 16px;">
                    <span class="mono" style="color:#b09cdc; font-size:11px; letter-spacing:0.08em; text-transform:uppercase;">You're on the list</span>
                  </td>
                </tr>
              </table>

              <!-- Headline -->
              <h1 class="heading" style="margin:0 0 16px; text-align:center; color:#f7f2e6; font-size:30px; font-weight:600; line-height:1.15;">
                Real learning,<br><em style="color:#e6c878; font-style:italic; font-weight:500;">formally recorded.</em>
              </h1>

              <p class="body-font" style="margin:0 0 34px; text-align:center; color:rgba(247,242,230,0.68); font-size:15.5px; line-height:1.65;">
                Thanks for joining the FreeLoom waitlist. You're one of the first families in line for a record-keeper built specifically for how unschooling and wildschooling families actually learn — we'll email you the moment your spot opens up.
              </p>

              <!-- CTA -->
              <table role="presentation" cellpadding="0" cellspacing="0" align="center">
                <tr>
                  <td style="border-radius:20px; background-color:#c7a252;">
                    <a href="https://www.freeloom.io" target="_blank" class="body-font" style="display:inline-block; padding:12px 28px; color:#0a0d1c; font-size:14px; font-weight:700; text-decoration:none; border-radius:20px;">
                      See how it works
                    </a>
                  </td>
                </tr>
              </table>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td class="fluid-pad" style="padding:28px 20px 8px;" align="center">
              <p class="body-font" style="margin:0; color:rgba(247,242,230,0.4); font-size:12px; line-height:1.6;">
                FreeLoom &middot; A record-keeping platform for unschooling and wildschooling families
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>

</body>
</html>
`;

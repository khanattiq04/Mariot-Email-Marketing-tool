/**
 * GET /api/unsubscribe - the target of the Unsubscribe button in the footer.
 *
 * The link carries the recipient's address, so a click is all it takes: there is
 * no session and no subscriber list to look the address up in. A click emails
 * the admin address (MAIL_UNSUBSCRIBE_EMAIL, default admin@mariotkitchen.com)
 * with the person's name and address, then shows the recipient a confirmation
 * page.
 *
 * Served as a serverless function on Vercel and by scripts/dev.js locally;
 * public/api/unsubscribe.php is the PHP twin for PHP hosting.
 *
 * Reads: MAIL_UNSUBSCRIBE_EMAIL, MAIL_FROM_EMAIL, MAIL_FROM_NAME,
 *        BREVO_API_KEY, RESEND_API_KEY, MAILERSEND_API_KEY
 */

const adminEmail = process.env.MAIL_UNSUBSCRIBE_EMAIL || "admin@mariotkitchen.com";
const fromEmail  = process.env.MAIL_FROM_EMAIL || "marketing@mariotstore.com";
const fromName   = process.env.MAIL_FROM_NAME || "Mariot Store";

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

// This tool addresses campaigns by email and stores no names, so derive a
// readable one from the address ("john.doe@example.com" -> "John Doe") to give
// the admin something human to read next to the address.
function recipientName(email) {
  return (
    String(email)
      .split("@")[0]
      .split(/[._\-+]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ") || "Unknown"
  );
}

async function postJson(url, headers, payload) {
  const response = await fetch(url, {
    method:  "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body:    JSON.stringify(payload),
  });

  if (!response.ok) {
    const raw = await response.text();
    throw new Error(`${response.status}: ${raw.slice(0, 200)}`);
  }
}

/**
 * Sends the notification through the same providers `auto` uses in
 * api/send-email.js, in the same order, so the endpoint works with whichever
 * key is configured. The message is plain, not the composed campaign template.
 */
async function sendNotification({ subject, html, text }) {
  const senders = [
    ["brevo", async () => {
      if (!process.env.BREVO_API_KEY) throw new Error("BREVO_API_KEY is not set");
      await postJson(
        "https://api.brevo.com/v3/smtp/email",
        { "api-key": process.env.BREVO_API_KEY, accept: "application/json" },
        {
          sender:      { email: fromEmail, name: fromName },
          to:          [{ email: adminEmail }],
          subject,
          htmlContent: html,
          textContent: text,
        }
      );
    }],
    ["resend", async () => {
      if (!process.env.RESEND_API_KEY) throw new Error("RESEND_API_KEY is not set");
      await postJson(
        "https://api.resend.com/emails",
        { Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
        { from: `${fromName} <${fromEmail}>`, to: [adminEmail], subject, html, text }
      );
    }],
    ["mailersend", async () => {
      if (!process.env.MAILERSEND_API_KEY) throw new Error("MAILERSEND_API_KEY is not set");
      await postJson(
        "https://api.mailersend.com/v1/email",
        { Authorization: `Bearer ${process.env.MAILERSEND_API_KEY}` },
        {
          from:    { email: fromEmail, name: fromName },
          to:      [{ email: adminEmail }],
          subject,
          html,
          text,
        }
      );
    }],
  ];

  const failures = [];

  for (const [provider, send] of senders) {
    try {
      await send();
      return provider;
    } catch (err) {
      failures.push(`${provider}: ${err && err.message ? err.message : String(err)}`);
    }
  }

  throw new Error(failures.join(" | "));
}

function page(title, heading, body) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<meta name="robots" content="noindex,nofollow"/>
<title>${escapeHtml(title)}</title>
</head>
<body style="margin:0;padding:40px 16px;background:#f5f5f5;font-family:Arial,Helvetica,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;">
<tr>
<td align="center">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:520px;background:#ffffff;border-radius:12px;">
    <tr>
      <td style="padding:34px 32px;color:#333333;font-size:14px;line-height:24px;">
        <h1 style="margin:0 0 14px;font-size:20px;line-height:28px;">${escapeHtml(heading)}</h1>
        ${body}
      </td>
    </tr>
  </table>
</td>
</tr>
</table>
</body>
</html>`;
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  let email = "";
  try {
    email = String(new URL(req.url, "https://localhost").searchParams.get("email") || "").trim();
  } catch (err) {
    email = "";
  }

  res.setHeader("Content-Type", "text/html; charset=utf-8");

  if (!isEmail(email)) {
    return res.status(400).send(
      page(
        "Unsubscribe",
        "We could not tell which address to unsubscribe",
        `<p style="margin:0;">Open the unsubscribe link from the email you received, or write to
        <a href="mailto:${escapeHtml(adminEmail)}" style="color:#0a66c2;">${escapeHtml(adminEmail)}</a>
        and we will remove you by hand.</p>`
      )
    );
  }

  const name = recipientName(email);
  const requestedAt = new Date().toISOString().replace("T", " ").slice(0, 16) + " UTC";

  const subject = `Unsubscribe request: ${email}`;
  const html = `<p style="margin:0 0 16px;">Someone used the unsubscribe button in a Mariot Store email.</p>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="font-size:14px;line-height:24px;">
  <tr><td style="padding:2px 14px 2px 0;color:#8a8a8a;">Name</td><td><strong>${escapeHtml(name)}</strong></td></tr>
  <tr><td style="padding:2px 14px 2px 0;color:#8a8a8a;">Email</td><td><strong>${escapeHtml(email)}</strong></td></tr>
  <tr><td style="padding:2px 14px 2px 0;color:#8a8a8a;">Requested</td><td>${escapeHtml(requestedAt)}</td></tr>
</table>
<p style="margin:16px 0 0;color:#8a8a8a;font-size:13px;">
  This tool addresses campaigns by email and stores no names, so the name above is derived from the address.
  If this request looks unexpected, an email link scanner may have opened the link - check the address before removing it.
</p>`;
  const text = [
    "Someone used the unsubscribe button in a Mariot Store email.",
    "",
    `Name:      ${name}`,
    `Email:     ${email}`,
    `Requested: ${requestedAt}`,
    "",
    "This tool addresses campaigns by email and stores no names, so the name above is derived from the address.",
    "If this request looks unexpected, an email link scanner may have opened the link - check the address before removing it.",
  ].join("\n");

  let provider = "";

  try {
    provider = await sendNotification({ subject, html, text });
    console.log(`[unsubscribe] notified ${adminEmail} about ${email} via ${provider}`);
  } catch (err) {
    console.error(`[unsubscribe] could not notify ${adminEmail} about ${email}: ${err.message}`);

    return res.status(200).send(
      page(
        "Unsubscribe",
        "We could not reach our server",
        `<p style="margin:0 0 14px;"><strong>${escapeHtml(email)}</strong> could not be unsubscribed automatically.</p>
        <p style="margin:0;">Please write to
        <a href="mailto:${escapeHtml(adminEmail)}" style="color:#0a66c2;">${escapeHtml(adminEmail)}</a>
        and we will remove you by hand.</p>`
      )
    );
  }

  return res.status(200).send(
    page(
      "Unsubscribed",
      "You have been unsubscribed",
      `<p style="margin:0 0 14px;">We have told Mariot Store that <strong>${escapeHtml(email)}</strong>
      should be removed from future campaigns.</p>
      <p style="margin:0;color:#8a8a8a;font-size:13px;">If you keep receiving emails, write to
      <a href="mailto:${escapeHtml(adminEmail)}" style="color:#0a66c2;">${escapeHtml(adminEmail)}</a>.</p>`
    )
  );
};

const SibApiV3Sdk = require("sib-api-v3-sdk");
const { Resend }  = require("resend");
const MailerSend  = require("mailersend").MailerSend;
const { EmailParams, Sender, Recipient } = require("mailersend");
const crypto = require("crypto");

// ── Brevo setup ───────────────────────────────────────────────
const client    = SibApiV3Sdk.ApiClient.instance;
const brevoKey  = client.authentications["api-key"];
brevoKey.apiKey = process.env.BREVO_API_KEY;
const tranEmailApi = new SibApiV3Sdk.TransactionalEmailsApi();

// ── Resend setup ──────────────────────────────────────────────
const resend = new Resend(process.env.RESEND_API_KEY);

// ── MailerSend setup ──────────────────────────────────────────
const mailerSend = new MailerSend({
  apiKey: process.env.MAILERSEND_API_KEY,
});

// ---- EmailOctopus setup ----
// EmailOctopus exposes no transactional send endpoint, so it is wired up as an
// audience/automation provider rather than a direct sender.
const eoApiKey       = process.env.EMAILOCTOPUS_API_KEY;
const eoListId       = process.env.EMAILOCTOPUS_LIST_ID;
const eoAutomationId = process.env.EMAILOCTOPUS_AUTOMATION_ID;
const EO_BASE_URL    = process.env.EMAILOCTOPUS_BASE_URL || "https://api.emailoctopus.com";

// ---- Sender identity ----
// Defaults match the current live setup; override via env to change them
// without touching code.
const fromEmail        = process.env.MAIL_FROM_EMAIL || "marketing@mariotstore.com";
const defaultFromName  = process.env.MAIL_FROM_NAME || "Mariot Store";
const unsubscribeEmail = process.env.MAIL_UNSUBSCRIBE_EMAIL || "marketing@mariotstore.com";

const unsubscribeHeaders = {
  "List-Unsubscribe":      `<mailto:${unsubscribeEmail}>`,
  "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
};

const unsubscribeHeaderList = [
  { name: "List-Unsubscribe",      value: `<mailto:${unsubscribeEmail}>` },
  { name: "List-Unsubscribe-Post", value: "List-Unsubscribe=One-Click" },
];

// ── Shared HTML email builder ─────────────────────────────────
// Header logo. It is the full Mariot logo at the web root of whichever host
// serves this app, so recipients load it from there. Override with MAIL_LOGO_URL
// when the app is hosted somewhere else.
const logoUrl = process.env.MAIL_LOGO_URL || "https://marketing.mariotstore.com/mariot-logo.png?v=4";

function buildHtml(
  fromName,
  htmlMessage,
  heroImage,
  image1,
  image2,
  image3,
  message2
) {
  return `<!DOCTYPE html>
<html lang="en" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <meta http-equiv="X-UA-Compatible" content="IE=edge"/>
  <meta name="x-apple-disable-message-reformatting"/>
  <meta name="format-detection" content="telephone=no,date=no,address=no,email=no,url=no"/>
  <!--[if mso]>
  <xml>
    <o:OfficeDocumentSettings>
      <o:PixelsPerInch>96</o:PixelsPerInch>
    </o:OfficeDocumentSettings>
  </xml>
  <![endif]-->
  <style type="text/css">
    /* Client resets */
    html, body { margin:0 !important; padding:0 !important; width:100% !important; }
    * { -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }
    table { border-collapse:collapse !important; border-spacing:0 !important; mso-table-lspace:0pt !important; mso-table-rspace:0pt !important; }
    img { border:0; outline:none; text-decoration:none; -ms-interpolation-mode:bicubic; }
    a { text-decoration:none; }

    /* Fluid container + fluid images, so the email fits any screen width */
    .email-container { width:100% !important; max-width:650px !important; }
    .fluid-img { display:block !important; width:100% !important; max-width:100% !important; height:auto !important; }
    .content-text, .content-text * { word-wrap:break-word !important; overflow-wrap:break-word !important; word-break:break-word !important; overflow-wrap:anywhere !important; }
    .content-text img { width:auto !important; max-width:100% !important; height:auto !important; }
    .btn { display:inline-block; }

    /* Mobile phones */
    @media only screen and (max-width:660px) {
      .email-container { width:100% !important; max-width:100% !important; }
      .px-card    { padding:18px 10px 0 !important; }
      .px-header  { padding:24px 20px !important; }
      .px-content { padding:26px 20px !important; }
      .px-images  { padding:0 20px 8px !important; }
      .px-actions { padding:16px 20px 6px !important; }
      .px-social  { padding:18px 16px !important; }
      .body-text  { font-size:14px !important; line-height:26px !important; }

      /* Nothing in the message content may overflow the screen */
      .px-content, .px-content * { max-width:100% !important; }

      /* Stack the three image columns on top of each other */
      .stack-row  { display:block !important; width:100% !important; }
      .stack-col  { display:block !important; width:100% !important; padding:0 0 14px 0 !important; }
      .stack-col-last { padding:0 !important; }
      .spacer     { display:none !important; width:0 !important; max-width:0 !important; font-size:0 !important; line-height:0 !important; }

      /* Full width, easy to tap buttons */
      .btn { display:block !important; width:100% !important; box-sizing:border-box !important; margin:0 0 12px 0 !important; text-align:center !important; }

      .social-link { margin:0 8px !important; }
    }

    /* Small phones */
    @media only screen and (max-width:400px) {
      .px-card    { padding:12px 6px 0 !important; }
      .px-header  { padding:20px 16px !important; }
      .px-content { padding:22px 16px !important; }
      .px-images  { padding:0 16px 6px !important; }
      .px-actions { padding:14px 16px 4px !important; }
      .body-text  { font-size:14px !important; line-height:24px !important; }
      .btn        { padding:14px 18px !important; font-size:14px !important; }
      .social-link { margin:0 6px !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;width:100%;background:#f5f5f5;font-family:Arial,Helvetica,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background:#f5f5f5;">
<tr>
<td class="px-card" align="center" style="padding:30px 10px 0;">

  <!--[if mso]>
  <table role="presentation" align="center" width="650" cellpadding="0" cellspacing="0" border="0"><tr><td>
  <![endif]-->

  <table role="presentation" class="email-container" align="center" width="100%" cellpadding="0" cellspacing="0" border="0"
    style="width:100%;max-width:650px;background:#ffffff;border-radius:12px;overflow:hidden;">

  <tr>
    <td class="px-header" style="padding:30px 40px;">
      <img src="${logoUrl}" width="239" height="54" alt="${fromName || defaultFromName}" style="display:block;width:239px;height:54px;border:0;outline:none;text-decoration:none;" />
    </td>
  </tr>

  <tr>
  <td>
    <img
      class="fluid-img"
      src="${heroImage}"
      width="100%"
      style="display:block;width:100%;max-width:100%;height:auto;"
    />
  </td>
</tr>

<tr>
  <td class="px-content content-text" style="padding:40px;">
    <p class="body-text" style="font-size:14px;line-height:28px;color:#444;">
      ${htmlMessage}
    </p>
  </td>
</tr>

<tr>
  <td class="px-images" style="padding:0 20px 20px;">

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;">
      <tr class="stack-row">

        <td class="stack-col" width="33%" style="width:33%;">
          <img class="fluid-img" src="${image1}" width="100%"
            style="display:block;width:100%;max-width:100%;height:auto;border-radius:12px;" />
        </td>

        <td class="spacer" width="2%" style="width:2%;font-size:0;line-height:0;"></td>

        <td class="stack-col" width="33%" style="width:33%;">
          <img class="fluid-img" src="${image2}" width="100%"
            style="display:block;width:100%;max-width:100%;height:auto;border-radius:12px;" />
        </td>

        <td class="spacer" width="2%" style="width:2%;font-size:0;line-height:0;"></td>

        <td class="stack-col stack-col-last" width="33%" style="width:33%;">
          <img class="fluid-img" src="${image3}" width="100%"
            style="display:block;width:100%;max-width:100%;height:auto;border-radius:12px;" />
        </td>

      </tr>
    </table>

  </td>
</tr>

<tr>
  <td class="px-content content-text" style="padding:40px;">
    <p class="body-text" style="font-size:14px;line-height:28px;color:#444;">
      ${message2}
    </p>
  </td>
</tr>

<tr>
  <td class="px-actions" align="center" style="padding:20px 20px 10px;">

    <a
      class="btn"
      href="https://mariotstore.com/"
      style="
        display:inline-block;
        background:#000;
        color:#fff;
        text-decoration:none;
        padding:14px 30px;
        border-radius:30px;
        margin-right:10px;
        font-size:14px;
      "
    >
      Visit Us
    </a>

    <a
      class="btn"
      href="https://mariotstore.com/en/about"
      style="
        display:inline-block;
        background:#eaeaea;
        color:#111;
        text-decoration:none;
        padding:14px 30px;
        border-radius:30px;
        font-size:14px;
      "
    >
      About Us
    </a>

  </td>
</tr>

<tr>
  <td class="px-social" align="center" style="padding:25px;">

    <a
      class="social-link"
      href="https://www.facebook.com/mariotuae"
      style="
        color:#333;
        text-decoration:none;
        margin:0 10px;
      "
    >
      Facebook
    </a>

    <a
      class="social-link"
      href="https://www.instagram.com/mariotuae/"
      style="
        color:#333;
        text-decoration:none;
        margin:0 10px;
      "
    >
      Instagram
    </a>

  </td>
</tr>

</table>

  <!--[if mso]>
  </td></tr></table>
  <![endif]-->

</td>
</tr>
</table>
</body>
</html>`;
}

// ── Send via Brevo ────────────────────────────────────────────
// Brevo accepts a send request even when the sender is not validated, then
// rejects it asynchronously. The API therefore returns success while nothing is
// ever delivered, which makes the tool report "sent" for mail that was dropped.
// Verify the sender up front and fail loudly instead.
let brevoSenderCache = { at: 0, value: null };
const BREVO_SENDER_CACHE_MS = 5 * 60 * 1000;

async function brevoSenderStatus() {
  const fresh = brevoSenderCache.value && Date.now() - brevoSenderCache.at < BREVO_SENDER_CACHE_MS;
  if (fresh) return brevoSenderCache.value;

  const headers = { "api-key": process.env.BREVO_API_KEY, accept: "application/json" };
  const [sendersRes, domainsRes] = await Promise.all([
    fetch("https://api.brevo.com/v3/senders", { headers }),
    fetch("https://api.brevo.com/v3/senders/domains", { headers }),
  ]);

  // If Brevo cannot be reached, do not block sending - let Brevo decide.
  if (!sendersRes.ok && !domainsRes.ok) return null;

  const senders = sendersRes.ok ? (await sendersRes.json()).senders || [] : [];
  const domains = domainsRes.ok ? (await domainsRes.json()).domains || [] : [];
  const value = {
    senders: senders.map((s) => String(s.email || "").toLowerCase()),
    domains: domains
      .filter((d) => d.authenticated && d.domain_name)
      .map((d) => String(d.domain_name).toLowerCase()),
  };

  brevoSenderCache = { at: Date.now(), value };
  return value;
}

async function assertBrevoSenderValid() {
  const status = await brevoSenderStatus();
  if (!status) return;

  const address = String(fromEmail || "").toLowerCase();
  const domain  = address.split("@")[1] || "";
  if (status.senders.includes(address) || status.domains.includes(domain)) return;

  throw new Error(
    `${fromEmail} is not a validated Brevo sender and "${domain}" is not an authenticated Brevo domain, ` +
    `so Brevo drops every message it accepts. Add the sender or authenticate the domain under ` +
    `Senders & IP in Brevo, or select a different provider.`
  );
}

async function sendViaBrevo(
  email,
  subject,
  htmlMessage,
  message,
  fromName,
  heroImage,
  image1,
  image2,
  image3,
  message2
) {
  await assertBrevoSenderValid();

  await tranEmailApi.sendTransacEmail({
    sender:      { email: fromEmail, name: fromName || defaultFromName },
    to:          [{ email }],
    subject,
    textContent: message,
    headers: unsubscribeHeaders,
    htmlContent: buildHtml(
  fromName,
  htmlMessage,
  heroImage,
  image1,
  image2,
  image3,
  message2
),
  });
}

// ── Send via Resend ───────────────────────────────────────────
async function sendViaResend(
  email,
  subject,
  htmlMessage,
  message,
  fromName,
  heroImage,
  image1,
  image2,
  image3,
  message2
) {
  const { error } = await resend.emails.send({
    from:        `${fromName || defaultFromName} <${fromEmail}>`,
    to:          [email],
    subject,
    text:        message,
    html:        buildHtml(
  fromName,
  htmlMessage,
  heroImage,
  image1,
  image2,
  image3,
  message2
),
    headers: unsubscribeHeaders,
  });
  if (error) throw new Error(error.message);
}

// ── Send via MailerSend ───────────────────────────────────────
async function sendViaMailerSend(
  email,
  subject,
  htmlMessage,
  message,
  fromName,
  heroImage,
  image1,
  image2,
  image3,
  message2
) {
  const sentFrom = new Sender(fromEmail, fromName || defaultFromName);
  const recipients = [new Recipient(email)];

  const emailParams = new EmailParams()
    .setFrom(sentFrom)
    .setTo(recipients)
    .setSubject(subject)
    .setHtml(buildHtml(
  fromName,
  htmlMessage,
  heroImage,
  image1,
  image2,
  image3,
  message2
))
    .setText(message)
    .setHeaders(unsubscribeHeaderList);

  await mailerSend.email.send(emailParams);
}

// ── Provider order for AUTO mode ────────────────────────────
// Brevo (300/day) → Resend (100/day) → MailerSend (~83/day on 2500/month trial)
const PROVIDERS = [
  { name: "brevo",        fn: sendViaBrevo },
  { name: "resend",       fn: sendViaResend },
  { name: "mailersend",   fn: sendViaMailerSend },
  { name: "emailoctopus", fn: sendViaEmailOctopus },
];

// `auto` only falls back through the providers that deliver the HTML composed
// in this tool. EmailOctopus triggers a pre-built automation instead, so it is
// opt-in only and is never used by `auto`.
const AUTO_PROVIDER_ORDER = ["brevo", "resend", "mailersend"];

// ---- EmailOctopus ----
// EmailOctopus has no transactional send endpoint, so this provider behaves
// differently from the other three: it adds the recipient to a list and, when
// an automation id is configured, queues them into that automation. The email
// that actually goes out is the one built in the EmailOctopus dashboard - the
// HTML composed in this tool is not delivered by this provider.
function md5Hex(value) {
  return crypto.createHash("md5").update(value).digest("hex");
}

// Provider SDKs throw a mix of Errors, plain objects and strings, so normalise
// whatever was caught into a message the UI can actually display.
function errorDetail(err) {
  if (!err) return "Unknown error";
  if (typeof err === "string") return err;
  if (err.message) return err.message;
  if (err.body && err.body.message) return err.body.message;
  try {
    const json = JSON.stringify(err);
    if (json && json !== "{}") return json;
  } catch (e) {
    // not serialisable - fall through to String()
  }
  return String(err);
}

async function emailOctopusRequest(path, body, { ignoreConflict = false } = {}) {
  const response = await fetch(`${EO_BASE_URL}${path}`, {
    method:  "POST",
    headers: {
      Authorization:  `Bearer ${eoApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const raw  = await response.text();
  const data = raw ? JSON.parse(raw) : {};

  if (!response.ok) {
    // Re-adding an existing contact is a no-op, not a failure.
    if (ignoreConflict && response.status === 409) return data;
    const detail = data.detail || data.title || data.message || `HTTP ${response.status}`;
    throw new Error(detail);
  }

  return data;
}

async function sendViaEmailOctopus(email) {
  if (!eoApiKey) throw new Error("EMAILOCTOPUS_API_KEY is not set");
  if (!eoListId) throw new Error("EMAILOCTOPUS_LIST_ID is not set");

  await emailOctopusRequest(
    `/lists/${eoListId}/contacts`,
    { email_address: email, status: "subscribed" },
    { ignoreConflict: true }
  );

  if (eoAutomationId) {
    // The queue endpoint accepts the contact id or an MD5 hash of the
    // lowercased email address, so no lookup round-trip is needed.
    await emailOctopusRequest(`/automations/${eoAutomationId}/queue`, {
      contact_id: md5Hex(email.trim().toLowerCase()),
    });
  }
}

// ── Main handler ──────────────────────────────────────────────
module.exports = async (req, res) => {

  res.setHeader("Access-Control-Allow-Origin",  "*");
  res.setHeader("Access-Control-Allow-Methods", "POST");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });

  try {
    const {
  emails,
  subject,
  message,
  message2,
  heroImage,
  image1,
  image2,
  image3,
  fromName,
  provider
} = req.body;
    // provider = "brevo" | "resend" | "mailersend" | "emailoctopus" | "auto"
    // "auto" → try Brevo → Resend → MailerSend in order, falling back on failure

    // `message` now arrives as real HTML from the rich-text editor
    // (bold/italic/font-size/font-weight spans), so it's used as-is
    // for the HTML email body — no more escaping/`<br/>` conversion.
    const htmlMessage = message;

    // Plain-text fallback (for the `text`/`textContent` fields some
    // providers use), derived by stripping tags from the HTML.
    const plainTextMessage = message
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .trim();

    const results = [];

    for (const email of emails) {
      let usedProvider = provider;
      let sent         = false;
      let lastError    = null;
      const failures   = [];

      try {
        if (provider === "auto") {
          // Try each transactional provider in order until one succeeds
          for (const name of AUTO_PROVIDER_ORDER) {
            const p = PROVIDERS.find((x) => x.name === name);
            try {
              await p.fn(
                email,
                subject,
                htmlMessage,
                plainTextMessage,
                fromName,
                heroImage,
                image1,
                image2,
                image3,
                message2
              );
              usedProvider = p.name;
              sent = true;
              break;
            } catch (err) {
              lastError = err;
              failures.push(`${name}: ${errorDetail(err)}`);
              console.log(`${name} failed for ${email}: ${errorDetail(err)} — trying next...`);
            }
          }
          // Report every provider's reason - the last one alone is misleading,
          // since the primary provider's failure is usually the real problem.
          if (!sent) {
            throw new Error(
              failures.length ? `All providers failed — ${failures.join(" | ")}` : "All providers failed"
            );
          }

        } else {
          // Specific provider chosen
          const chosen = PROVIDERS.find((p) => p.name === provider);
          if (!chosen) throw new Error(`Unknown provider: ${provider}`);
          await chosen.fn(
            email,
            subject,
            htmlMessage,
            plainTextMessage,
            fromName,
            heroImage,
            image1,
            image2,
            image3,
            message2
          );
          usedProvider = provider;
          sent = true;
        }

        console.log(`Sent [${usedProvider}]: ${email}`);
        results.push({ email, status: "sent", provider: usedProvider });

      } catch (err) {
        console.log(`Failed [${usedProvider}]: ${email} — ${errorDetail(err)}`);
        results.push({ email, status: "failed", error: errorDetail(err), provider: usedProvider });
      }
    }

    return res.status(200).json({ success: true, results });

  } catch (err) {
    console.log(err);
    return res.status(500).json({ error: err.message });
  }
};

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
const unsubscribeEmail = process.env.MAIL_UNSUBSCRIBE_EMAIL || "admin@mariotkitchen.com";

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

// Social icons for the footer. They sit next to the logo in public/icons on
// whichever host serves this app, so recipients load them from there. Override
// with MAIL_SOCIAL_ICON_BASE when the app is hosted somewhere else.
const socialIconBase = (
  process.env.MAIL_SOCIAL_ICON_BASE || "https://marketing.mariotstore.com/icons"
).replace(/\/+$/, "");

const SOCIAL_ICON_SIZE = 32;

const socialLinks = [
  { name: "Facebook", icon: "facebook", url: "https://www.facebook.com/mariotuae" },
  { name: "Instagram", icon: "instagram", url: "https://www.instagram.com/mariotuae/" },
  { name: "X", icon: "x", url: "https://x.com/MariotUae" },
  {
    name: "YouTube",
    icon: "youtube",
    url: "https://www.youtube.com/channel/UCUCWktTJNpRzUEJ58JHLu_g",
  },
  { name: "TikTok", icon: "tiktok", url: "https://www.tiktok.com/@mariotmedia" },
  {
    name: "LinkedIn",
    icon: "linkedin",
    url: "https://www.linkedin.com/in/mariot-kitchen-equipment-8a34a4108/?isSelfProfile=false",
  },
  { name: "Pinterest", icon: "pinterest", url: "https://www.pinterest.com/mariotuae/" },
];

// Icons only, so every link carries its network name as alt text: that is what
// a client shows when it blocks images.
function socialLinksHtml() {
  return socialLinks
    .map(
      ({ name, icon, url }) =>
        `<a class="social-link" href="${url}" style="display:inline-block;margin:0 8px;text-decoration:none;"><img src="${socialIconBase}/${icon}.png?v=1" width="${SOCIAL_ICON_SIZE}" height="${SOCIAL_ICON_SIZE}" alt="${name}" style="display:block;width:${SOCIAL_ICON_SIZE}px;height:${SOCIAL_ICON_SIZE}px;border:0;outline:none;text-decoration:none;" /></a>`
    )
    .join("\n      ");
}

// Unsubscribe button. The link carries the recipient's address, so the click
// reaches the endpoint that knows who asked to be removed. Override with
// MAIL_UNSUBSCRIBE_URL when the app is hosted somewhere else.
const unsubscribeUrl =
  process.env.MAIL_UNSUBSCRIBE_URL || "https://marketing.mariotstore.com/api/unsubscribe";

// Campaigns are addressed by email only and this tool stores no names, so derive
// a readable one from the address ("john.doe@example.com" -> "John Doe") for the
// notification the endpoint sends to the admin.
function recipientName(email) {
  return (
    String(email || "")
      .split("@")[0]
      .split(/[._\-+]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ") || "Unknown"
  );
}

function unsubscribeLink(email) {
  return `${unsubscribeUrl}?email=${encodeURIComponent(String(email || ""))}`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function emailImageSlot(url, label, height = 180, className = "") {
  if (url) {
    return `<img class="fluid-img ${className}" src="${escapeHtml(url)}" alt="${escapeHtml(label)}" style="display:block;width:100%;max-width:100%;height:auto;object-fit:contain;" />`;
  }

  return `<div class="image-placeholder ${className}" style="box-sizing:border-box;width:100%;height:${height}px;min-height:${height}px;background:#e8e8e5;border:1px dashed #aeb5b1;color:#62716b;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:${height}px;text-align:center;">${label}</div>`;
}

function inspirationStory(image, label, date, title, copy) {
  return `<tr><td class="story-card" style="padding:0 0 38px;">
    ${emailImageSlot(image, label, 240, "inspiration-image")}
    <p style="margin:22px 0 4px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:18px;letter-spacing:2px;color:#c6ded6;">${date}</p>
    <h3 style="margin:0 0 12px;font-family:Arial,Helvetica,sans-serif;font-size:18px;line-height:1.4;letter-spacing:3px;text-transform:uppercase;color:#ffffff;">${title}</h3>
    <p style="margin:0 0 22px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.8;color:#e0ece8;">${copy}</p>
    <a href="https://mariotstore.com/en/shop-by-brands" style="display:inline-block;background:#35dfb3;color:#183e37;padding:14px 24px;font-family:Arial,Helvetica,sans-serif;font-size:14px;text-decoration:none;">EXPLORE MORE&nbsp; &#8250;</a>
  </td></tr>`;
}

function hotspotStory(image, label, date, title, copy) {
  return `<td class="hotspot-col" width="50%" valign="top" style="width:50%;padding:0 10px;">
    ${emailImageSlot(image, label, 165, "hotspot-image")}
    <p style="margin:20px 0 4px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:18px;letter-spacing:2px;color:#bcbcbc;">${date}</p>
    <h3 style="margin:0 0 12px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.45;letter-spacing:2px;text-transform:uppercase;color:#ffffff;">${title}</h3>
    <p style="margin:0 0 20px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.75;color:#dedede;">${copy}</p>
    <a href="https://mariotstore.com/en/shop" style="display:inline-block;border:1px solid #f1f1f1;color:#ffffff;padding:12px 20px;font-family:Arial,Helvetica,sans-serif;font-size:14px;text-decoration:none;">Shop Now&nbsp; &#8250;</a>
  </td>`;
}

function buildHtml(
  fromName,
  headline,
  htmlMessage,
  heroImage,
  image1,
  image2,
  image3,
  message2,
  image4,
  image5,
  image6,
  image7,
  recipientEmail
) {
  const safeHeadline = escapeHtml(headline || "The essentials of a better kitchen");
  const safeFromName = escapeHtml(fromName || defaultFromName);
  const intro = htmlMessage || "<p>Thoughtful equipment makes every service run more smoothly. Discover reliable tools and professional solutions, selected for the kitchens that count on them every day.</p>";
  const popularCopy = message2 || "From first prep to final plate, the right equipment helps your team do its best work. Explore some of the Mariot Store favourites chosen for performance, quality and lasting value.";
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
    .fluid-img { display:block !important; width:100% !important; max-width:100% !important; height:auto !important; object-fit:contain !important; }
    .fluid-img.inspiration-image { max-width:480px !important; margin-left:auto !important; margin-right:auto !important; }
    .image-placeholder.inspiration-image { max-width:480px !important; margin-left:auto !important; margin-right:auto !important; }
    .content-text, .content-text * { font-family:Arial,Helvetica,sans-serif !important; word-wrap:break-word !important; overflow-wrap:break-word !important; word-break:break-word !important; overflow-wrap:anywhere !important; }
    .content-text img { width:auto !important; max-width:100% !important; height:auto !important; }
    .btn { display:inline-block; }

    /* Mobile phones */
    @media only screen and (max-width:660px) {
      .email-container { width:100% !important; max-width:100% !important; }
      .fluid-img.inspiration-image, .image-placeholder.inspiration-image { max-width:100% !important; }
      .px-card    { padding:18px 10px 0 !important; }
      .px-header  { padding:24px 20px !important; }
      .px-nav-link { font-size:11px !important; }
      .px-title { padding:34px 24px 40px !important; }
      .px-title h1 { font-size:34px !important; }
      .px-content { padding:26px 20px !important; }
      .px-images  { padding:0 20px 8px !important; }
      .px-actions { padding:16px 20px 6px !important; }
      .px-social  { padding:18px 16px !important; }
      .px-unsub   { padding:0 16px 22px !important; }
      .body-text  { font-size:14px !important; line-height:26px !important; }

      /* Nothing in the message content may overflow the screen */
      .px-content, .px-content * { max-width:100% !important; }

      .popular-col { display:table-cell !important; width:50% !important; padding:0 5px !important; }
      .popular-third { display:none !important; }

      /* Stack the three image columns on top of each other */
      .stack-row  { display:block !important; width:100% !important; }
      .stack-col  { display:block !important; width:100% !important; padding:0 0 14px 0 !important; }
      .stack-col-last { padding:0 !important; }
      .spacer     { display:none !important; width:0 !important; max-width:0 !important; font-size:0 !important; line-height:0 !important; }

      /* Full width, easy to tap buttons */
      .btn { display:block !important; width:100% !important; box-sizing:border-box !important; margin:0 0 12px 0 !important; text-align:center !important; }

      .social-link { margin:0 8px !important; }
      .hotspot-col { display:block !important; width:100% !important; padding:0 0 30px !important; }
    }

    /* Small phones */
    @media only screen and (max-width:400px) {
      .px-card    { padding:12px 6px 0 !important; }
      .px-header  { padding:20px 16px !important; }
      .px-title { padding:28px 18px 32px !important; }
      .px-title h1 { font-size:29px !important; }
      .px-content { padding:22px 16px !important; }
      .px-images  { padding:0 16px 6px !important; }
      .px-actions { padding:14px 16px 4px !important; }
      .body-text  { font-size:14px !important; line-height:24px !important; }
      .btn        { padding:14px 18px !important; font-size:14px !important; }
      .social-link { margin:0 6px !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;width:100%;background:#f6f8f4;font-family:Arial,Helvetica,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background:#f6f8f4;">
<tr>
<td class="px-card" align="center" style="padding:24px 10px;">

  <!--[if mso]>
  <table role="presentation" align="center" width="650" cellpadding="0" cellspacing="0" border="0"><tr><td>
  <![endif]-->

  <table role="presentation" class="email-container" align="center" width="100%" cellpadding="0" cellspacing="0" border="0"
    style="width:100%;max-width:650px;background:#ffffff;overflow:hidden;">

  <tr>
    <td class="px-header" style="padding:20px 34px;background:#35dfb3;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td width="20%" align="left" class="px-nav-link" style="font-family:Arial,Helvetica,sans-serif;font-size:13px;">
            <a href="https://mariotstore.com/" style="color:#12342c;text-decoration:none;">Shop</a>
          </td>
          <td width="60%" align="center">
            <a href="https://mariotstore.com/" style="display:inline-block;">
              <img src="${logoUrl}" width="190" alt="${safeFromName}" style="display:block;width:190px;height:auto;max-width:100%;border:0;outline:none;text-decoration:none;" />
            </a>
          </td>
          <td width="20%" align="right" class="px-nav-link" style="font-family:Arial,Helvetica,sans-serif;font-size:13px;">
            <a href="https://mariotstore.com/en/about" style="color:#12342c;text-decoration:none;">Discover</a>
          </td>
        </tr>
      </table>
    </td>
  </tr>

  <tr>
  <td class="px-title" align="center" style="padding:40px 50px 48px;background:#35dfb3;color:#122c25;">
    <p style="margin:0 0 12px;font-family:Arial,Helvetica,sans-serif;font-size:10px;line-height:16px;letter-spacing:2px;text-transform:uppercase;">Mariot Store&nbsp; / &nbsp;Kitchen Edit</p>
    <h1 style="margin:0;font-family:Georgia,'Times New Roman',serif;font-size:46px;line-height:1.08;font-weight:700;letter-spacing:-1.2px;color:#122c25;">${safeHeadline}</h1>
  </td>
</tr>

<tr>
  <td>${emailImageSlot(heroImage, "Upload the lead kitchen image", 260, "lead-image")}</td>
</tr>

<tr>
  <td class="px-content content-text" style="padding:34px 38px 42px;background:#f6f8f4;">
    <p style="margin:0 0 8px;font-family:Arial,Helvetica,sans-serif;font-size:12px;letter-spacing:3px;color:#263d35;">MARIOT STORE&nbsp; / &nbsp;THE KITCHEN JOURNAL</p>
    <h2 style="margin:0 0 16px;font-family:Arial,Helvetica,sans-serif;font-size:21px;line-height:1.5;letter-spacing:3px;text-transform:uppercase;color:#172c27;">Notes from the kitchen</h2>
    <div class="body-text" style="font-size:14px;line-height:28px;color:#444;">
      ${intro}
    </div>
  </td>
</tr>

<tr>
  <td class="px-images" style="padding:35px 34px 38px;background:#eeeeec;">
    <h2 style="margin:0 0 24px;font-family:Georgia,'Times New Roman',serif;font-size:34px;line-height:1.2;color:#242725;">Popular</h2>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;">
      <tr>

        <td class="popular-col" width="33%" style="width:33%;padding-right:10px;">
          ${emailImageSlot(image1, "Popular product image 1", 122, "popular-image")}
        </td>

        <td class="popular-col" width="34%" style="width:34%;padding:0 5px;">
          ${emailImageSlot(image2, "Popular product image 2", 122, "popular-image")}
        </td>

        <td class="popular-col popular-third" width="33%" style="width:33%;padding-left:10px;">
          ${emailImageSlot(image3, "Popular product image 3", 122, "popular-image")}
        </td>

      </tr>
    </table>

  </td>
</tr>

<tr>
  <td class="content-text" style="padding:22px 38px 30px;background:#eeeeec;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.8;color:#414744;">
    ${popularCopy}
  </td>
</tr>

<tr>
  <td style="padding:32px 34px 4px;background:#1b4b42;">
    <h2 style="margin:0 0 26px;font-family:Georgia,'Times New Roman',serif;font-size:36px;line-height:1.2;color:#fff;">Inspirations</h2>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      ${inspirationStory(image4, "Inspiration kitchen image 1", "MARIOT KITCHEN NOTES", "Made for the rhythm of service", "Discover dependable professional equipment designed to keep busy kitchens moving, shift after shift.")}
      ${inspirationStory(image5, "Inspiration kitchen image 2", "THE DETAILS THAT MATTER", "Thoughtful tools. Better results.", "From careful preparation to confident presentation, find the equipment that brings your kitchen together.")}
    </table>
  </td>
</tr>

<tr>
  <td style="padding:32px 24px 40px;background:#292929;">
    <h2 style="margin:0 10px 26px;font-family:Georgia,'Times New Roman',serif;font-size:36px;line-height:1.2;color:#fff;">Hotspots</h2>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      ${hotspotStory(image6, "Hotspot product image 1", "PREP&nbsp; / &nbsp;PERFORMANCE", "A sharper start to every service", "Reliable prep essentials help your team work efficiently from the first order to the last.")}
      ${hotspotStory(image7, "Hotspot product image 2", "SERVICE&nbsp; / &nbsp;STYLE", "Bring your best to the pass", "Explore practical, professional favourites selected for the demands of modern kitchens.")}
    </tr></table>
  </td>
</tr>

<tr>
  <td align="center" style="padding:24px 24px 8px;background:#f6f8f4;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.8;color:#555;">
    <a href="${unsubscribeLink(recipientEmail)}" style="color:#555;text-decoration:underline;">Unsubscribe</a> &nbsp;|&nbsp;
    <a href="https://mariotstore.com/" style="color:#555;text-decoration:underline;">View online</a><br/>
    You’re receiving this email from Mariot Store.
  </td>
</tr>

<tr>
  <td class="px-social" align="center" style="padding:24px 25px 16px;background:#f6f8f4;border-top:1px solid #9cb9ad;">
      ${socialLinksHtml()}
  </td>
</tr>

<tr>
  <td align="center" style="padding:0 20px 30px;background:#f6f8f4;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.7;color:#666;">
    Professional kitchen equipment, selected by Mariot Store.
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
  headline,
  heroImage,
  image1,
  image2,
  image3,
  message2,
  image4,
  image5,
  image6,
  image7
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
    headline,
    htmlMessage,
  heroImage,
  image1,
  image2,
  image3,
  message2,
  image4,
  image5,
  image6,
  image7,
  email
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
  headline,
  heroImage,
  image1,
  image2,
  image3,
  message2,
  image4,
  image5,
  image6,
  image7
) {
  const { error } = await resend.emails.send({
    from:        `${fromName || defaultFromName} <${fromEmail}>`,
    to:          [email],
    subject,
    text:        message,
    html:        buildHtml(
  fromName,
  headline,
  htmlMessage,
  heroImage,
  image1,
  image2,
  image3,
  message2,
  image4,
  image5,
  image6,
  image7,
  email
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
  headline,
  heroImage,
  image1,
  image2,
  image3,
  message2,
  image4,
  image5,
  image6,
  image7
) {
  const sentFrom = new Sender(fromEmail, fromName || defaultFromName);
  const recipients = [new Recipient(email)];

  const emailParams = new EmailParams()
    .setFrom(sentFrom)
    .setTo(recipients)
    .setSubject(subject)
    .setHtml(buildHtml(
  fromName,
  headline,
  htmlMessage,
  heroImage,
  image1,
  image2,
  image3,
  message2,
  image4,
  image5,
  image6,
  image7,
  email
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
  headline,
  message,
  message2,
  heroImage,
  image1,
  image2,
  image3,
  image4,
  image5,
  image6,
  image7,
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
    const plainTextMessage = `${headline || "The essentials of a better kitchen"}\n\n` + message
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
                headline,
                heroImage,
                image1,
                image2,
                image3,
                message2,
                image4,
                image5,
                image6,
                image7
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
            headline,
            heroImage,
            image1,
            image2,
            image3,
            message2,
            image4,
            image5,
            image6,
            image7
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

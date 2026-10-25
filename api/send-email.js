const SibApiV3Sdk = require("sib-api-v3-sdk");
const { Resend }  = require("resend");
const MailerSend  = require("mailersend").MailerSend;
const { EmailParams, Sender, Recipient } = require("mailersend");
const crypto = require("crypto");
// One template for the inbox preview, this sender and (mirrored) the PHP sender.
const { buildEmailHtml, buildEmailText } = require("../src/emailTemplate");

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

// One-click unsubscribe (RFC 8058), which Gmail and Yahoo require from bulk
// senders: the header must carry an https link (the recipient's own), and the
// endpoint must accept the POST the mail client sends. The mailto stays as a
// fallback for clients that only know that form.
function unsubscribeHeadersFor(email) {
  return {
    "List-Unsubscribe":      `<${unsubscribeLink(email)}>, <mailto:${unsubscribeEmail}?subject=unsubscribe>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}

function unsubscribeHeaderListFor(email) {
  return Object.entries(unsubscribeHeadersFor(email)).map(([name, value]) => ({ name, value }));
}

// Optional postal address for the footer (anti-spam laws ask for one).
const companyAddress = process.env.MAIL_COMPANY_ADDRESS || "";

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

// The footer icons themselves are listed in src/emailTemplate.js.

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
  return buildEmailHtml(
    {
      fromName: fromName || defaultFromName, headline, message: htmlMessage, message2,
      heroImage, image1, image2, image3, image4, image5, image6, image7,
    },
    { logoUrl, iconBase: socialIconBase, unsubscribeUrl: unsubscribeLink(recipientEmail), companyAddress }
  );
}

// Plain-text part for one recipient (with their own unsubscribe link).
function buildText(email, headline, htmlMessage, message2) {
  return buildEmailText(
    { headline, message: htmlMessage, message2 },
    { unsubscribeUrl: unsubscribeLink(email), companyAddress }
  );
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
    textContent: buildText(email, headline, htmlMessage, message2),
    headers: unsubscribeHeadersFor(email),
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
    text:        buildText(email, headline, htmlMessage, message2),
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
    headers: unsubscribeHeadersFor(email),
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
    .setText(buildText(email, headline, htmlMessage, message2))
    .setHeaders(unsubscribeHeaderListFor(email));

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

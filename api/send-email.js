const SibApiV3Sdk = require("sib-api-v3-sdk");
const { Resend }  = require("resend");
const MailerSend  = require("mailersend").MailerSend;
const { EmailParams, Sender, Recipient } = require("mailersend");

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

// ── Shared HTML email builder ─────────────────────────────────
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
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
</head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" role="presentation">
<tr><td align="center">
<table width="650" cellpadding="0" cellspacing="0" role="presentation"
  style="background:#ffffff;margin-top:30px;border-radius:12px;overflow:hidden;max-width:650px;">

  <tr>
    <td style="background:#111111;padding:30px 40px;">
      <h1 style="margin:0;font-size:28px;color:#ffffff;letter-spacing:1px;">
        ${fromName || "Model Pros"}
      </h1>
    </td>
  </tr>

  <tr>
  <td>
    <img
      src="${heroImage}"
      width="100%"
      style="display:block;width:100%;"
    />
  </td>
</tr>

<tr>
  <td style="padding:40px;">
    <p style="font-size:14px;line-height:28px;color:#444;">
      ${htmlMessage}
    </p>
  </td>
</tr>

<tr>
  <td style="padding:0 20px 20px;">

    <table width="100%">
      <tr>

        <td width="33%">
          <img src="${image1}" width="100%"
            style="border-radius:12px;" />
        </td>

        <td width="2%"></td>

        <td width="33%">
          <img src="${image2}" width="100%"
            style="border-radius:12px;" />
        </td>

        <td width="2%"></td>

        <td width="33%">
          <img src="${image3}" width="100%"
            style="border-radius:12px;" />
        </td>

      </tr>
    </table>

  </td>
</tr>

<tr>
  <td style="padding:40px;">
    <p style="font-size:14px;line-height:28px;color:#444;">
      ${message2}
    </p>
  </td>
</tr>

<tr>
  <td align="center" style="padding:20px 20px 10px;">

    <a
      href="https://model-pros.com/"
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
      href="https://model-pros.com/"
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
  <td align="center" style="padding:25px;">

    <a
      href="https://facebook.com"
      style="
        color:#333;
        text-decoration:none;
        margin:0 10px;
      "
    >
      Facebook
    </a>

    <a
      href="https://instagram.com"
      style="
        color:#333;
        text-decoration:none;
        margin:0 10px;
      "
    >
      Instagram
    </a>

    <a
      href="https://tiktok.com"
      style="
        color:#333;
        text-decoration:none;
        margin:0 10px;
      "
    >
      TikTok
    </a>

  </td>
</tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}

// ── Send via Brevo ────────────────────────────────────────────
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
  await tranEmailApi.sendTransacEmail({
    sender:      { email: "hello@model-pros.com", name: fromName || "Model Pros" },
    to:          [{ email }],
    subject,
    textContent: message,
    headers: {
      "List-Unsubscribe":      "<mailto:unsubscribe@model-pros.com>",
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
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
    from:        `${fromName || "Model Pros"} <hello@model-pros.com>`,
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
    headers: {
      "List-Unsubscribe":      "<mailto:unsubscribe@model-pros.com>",
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
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
  const sentFrom = new Sender("hello@model-pros.com", fromName || "Model Pros");
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
    .setHeaders([
      { name: "List-Unsubscribe", value: "<mailto:unsubscribe@model-pros.com>" },
      { name: "List-Unsubscribe-Post", value: "List-Unsubscribe=One-Click" },
    ]);

  await mailerSend.email.send(emailParams);
}

// ── Provider order for AUTO mode ────────────────────────────
// Brevo (300/day) → Resend (100/day) → MailerSend (~83/day on 2500/month trial)
const PROVIDERS = [
  { name: "brevo",      fn: sendViaBrevo },
  { name: "resend",     fn: sendViaResend },
  { name: "mailersend", fn: sendViaMailerSend },
];

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
    // provider = "brevo" | "resend" | "mailersend" | "auto"
    // "auto" → try Brevo → Resend → MailerSend in order, falling back on failure

    const htmlMessage = message
      .replace(/&/g,  "&amp;")
      .replace(/</g,  "&lt;")
      .replace(/>/g,  "&gt;")
      .replace(/\n/g, "<br/>");

    const results = [];

    for (const email of emails) {
      let usedProvider = provider;
      let sent         = false;
      let lastError    = null;

      try {
        if (provider === "auto") {
          // Try each provider in order until one succeeds
          for (const p of PROVIDERS) {
            try {
              await p.fn(
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
              );
              usedProvider = p.name;
              sent = true;
              break;
            } catch (err) {
              lastError = err;
              console.log(`${p.name} failed for ${email}: ${err.message} — trying next...`);
            }
          }
          if (!sent) throw lastError || new Error("All providers failed");

        } else {
          // Specific provider chosen
          const chosen = PROVIDERS.find((p) => p.name === provider);
          if (!chosen) throw new Error(`Unknown provider: ${provider}`);
          await chosen.fn(
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
          );
          usedProvider = provider;
          sent = true;
        }

        console.log(`Sent [${usedProvider}]: ${email}`);
        results.push({ email, status: "sent", provider: usedProvider });

      } catch (err) {
        console.log(`Failed [${usedProvider}]: ${email} — ${err.message}`);
        results.push({ email, status: "failed", error: err.message, provider: usedProvider });
      }
    }

    return res.status(200).json({ success: true, results });

  } catch (err) {
    console.log(err);
    return res.status(500).json({ error: err.message });
  }
};
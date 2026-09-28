// HTML email template used by the in-app inbox preview.
//
// This mirrors buildHtml() in api/send-email.js and build_html() in
// public/api/send-email.php - the markup the providers actually deliver. Keep
// the three in sync whenever the email layout changes.
//
// Empty image URLs render as labelled placeholders rather than <img src="">:
// the real email would show a broken-image icon there, and a grey block makes
// the empty slot obvious while composing.

function slot(url, label, { radius = 0, minHeight = 180 } = {}) {
  const base = "display:block;width:100%;max-width:100%;";
  const rounded = radius ? `border-radius:${radius}px;` : "";

  if (url) {
    return `<img class="fluid-img" src="${url}" width="100%" style="${base}height:auto;${rounded}" />`;
  }

  return `<div style="box-sizing:border-box;width:100%;min-height:${minHeight}px;background:#f1f1f1;border:1px dashed #c9c9c9;${rounded}color:#8a8a8a;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:${minHeight}px;text-align:center;">${label}</div>`;
}

export function buildEmailHtml({
  fromName,
  message,
  message2,
  heroImage,
  image1,
  image2,
  image3,
}) {
  const sender = fromName || "Mariot Store";
  const bodyText = "font-size:14px;line-height:28px;color:#444;";

  return `<!DOCTYPE html>
<html lang="en" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <meta http-equiv="X-UA-Compatible" content="IE=edge"/>
  <meta name="x-apple-disable-message-reformatting"/>
  <meta name="format-detection" content="telephone=no,date=no,address=no,email=no,url=no"/>
  <style type="text/css">
    html, body { margin:0 !important; padding:0 !important; width:100% !important; }
    * { -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }
    table { border-collapse:collapse !important; border-spacing:0 !important; }
    img { border:0; outline:none; text-decoration:none; }
    a { text-decoration:none; }
    .email-container { width:100% !important; max-width:650px !important; }
    .fluid-img { display:block !important; width:100% !important; max-width:100% !important; height:auto !important; }
    .content-text, .content-text * { word-wrap:break-word !important; overflow-wrap:break-word !important; word-break:break-word !important; }
    .content-text img { width:auto !important; max-width:100% !important; height:auto !important; }
    .btn { display:inline-block; }

    @media only screen and (max-width:660px) {
      .email-container { width:100% !important; max-width:100% !important; }
      .px-card    { padding:18px 10px 0 !important; }
      .px-header  { padding:24px 20px !important; }
      .px-content { padding:26px 20px !important; }
      .px-images  { padding:0 20px 8px !important; }
      .px-actions { padding:16px 20px 6px !important; }
      .px-social  { padding:18px 16px !important; }
      .h1-title   { font-size:22px !important; line-height:28px !important; }
      .body-text  { font-size:14px !important; line-height:26px !important; }
      .px-content, .px-content * { max-width:100% !important; }
      .stack-row  { display:block !important; width:100% !important; }
      .stack-col  { display:block !important; width:100% !important; padding:0 0 14px 0 !important; }
      .stack-col-last { padding:0 !important; }
      .spacer     { display:none !important; width:0 !important; max-width:0 !important; font-size:0 !important; line-height:0 !important; }
      .btn { display:block !important; width:100% !important; box-sizing:border-box !important; margin:0 0 12px 0 !important; text-align:center !important; }
      .social-link { margin:0 8px !important; }
    }

    @media only screen and (max-width:400px) {
      .px-card    { padding:12px 6px 0 !important; }
      .px-header  { padding:20px 16px !important; }
      .px-content { padding:22px 16px !important; }
      .px-images  { padding:0 16px 6px !important; }
      .h1-title   { font-size:20px !important; line-height:26px !important; }
      .body-text  { font-size:14px !important; line-height:24px !important; }
      .social-link { margin:0 6px !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;width:100%;background:#f5f5f5;font-family:Arial,Helvetica,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background:#f5f5f5;">
<tr>
<td class="px-card" align="center" style="padding:30px 10px 0;">

  <table role="presentation" class="email-container" align="center" width="100%" cellpadding="0" cellspacing="0" border="0"
    style="width:100%;max-width:650px;background:#ffffff;border-radius:12px;overflow:hidden;">

  <tr>
    <td class="px-header" style="background:#111111;padding:30px 40px;">
      <h1 class="h1-title" style="margin:0;font-size:28px;color:#ffffff;letter-spacing:1px;">
        ${sender}
      </h1>
    </td>
  </tr>

  <tr>
    <td>${slot(heroImage, "Hero image", { minHeight: 240 })}</td>
  </tr>

  <tr>
    <td class="px-content content-text" style="padding:40px;">
      <p class="body-text" style="${bodyText}">
        ${message}
      </p>
    </td>
  </tr>

  <tr>
    <td class="px-images" style="padding:0 20px 20px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;">
        <tr class="stack-row">
          <td class="stack-col" width="33%" style="width:33%;">${slot(image1, "Image 1", { radius: 12, minHeight: 130 })}</td>
          <td class="spacer" width="2%" style="width:2%;font-size:0;line-height:0;"></td>
          <td class="stack-col" width="33%" style="width:33%;">${slot(image2, "Image 2", { radius: 12, minHeight: 130 })}</td>
          <td class="spacer" width="2%" style="width:2%;font-size:0;line-height:0;"></td>
          <td class="stack-col stack-col-last" width="33%" style="width:33%;">${slot(image3, "Image 3", { radius: 12, minHeight: 130 })}</td>
        </tr>
      </table>
    </td>
  </tr>

  <tr>
    <td class="px-content content-text" style="padding:40px;">
      <p class="body-text" style="${bodyText}">
        ${message2}
      </p>
    </td>
  </tr>

  <tr>
    <td class="px-actions" align="center" style="padding:20px 20px 10px;">
      <a class="btn" href="https://mariotstore.com/"
        style="display:inline-block;background:#000;color:#fff;text-decoration:none;padding:14px 30px;border-radius:30px;margin-right:10px;font-size:14px;">Visit Us</a>
      <a class="btn" href="https://mariotstore.com/en/about"
        style="display:inline-block;background:#eaeaea;color:#111;text-decoration:none;padding:14px 30px;border-radius:30px;font-size:14px;">About Us</a>
    </td>
  </tr>

  <tr>
    <td class="px-social" align="center" style="padding:25px;">
      <a class="social-link" href="https://www.facebook.com/mariotuae" style="color:#333;text-decoration:none;margin:0 10px;">Facebook</a>
      <a class="social-link" href="https://www.instagram.com/mariotuae/" style="color:#333;text-decoration:none;margin:0 10px;">Instagram</a>
    </td>
  </tr>

  </table>

</td>
</tr>
</table>
</body>
</html>`;
}
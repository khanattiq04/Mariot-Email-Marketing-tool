// Mariot "Kitchen Edit" newsletter - the one HTML template behind the inbox
// preview (src/App.js) and the Node sender (api/send-email.js).
//
// public/api/send-email.php renders the same markup for PHP hosting; the test
// in src/emailTemplate.test.js renders both with the same input and requires
// identical output, so the preview, the Node sender and the PHP sender can
// never drift apart again.
//
// CommonJS on purpose: the React app imports it, and the Node API requires it.

const DEFAULT_HEADLINE = "The essentials of a better kitchen";
const DEFAULT_INTRO =
  "<p>Thoughtful equipment makes every service run more smoothly. Discover reliable tools and professional solutions, selected for the kitchens that count on them every day.</p>";
const DEFAULT_POPULAR =
  "From first prep to final plate, the right equipment helps your team do its best work. Explore some of the Mariot Store favourites chosen for performance, quality and lasting value.";

const SOCIAL_LINKS = [
  ["Facebook", "facebook", "https://www.facebook.com/mariotuae"],
  ["Instagram", "instagram", "https://www.instagram.com/mariotuae/"],
  ["X", "x", "https://x.com/MariotUae"],
  ["YouTube", "youtube", "https://www.youtube.com/channel/UCUCWktTJNpRzUEJ58JHLu_g"],
  ["TikTok", "tiktok", "https://www.tiktok.com/@mariotmedia"],
  ["LinkedIn", "linkedin", "https://www.linkedin.com/in/mariot-kitchen-equipment-8a34a4108/?isSelfProfile=false"],
  ["Pinterest", "pinterest", "https://www.pinterest.com/mariotuae/"],
];

const FONT = "Arial,Helvetica,sans-serif";
const SERIF = "Georgia,'Times New Roman',serif";

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Visible text of a piece of HTML, for the inbox preview line and the plain-text part. */
function htmlToText(html) {
  return String(html || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim();
}

/**
 * An image, or - in the preview only - a grey slot telling the user what to
 * upload. A delivered email never shows an empty slot: the image is left out.
 * `width` is the image's display width in the 650px layout; Outlook ignores
 * CSS widths and needs it as an attribute.
 */
function imageTag(url, label, width, className, placeholderHeight, preview) {
  if (url) {
    return `<img class="fluid-img ${className}" src="${escapeHtml(url)}" width="${width}" alt="${escapeHtml(label)}" style="display:block;width:100%;max-width:${width}px;height:auto;border:0;outline:none;text-decoration:none;" />`;
  }
  if (!preview) return "";
  return `<div class="image-placeholder ${className}" style="box-sizing:border-box;width:100%;height:${placeholderHeight}px;min-height:${placeholderHeight}px;background:#e8e8e5;border:1px dashed #aeb5b1;color:#62716b;font-family:${FONT};font-size:13px;line-height:${placeholderHeight}px;text-align:center;">${escapeHtml(label)}</div>`;
}

/**
 * A button that keeps its colour and padding in Outlook: the padding sits on a
 * table cell, which every client honours, instead of on the link.
 */
function button(href, label, { background, color, border }) {
  const cellStyle = `background:${background};${border ? `border:1px solid ${border};` : ""}`;
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" class="btn-table" style="border-collapse:separate;">
      <tr><td bgcolor="${background}" style="${cellStyle}padding:13px 24px;">
        <a href="${href}" style="display:inline-block;font-family:${FONT};font-size:14px;line-height:18px;font-weight:bold;letter-spacing:1px;color:${color};text-decoration:none;">${label}&nbsp;&#8250;</a>
      </td></tr>
    </table>`;
}

function inspirationStory(image, date, title, copy) {
  return `<tr><td class="story-card" style="padding:0 0 38px;">
    ${image}
    <p style="margin:22px 0 4px;font-family:${FONT};font-size:12px;line-height:18px;letter-spacing:2px;color:#c6ded6;">${date}</p>
    <h3 style="margin:0 0 12px;font-family:${FONT};font-size:18px;line-height:26px;letter-spacing:3px;text-transform:uppercase;color:#ffffff;">${title}</h3>
    <p style="margin:0 0 22px;font-family:${FONT};font-size:15px;line-height:27px;color:#e0ece8;">${copy}</p>
    ${button("https://mariotstore.com/en/shop-by-brands", "EXPLORE MORE", { background: "#35dfb3", color: "#183e37" })}
  </td></tr>`;
}

function hotspotCard(image, date, title, copy) {
  return `<td class="hotspot-col" width="50%" valign="top" style="width:50%;padding:0 10px;">
    ${image}
    <p style="margin:20px 0 4px;font-family:${FONT};font-size:12px;line-height:18px;letter-spacing:2px;color:#bcbcbc;">${date}</p>
    <h3 style="margin:0 0 12px;font-family:${FONT};font-size:16px;line-height:23px;letter-spacing:2px;text-transform:uppercase;color:#ffffff;">${title}</h3>
    <p style="margin:0 0 20px;font-family:${FONT};font-size:14px;line-height:24px;color:#dedede;">${copy}</p>
    ${button("https://mariotstore.com/en/shop", "Shop Now", { background: "#292929", color: "#ffffff", border: "#f1f1f1" })}
  </td>`;
}

function popularGallery(images, preview) {
  const slots = images
    .map((url, i) => ({ url, label: `Popular product image ${i + 1}` }))
    .filter((slot) => slot.url || preview);
  if (!slots.length) return "";
  const share = Math.floor(100 / slots.length);
  const width = Math.floor((582 - 20 * (slots.length - 1)) / slots.length);
  const cells = slots.map((slot, i) => {
    const third = slots.length === 3 && i === 2 ? " popular-third" : "";
    const pad = i === 0 ? "padding:0 10px 0 0;" : i === slots.length - 1 ? "padding:0 0 0 10px;" : "padding:0 5px;";
    return `<td class="popular-col${third}" width="${share}%" valign="top" style="width:${share}%;${pad}">${imageTag(slot.url, slot.label, width, "popular-image", 122, preview)}</td>`;
  });
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;"><tr>
      ${cells.join("\n      ")}
    </tr></table>`;
}

function socialLinks(iconBase) {
  // No array destructuring here: Babel would add an ES-module helper import
  // and the React build would stop seeing this file's CommonJS exports.
  return SOCIAL_LINKS.map(
    (link) =>
      `<a class="social-link" href="${link[2]}" style="display:inline-block;margin:0 7px;text-decoration:none;"><img src="${iconBase}/${link[1]}.png?v=1" width="30" height="30" alt="${link[0]}" style="display:block;width:30px;height:30px;border:0;outline:none;text-decoration:none;" /></a>`
  ).join("\n      ");
}

/**
 * The newsletter HTML.
 *
 * options: logoUrl, iconBase, unsubscribeUrl (already carrying the recipient),
 *          companyAddress (optional footer line), preview (true = show grey
 *          slots for images that are not uploaded yet).
 */
function buildEmailHtml(content = {}, options = {}) {
  const preview = Boolean(options.preview);
  const sender = escapeHtml(content.fromName || "Mariot Store");
  const headline = escapeHtml(content.headline || DEFAULT_HEADLINE);
  const intro = content.message || DEFAULT_INTRO;
  const popularCopy = content.message2 || DEFAULT_POPULAR;
  const preheaderText = (htmlToText(intro).replace(/\s+/g, " ").slice(0, 140) || DEFAULT_HEADLINE);
  // Pads the preview line so clients do not pull "Shop  Discover" in after it.
  const preheaderPad = "&#847;&zwnj;&nbsp;".repeat(60);

  const hero = imageTag(content.heroImage, "Featured kitchen", 650, "lead-image", 260, preview);
  const gallery = popularGallery([content.image1, content.image2, content.image3], preview);
  const inspiration1 = inspirationStory(
    imageTag(content.image4, "Inspiration kitchen image 1", 291, "inspiration-image", 240, preview),
    "MARIOT KITCHEN NOTES", "Made for the rhythm of service",
    "Discover dependable professional equipment designed to keep busy kitchens moving, shift after shift."
  );
  const inspiration2 = inspirationStory(
    imageTag(content.image5, "Inspiration kitchen image 2", 291, "inspiration-image", 240, preview),
    "THE DETAILS THAT MATTER", "Thoughtful tools. Better results.",
    "From careful preparation to confident presentation, find the equipment that brings your kitchen together."
  );
  const hotspot1 = hotspotCard(
    imageTag(content.image6, "Hotspot product image 1", 140, "hotspot-image", 165, preview),
    "PREP&nbsp; / &nbsp;PERFORMANCE", "A sharper start to every service",
    "Reliable prep essentials help your team work efficiently from the first order to the last."
  );
  const hotspot2 = hotspotCard(
    imageTag(content.image7, "Hotspot product image 2", 140, "hotspot-image", 165, preview),
    "SERVICE&nbsp; / &nbsp;STYLE", "Bring your best to the pass",
    "Explore practical favourites selected for the demands of modern kitchens."
  );
  const address = options.companyAddress
    ? `<br/>${escapeHtml(options.companyAddress)}`
    : "";
  const heroRow = hero ? `
  <tr><td style="font-size:0;line-height:0;">${hero}</td></tr>
` : "";
  const galleryGap = gallery ? "22px" : "0";
  const logoUrl = options.logoUrl || "";
  const unsubscribeUrl = options.unsubscribeUrl || "#";
  const social = socialLinks(options.iconBase || "");
  const preheader = escapeHtml(preheaderText) + preheaderPad;
  const font = FONT;
  const serif = SERIF;

  // Only plain ${name} substitutions below: public/api/send-email.php holds
  // the same skeleton with {{name}} placeholders.
  return `<!DOCTYPE html>
<html lang="en" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <meta http-equiv="X-UA-Compatible" content="IE=edge"/>
  <meta name="x-apple-disable-message-reformatting"/>
  <meta name="format-detection" content="telephone=no,date=no,address=no,email=no,url=no"/>
  <meta name="color-scheme" content="light"/>
  <meta name="supported-color-schemes" content="light"/>
  <title>${headline}</title>
  <!--[if mso]>
  <xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml>
  <style type="text/css">body,table,td,p,a,h1,h2,h3{font-family:Arial,Helvetica,sans-serif!important;}</style>
  <![endif]-->
  <style type="text/css">
    :root{color-scheme:light;supported-color-schemes:light}
    html,body{margin:0!important;padding:0!important;width:100%!important}
    *{-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%}
    table{border-collapse:collapse;border-spacing:0;mso-table-lspace:0pt;mso-table-rspace:0pt}
    img{border:0;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic}
    a{text-decoration:none}
    .email-container{width:100%!important;max-width:650px!important}
    .fluid-img{display:block!important;width:100%!important;height:auto!important}
    .fluid-img.inspiration-image,.image-placeholder.inspiration-image,.fluid-img.hotspot-image,.image-placeholder.hotspot-image{width:50%!important;max-width:50%!important}
    .fluid-img.inspiration-image{max-width:480px!important;margin-left:auto!important;margin-right:auto!important}
    .image-placeholder.inspiration-image{max-width:480px!important;margin-left:auto!important;margin-right:auto!important}
    .content-text,.content-text *{font-family:Arial,Helvetica,sans-serif!important;word-wrap:break-word!important;overflow-wrap:break-word!important;word-break:break-word!important}
    .content-text img{width:auto!important;max-width:100%!important;height:auto!important}
    .content-text p{margin:0 0 14px}
    @media only screen and (max-width:660px){
      .email-container{width:100%!important;max-width:100%!important}
      .fluid-img.inspiration-image,.image-placeholder.inspiration-image{max-width:50%!important}
      .px-card{padding:12px 0 0!important}
      .px-header{padding:18px 20px!important}
      .px-nav-link{font-size:11px!important}
      .px-title{padding:34px 22px 40px!important}
      .px-title h1{font-size:34px!important;line-height:38px!important}
      .px-intro{padding:28px 22px!important}
      .section-padding{padding:30px 20px!important}
      .popular-col{display:table-cell!important;width:50%!important;padding:0 5px!important}
      .popular-third{display:none!important}
      .inspiration-inner{padding:28px 20px 4px!important}
      .story-card{padding-bottom:32px!important}
      .hotspot-col{display:block!important;width:100%!important;padding:0 0 32px!important}
      .footer-inner{padding:24px 18px!important}
      .social-link{margin:0 4px!important}
    }
    @media only screen and (max-width:400px){
      .px-title h1{font-size:29px!important;line-height:33px!important}
      .px-intro{padding:24px 16px!important}
      .section-padding{padding:26px 14px!important}
      .inspiration-inner{padding:24px 14px 4px!important}
      .footer-inner{padding:22px 12px!important}
      .social-link{margin:0 2px!important}
    }
  </style>
</head>
<body style="margin:0;padding:0;width:100%;background:#f6f8f4;font-family:${font};">
<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${preheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f6f8f4" style="width:100%;background:#f6f8f4;">
<tr><td class="px-card" align="center" style="padding:20px 10px;">
<!--[if mso]><table role="presentation" align="center" width="650" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" class="email-container" align="center" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" style="width:100%;max-width:650px;background:#ffffff;">

  <tr>
    <td class="px-header" bgcolor="#35dfb3" style="padding:20px 34px;background:#35dfb3;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
        <td width="20%" align="left" class="px-nav-link" style="font-family:${font};font-size:13px;line-height:18px;"><a href="https://mariotstore.com/" style="color:#12342c;text-decoration:none;">Shop</a></td>
        <td width="60%" align="center"><a href="https://mariotstore.com/" style="display:inline-block;"><img src="${logoUrl}" width="190" alt="${sender}" style="display:block;width:190px;max-width:100%;height:auto;border:0;outline:none;text-decoration:none;" /></a></td>
        <td width="20%" align="right" class="px-nav-link" style="font-family:${font};font-size:13px;line-height:18px;"><a href="https://mariotstore.com/en/about" style="color:#12342c;text-decoration:none;">Discover</a></td>
      </tr></table>
    </td>
  </tr>

  <tr><td class="px-title" align="center" bgcolor="#35dfb3" style="padding:40px 50px 48px;background:#35dfb3;color:#122c25;">
    <p style="margin:0 0 12px;font-family:${font};font-size:11px;line-height:16px;letter-spacing:3px;text-transform:uppercase;color:#122c25;">Mariot Store&nbsp; / &nbsp;Kitchen Edit</p>
    <h1 style="margin:0;font-family:${serif};font-size:46px;line-height:50px;font-weight:700;letter-spacing:-1px;color:#122c25;">${headline}</h1>
  </td></tr>
${heroRow}
  <tr><td class="px-intro content-text" bgcolor="#f6f8f4" style="padding:34px 38px 42px;background:#f6f8f4;">
    <p style="margin:0 0 8px;font-family:${font};font-size:12px;line-height:18px;letter-spacing:3px;color:#263d35;">MARIOT STORE&nbsp; / &nbsp;THE KITCHEN JOURNAL</p>
    <h2 style="margin:0 0 16px;font-family:${font};font-size:21px;line-height:30px;letter-spacing:3px;text-transform:uppercase;color:#172c27;">Notes from the kitchen</h2>
    <div style="font-family:${font};font-size:15px;line-height:27px;color:#454b48;">${intro}</div>
  </td></tr>

  <tr><td class="section-padding" bgcolor="#eeeeec" style="padding:35px 34px 38px;background:#eeeeec;">
    <h2 style="margin:0 0 24px;font-family:${serif};font-size:34px;line-height:40px;color:#242725;">Popular</h2>
    ${gallery}
    <div class="content-text" style="padding:${galleryGap} 4px 0;font-family:${font};font-size:15px;line-height:27px;color:#414744;">${popularCopy}</div>
  </td></tr>

  <tr><td class="inspiration-inner" bgcolor="#1b4b42" style="padding:36px 34px 6px;background:#1b4b42;">
    <h2 style="margin:0 0 28px;font-family:${serif};font-size:36px;line-height:42px;color:#ffffff;">Inspirations</h2>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      ${inspiration1}
      ${inspiration2}
    </table>
  </td></tr>

  <tr><td class="section-padding" bgcolor="#292929" style="padding:34px 24px 42px;background:#292929;">
    <h2 style="margin:0 10px 26px;font-family:${serif};font-size:36px;line-height:42px;color:#ffffff;">Hotspots</h2>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      ${hotspot1}
      ${hotspot2}
    </tr></table>
  </td></tr>

  <tr><td class="footer-inner" align="center" bgcolor="#f6f8f4" style="padding:30px 30px 36px;background:#f6f8f4;">
    <p style="margin:0 0 14px;font-family:${font};font-size:13px;line-height:22px;color:#555555;">You’re receiving this email from Mariot Store.<br/><a href="${unsubscribeUrl}" style="color:#555555;text-decoration:underline;">Unsubscribe</a> &nbsp;|&nbsp; <a href="https://mariotstore.com/" style="color:#555555;text-decoration:underline;">Visit our store</a></p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:1px solid #9cb9ad;"><tr><td align="center" style="padding:22px 0 14px;">
      ${social}
    </td></tr></table>
    <p style="margin:0;font-family:${font};font-size:13px;line-height:21px;color:#666666;">Professional kitchen equipment, selected by Mariot Store.${address}</p>
  </td></tr>

</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr></table>
</body>
</html>`;
}

/** Plain-text part sent alongside the HTML (spam filters expect one that matches). */
function buildEmailText(content = {}, options = {}) {
  return [
    content.headline || DEFAULT_HEADLINE,
    "",
    htmlToText(content.message || DEFAULT_INTRO),
    "",
    htmlToText(content.message2 || DEFAULT_POPULAR),
    "",
    "Shop: https://mariotstore.com/",
    "",
    "You're receiving this email from Mariot Store.",
    options.unsubscribeUrl ? "Unsubscribe: " + options.unsubscribeUrl : "",
    options.companyAddress || "",
  ].filter((line, i, all) => line !== "" || all[i - 1] !== "").join("\n").trim();
}

module.exports = { buildEmailHtml, buildEmailText, htmlToText, escapeHtml };

// HTML email template used by the inbox preview. Keep its structure in sync
// with buildHtml() in api/send-email.js and build_html() in public/api/send-email.php.
const ORIGIN =
  typeof window !== "undefined" && window.location ? window.location.origin : "";
const LOGO_URL = `${ORIGIN}/mariot-logo.png?v=4`;
const SOCIAL_ICON_BASE = `${ORIGIN}/icons`;
const UNSUBSCRIBE_URL = `${ORIGIN}/api/unsubscribe`;
const PREVIEW_RECIPIENT = "recipient@example.com";

const SOCIAL_LINKS = [
  ["Facebook", "facebook", "https://www.facebook.com/mariotuae"],
  ["Instagram", "instagram", "https://www.instagram.com/mariotuae/"],
  ["X", "x", "https://x.com/MariotUae"],
  ["YouTube", "youtube", "https://www.youtube.com/channel/UCUCWktTJNpRzUEJ58JHLu_g"],
  ["TikTok", "tiktok", "https://www.tiktok.com/@mariotmedia"],
  ["LinkedIn", "linkedin", "https://www.linkedin.com/in/mariot-kitchen-equipment-8a34a4108/?isSelfProfile=false"],
  ["Pinterest", "pinterest", "https://www.pinterest.com/mariotuae/"],
];

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function imageSlot(url, label, height = 180, className = "") {
  if (url) {
    return `<img class="fluid-img ${className}" src="${escapeHtml(url)}" alt="${escapeHtml(label)}" style="display:block;width:100%;max-width:100%;height:auto;object-fit:contain;" />`;
  }

  return `<div class="image-placeholder ${className}" style="box-sizing:border-box;width:100%;height:${height}px;min-height:${height}px;background:#e8e8e5;border:1px dashed #aeb5b1;color:#62716b;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:${height}px;text-align:center;">${label}</div>`;
}

function socialLinks() {
  return SOCIAL_LINKS.map(
    ([name, icon, url]) =>
      `<a class="social-link" href="${url}" style="display:inline-block;margin:0 7px;text-decoration:none;"><img src="${SOCIAL_ICON_BASE}/${icon}.png?v=1" width="26" height="26" alt="${name}" style="display:block;width:26px;height:26px;border:0;" /></a>`
  ).join("");
}

function featureStory({ image, label, date, title, copy, button }) {
  return `<tr>
    <td class="story-card" style="padding:0 0 38px;">
      ${imageSlot(image, label, 240, "inspiration-image")}
      <p style="margin:22px 0 4px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:18px;letter-spacing:2px;color:#c6ded6;">${date}</p>
      <h3 style="margin:0 0 12px;font-family:Arial,Helvetica,sans-serif;font-size:18px;line-height:1.4;letter-spacing:3px;text-transform:uppercase;color:#ffffff;">${title}</h3>
      <p style="margin:0 0 22px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.8;color:#e0ece8;">${copy}</p>
      <a href="https://mariotstore.com/en/shop-by-brands" style="display:inline-block;background:#35dfb3;color:#183e37;padding:14px 24px;font-family:Arial,Helvetica,sans-serif;font-size:14px;text-decoration:none;">EXPLORE MORE&nbsp; &#8250;</a>
    </td>
  </tr>`;
}

function hotspotCard({ image, label, date, title, copy }) {
  return `<td class="hotspot-col" width="50%" valign="top" style="width:50%;padding:0 10px;">
    ${imageSlot(image, label, 165, "hotspot-image")}
    <p style="margin:20px 0 4px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:18px;letter-spacing:2px;color:#bcbcbc;">${date}</p>
    <h3 style="margin:0 0 12px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.45;letter-spacing:2px;text-transform:uppercase;color:#ffffff;">${title}</h3>
    <p style="margin:0 0 20px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.75;color:#dedede;">${copy}</p>
    <a href="https://mariotstore.com/en/shop" style="display:inline-block;border:1px solid #f1f1f1;color:#ffffff;padding:12px 20px;font-family:Arial,Helvetica,sans-serif;font-size:14px;text-decoration:none;">Shop Now&nbsp; &#8250;</a>
  </td>`;
}

export function buildEmailHtml({
  fromName,
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
}) {
  const sender = escapeHtml(fromName || "Mariot Store");
  const title = escapeHtml(headline || "The essentials of a better kitchen");
  const intro = message || "<p>Thoughtful equipment makes every service run more smoothly. Discover reliable tools and professional solutions, selected for the kitchens that count on them every day.</p>";
  const popularCopy = message2 || "From first prep to final plate, the right equipment helps your team do its best work. Explore some of the Mariot Store favourites chosen for performance, quality and lasting value.";
  const footerUnsubscribe = `${UNSUBSCRIBE_URL}?email=${encodeURIComponent(PREVIEW_RECIPIENT)}`;

  return `<!DOCTYPE html>
<html lang="en" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <meta http-equiv="X-UA-Compatible" content="IE=edge"/>
  <meta name="x-apple-disable-message-reformatting"/>
  <meta name="format-detection" content="telephone=no,date=no,address=no,email=no,url=no"/>
  <style type="text/css">
    html,body{margin:0!important;padding:0!important;width:100%!important}
    *{-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%}
    table{border-collapse:collapse!important;border-spacing:0!important}
    img{border:0;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic}
    a{text-decoration:none}
    .email-container{width:100%!important;max-width:650px!important}
    .fluid-img{display:block!important;width:100%!important;max-width:100%!important;height:auto!important;object-fit:contain!important}
    .fluid-img.inspiration-image{max-width:480px!important;margin-left:auto!important;margin-right:auto!important}
    .image-placeholder.inspiration-image{max-width:480px!important;margin-left:auto!important;margin-right:auto!important}
    .image-placeholder.lead-image{height:260px!important;line-height:260px!important}
    .image-placeholder.popular-image{height:122px!important;line-height:122px!important}
    .image-placeholder.inspiration-image{height:240px!important;line-height:240px!important}
    .image-placeholder.hotspot-image{height:165px!important;line-height:165px!important}
    .content-text,.content-text *{font-family:Arial,Helvetica,sans-serif!important;word-wrap:break-word!important;overflow-wrap:break-word!important;word-break:break-word!important}
    @media only screen and (max-width:660px){
      .email-container{width:100%!important;max-width:100%!important}
      .fluid-img.inspiration-image,.image-placeholder.inspiration-image{max-width:100%!important}
      .px-header{padding:18px 20px!important}
      .px-title{padding:42px 24px 48px!important}
      .px-title h1{font-size:42px!important}
      .px-intro{padding:30px 24px!important}
      .section-padding{padding:30px 20px!important}
      .popular-col{display:table-cell!important;width:50%!important;padding:0 5px!important}
      .popular-third{display:none!important}
      .inspiration-inner{padding:28px 20px!important}
      .story-card{padding-bottom:32px!important}
      .hotspot-col{display:block!important;width:100%!important;padding:0 0 34px!important}
      .footer-inner{padding:25px 20px!important}
      .social-link{margin:0 4px!important}
    }
    @media only screen and (max-width:400px){
      .px-title{padding:34px 18px 40px!important}
      .px-title h1{font-size:34px!important}
      .px-intro{padding:26px 18px!important}
      .section-padding{padding:26px 14px!important}
      .inspiration-inner{padding:24px 14px!important}
      .hotspot-col{padding-bottom:28px!important}
      .footer-inner{padding:22px 14px!important}
    }
  </style>
</head>
<body style="margin:0;padding:0;width:100%;background:#f6f8f4;font-family:Arial,Helvetica,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background:#f6f8f4;">
<tr><td align="center" style="padding:0 10px;">
<table role="presentation" class="email-container" align="center" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:650px;background:#f6f8f4;">

  <tr>
    <td class="px-header" style="padding:20px 36px;background:#35dfb3;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
        <td width="20%" align="left" style="font-size:13px;"><a href="https://mariotstore.com/" style="color:#102c26;">Shop</a></td>
        <td width="60%" align="center"><a href="https://mariotstore.com/"><img src="${LOGO_URL}" width="190" alt="${sender}" style="display:block;width:190px;max-width:100%;height:auto;" /></a></td>
        <td width="20%" align="right" style="font-size:13px;"><a href="https://mariotstore.com/en/about" style="color:#102c26;">Discover</a></td>
      </tr></table>
    </td>
  </tr>

  <tr><td class="px-title" align="center" style="padding:44px 58px 54px;background:#35dfb3;color:#112c25;">
    <p style="margin:0 0 18px;font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:3px;text-transform:uppercase;">Mariot Store&nbsp; / &nbsp;Kitchen Edit</p>
    <h1 style="margin:0;font-family:Georgia,'Times New Roman',serif;font-size:50px;line-height:1.08;font-weight:700;letter-spacing:-1px;color:#112c25;">${title}</h1>
  </td></tr>

  <tr><td>${imageSlot(heroImage, "Upload the lead kitchen image", 260, "lead-image")}</td></tr>

  <tr><td class="px-intro content-text" style="padding:34px 38px 42px;background:#f6f8f4;">
    <p style="margin:0 0 8px;font-family:Arial,Helvetica,sans-serif;font-size:12px;letter-spacing:3px;color:#263d35;">MARIOT STORE&nbsp; / &nbsp;THE KITCHEN JOURNAL</p>
    <h2 style="margin:0 0 16px;font-family:Arial,Helvetica,sans-serif;font-size:21px;line-height:1.5;letter-spacing:3px;text-transform:uppercase;color:#172c27;">Notes from the kitchen</h2>
    <div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.85;color:#454b48;">${intro}</div>
  </td></tr>

  <tr><td class="section-padding" style="padding:35px 34px 38px;background:#eeeeec;">
    <h2 style="margin:0 0 24px;font-family:Georgia,'Times New Roman',serif;font-size:34px;line-height:1.2;color:#242725;">Popular</h2>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td class="popular-col" width="33%" valign="top" style="width:33%;padding-right:10px;">${imageSlot(image1,"Popular product image 1",122,"popular-image")}</td>
      <td class="popular-col" width="34%" valign="top" style="width:34%;padding:0 5px;">${imageSlot(image2,"Popular product image 2",122,"popular-image")}</td>
      <td class="popular-col popular-third" width="33%" valign="top" style="width:33%;padding-left:10px;">${imageSlot(image3,"Popular product image 3",122,"popular-image")}</td>
    </tr></table>
    <div class="content-text" style="padding:22px 4px 0;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.8;color:#414744;">${popularCopy}</div>
  </td></tr>

  <tr><td class="inspiration-inner" style="padding:36px 34px 6px;background:#1b4b42;">
    <h2 style="margin:0 0 28px;font-family:Georgia,'Times New Roman',serif;font-size:36px;line-height:1.2;color:#ffffff;">Inspirations</h2>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      ${featureStory({image:image4,label:"Inspiration kitchen image 1",date:"MARIOT KITCHEN NOTES",title:"Made for the rhythm of service",copy:"Discover dependable professional equipment designed to keep busy kitchens moving, shift after shift.",button:"Explore collection"})}
      ${featureStory({image:image5,label:"Inspiration kitchen image 2",date:"THE DETAILS THAT MATTER",title:"Thoughtful tools. Better results.",copy:"From careful preparation to confident presentation, find the equipment that brings your kitchen together.",button:"Shop the edit"})}
    </table>
  </td></tr>

  <tr><td class="section-padding" style="padding:34px 24px 42px;background:#292929;">
    <h2 style="margin:0 10px 26px;font-family:Georgia,'Times New Roman',serif;font-size:36px;line-height:1.2;color:#ffffff;">Hotspots</h2>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      ${hotspotCard({image:image6,label:"Hotspot product image 1",date:"PREP&nbsp; / &nbsp;PERFORMANCE",title:"A sharper start to every service",copy:"Reliable prep essentials help your team work efficiently from the first order to the last."})}
      ${hotspotCard({image:image7,label:"Hotspot product image 2",date:"SERVICE&nbsp; / &nbsp;STYLE",title:"Bring your best to the pass",copy:"Explore practical, professional favourites selected for the demands of modern kitchens."})}
    </tr></table>
  </td></tr>

  <tr><td class="footer-inner" align="center" style="padding:30px 30px 36px;background:#f6f8f4;">
    <p style="margin:0 0 12px;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.8;color:#555;">You’re receiving this email from Mariot Store.<br/><a href="${footerUnsubscribe}" style="color:#555;text-decoration:underline;">Unsubscribe</a> &nbsp;|&nbsp; <a href="https://mariotstore.com/" style="color:#555;text-decoration:underline;">View online</a></p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:1px solid #9cb9ad;"><tr><td align="center" style="padding:24px 0 16px;">
      ${socialLinks()}
    </td></tr></table>
    <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.7;color:#666;">Professional kitchen equipment, selected by Mariot Store.</p>
  </td></tr>

</table>
</td></tr></table>
</body>
</html>`;
}

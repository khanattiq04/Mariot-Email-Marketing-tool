<?php
/**
 * POST /api/send-email - PHP twin of api/send-email.js.
 *
 * The production site is uploaded as a static build to PHP shared hosting
 * (Hostinger), which cannot run the Node serverless function in api/, so that
 * endpoint 404s there. This file serves the same route with the same JSON
 * request and response shape, so the tool behaves identically on localhost,
 * on Vercel (api/send-email.js) and on PHP hosting.
 *
 * Reads the same .env keys as the Node handler:
 *   BREVO_API_KEY, RESEND_API_KEY, MAILERSEND_API_KEY,
 *   EMAILOCTOPUS_API_KEY, EMAILOCTOPUS_LIST_ID, EMAILOCTOPUS_AUTOMATION_ID,
 *   MAIL_FROM_EMAIL, MAIL_FROM_NAME, MAIL_UNSUBSCRIBE_EMAIL
 *
 * The .env is looked for outside the web root first (../.env, one level above
 * public_html on Hostinger), then next to this file. Never commit it.
 */

declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST');
header('Access-Control-Allow-Headers: Content-Type');

load_env_file(dirname(__DIR__, 2) . '/.env'); // ../.env relative to the web root
load_env_file(__DIR__ . '/.env');

$method = isset($_SERVER['REQUEST_METHOD']) ? (string) $_SERVER['REQUEST_METHOD'] : '';

if ($method === 'OPTIONS') {
  http_response_code(200);
  exit;
}

if ($method !== 'POST') {
  respond(405, array('error' => 'Method not allowed'));
}

$raw  = file_get_contents('php://input');
$body = is_string($raw) && $raw !== '' ? json_decode($raw, true) : null;

if (!is_array($body)) {
  respond(400, array('error' => 'Request body must be valid JSON'));
}

try {
  send_campaign($body);
} catch (Throwable $err) {
  error_log('[send-email] ' . $err->getMessage());
  respond(500, array('error' => $err->getMessage()));
}

// --------------------------------------------------------------- responses --

function respond(int $status, array $payload): void {
  http_response_code($status);
  echo json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
  exit;
}

// --------------------------------------------------------------- settings --

/**
 * Minimal .env reader. Real environment variables win, matching dotenv, and a
 * missing or unreadable file is not an error - the request then just fails with
 * "<PROVIDER>_API_KEY is not set" instead of a blank 500.
 */
function load_env_file(string $path): void {
  if (!is_readable($path)) return;

  $lines = file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
  if ($lines === false) return;

  foreach ($lines as $line) {
    $line = trim($line);
    if ($line === '' || $line[0] === '#' || strpos($line, '=') === false) continue;

    $pair  = explode('=', $line, 2);
    $key   = trim($pair[0]);
    $value = trim($pair[1]);

    if ($key === '' || array_key_exists($key, $_ENV) || getenv($key) !== false) continue;

    if (strlen($value) > 1) {
      $quote = $value[0];
      if (($quote === '"' || $quote === "'") && substr($value, -1) === $quote) {
        $value = substr($value, 1, -1);
      }
    }

    $_ENV[$key] = $value;
    putenv($key . '=' . $value);
  }
}

function env_value(string $key, string $default = ''): string {
  $value = isset($_ENV[$key]) ? $_ENV[$key] : getenv($key);
  if ($value === false || $value === null) return $default;
  $value = trim((string) $value);
  return $value === '' ? $default : $value;
}

function cfg(string $key): string {
  static $config = null;

  if ($config === null) {
    $config = array(
      'fromEmail'        => env_value('MAIL_FROM_EMAIL', 'marketing@mariotstore.com'),
      'fromName'         => env_value('MAIL_FROM_NAME', 'Mariot Store'),
      'unsubscribeEmail' => env_value('MAIL_UNSUBSCRIBE_EMAIL', 'admin@mariotkitchen.com'),
      'logoUrl'          => env_value('MAIL_LOGO_URL', 'https://marketing.mariotstore.com/mariot-logo.png?v=4'),
      'socialIconBase'   => rtrim(env_value('MAIL_SOCIAL_ICON_BASE', 'https://marketing.mariotstore.com/icons'), '/'),
      'unsubscribeUrl'   => env_value('MAIL_UNSUBSCRIBE_URL', 'https://marketing.mariotstore.com/api/unsubscribe'),
      'brevoKey'         => env_value('BREVO_API_KEY'),
      'resendKey'        => env_value('RESEND_API_KEY'),
      'mailerSendKey'    => env_value('MAILERSEND_API_KEY'),
      'eoKey'            => env_value('EMAILOCTOPUS_API_KEY'),
      'eoListId'         => env_value('EMAILOCTOPUS_LIST_ID'),
      'eoAutomationId'   => env_value('EMAILOCTOPUS_AUTOMATION_ID'),
      'eoBaseUrl'        => env_value('EMAILOCTOPUS_BASE_URL', 'https://api.emailoctopus.com'),
    );
  }

  return isset($config[$key]) ? $config[$key] : '';
}

function unsubscribe_headers(): array {
  return array(
    'List-Unsubscribe'      => '<mailto:' . cfg('unsubscribeEmail') . '>',
    'List-Unsubscribe-Post' => 'List-Unsubscribe=One-Click',
  );
}

// ------------------------------------------------------------------- http --

/** @return array{status:int, body:array, raw:string, headers:array} */
function http_json(string $method, string $url, array $headers, ?array $payload = null): array {
  $handle = curl_init($url);
  if ($handle === false) throw new RuntimeException('Could not initialise curl');

  $options = array(
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_CUSTOMREQUEST  => $method,
    CURLOPT_HTTPHEADER     => $headers,
    CURLOPT_CONNECTTIMEOUT => 10,
    CURLOPT_TIMEOUT        => 30,
  );

  if ($payload !== null) {
    $options[CURLOPT_POSTFIELDS] = json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
  }

  // Capture response headers too: MailerSend reports its message id there.
  $responseHeaders = array();
  $options[CURLOPT_HEADERFUNCTION] = function ($handle, $line) use (&$responseHeaders) {
    $parts = explode(':', $line, 2);
    if (count($parts) === 2) {
      $responseHeaders[strtolower(trim($parts[0]))] = trim($parts[1]);
    }
    return strlen($line);
  };

  curl_setopt_array($handle, $options);

  $raw    = curl_exec($handle);
  $failed = $raw === false;
  $error  = $failed ? curl_error($handle) : '';
  $status = (int) curl_getinfo($handle, CURLINFO_RESPONSE_CODE);
  curl_close($handle);

  if ($failed) throw new RuntimeException('Could not reach ' . $url . ': ' . $error);

  $decoded = json_decode((string) $raw, true);

  return array(
    'status'  => $status,
    'body'    => is_array($decoded) ? $decoded : array(),
    'raw'     => (string) $raw,
    'headers' => $responseHeaders,
  );
}

function is_ok(array $response): bool {
  return $response['status'] >= 200 && $response['status'] < 300;
}

function flatten_errors($errors, string $prefix = ''): array {
  $out = array();

  foreach ((array) $errors as $key => $value) {
    $label = $prefix !== '' ? $prefix . '.' . $key : (string) $key;

    if (is_array($value)) {
      $out = array_merge($out, flatten_errors($value, $label));
    } else {
      $text = trim((string) $value);
      if ($text === '') continue;
      $out[] = is_string($key) ? $key . ': ' . $text : $text;
    }
  }

  return $out;
}

/**
 * Provider APIs report failures in a handful of shapes, so normalise whatever
 * came back into a single message the UI can show.
 */
function provider_error(array $response): string {
  $body = $response['body'];

  foreach (array('message', 'detail', 'title', 'error') as $key) {
    if (isset($body[$key]) && is_string($body[$key]) && trim($body[$key]) !== '') {
      return trim($body[$key]);
    }
  }

  if (isset($body['errors'])) {
    $errors = flatten_errors($body['errors']);
    if ($errors) return implode(' | ', $errors);
  }

  $raw = trim($response['raw']);
  if ($raw !== '') {
    $short = strlen($raw) > 300 ? substr($raw, 0, 300) . '...' : $raw;
    return 'HTTP ' . $response['status'] . ': ' . $short;
  }

  return 'HTTP ' . $response['status'];
}

function sender_name(array $mail): string {
  return isset($mail['fromName']) && $mail['fromName'] !== '' ? $mail['fromName'] : cfg('fromName');
}

// ------------------------------------------------------------ email markup --

/**
 * Footer links, drawn as the brand icons in public/icons rather than as text.
 * The icons are served from whichever host serves the app, so the preview and
 * the delivered email load the same images; override with MAIL_SOCIAL_ICON_BASE
 * when the app is hosted somewhere else.
 */
function social_links_html(): string {
  $links = array(
    array('Facebook',  'facebook',  'https://www.facebook.com/mariotuae'),
    array('Instagram', 'instagram', 'https://www.instagram.com/mariotuae/'),
    array('X',         'x',         'https://x.com/MariotUae'),
    array('YouTube',   'youtube',   'https://www.youtube.com/channel/UCUCWktTJNpRzUEJ58JHLu_g'),
    array('TikTok',    'tiktok',    'https://www.tiktok.com/@mariotmedia'),
    array('LinkedIn',  'linkedin',  'https://www.linkedin.com/in/mariot-kitchen-equipment-8a34a4108/?isSelfProfile=false'),
    array('Pinterest', 'pinterest', 'https://www.pinterest.com/mariotuae/'),
  );

  $base = cfg('socialIconBase');
  $size = 32;
  $html = array();

  foreach ($links as $link) {
    list($name, $icon, $url) = $link;
    // Icons only, so every link carries its network name as alt text: that is
    // what a client shows when it blocks images.
    $html[] = '<a class="social-link" href="' . $url . '"'
      . ' style="display:inline-block;margin:0 8px;text-decoration:none;">'
      . '<img src="' . $base . '/' . $icon . '.png?v=1"'
      . ' width="' . $size . '" height="' . $size . '" alt="' . $name . '"'
      . ' style="display:block;width:' . $size . 'px;height:' . $size . 'px;border:0;outline:none;text-decoration:none;" /></a>';
  }

  return implode("\n      ", $html);
}

/**
 * Campaigns are addressed by email only and this tool stores no names, so the
 * unsubscribe link carries the address and the admin notification derives a
 * readable name from it.
 */
function recipient_name(string $email): string {
  $local = explode('@', $email)[0];
  $parts = preg_split('/[._\-+]+/', $local, -1, PREG_SPLIT_NO_EMPTY);

  if (!is_array($parts) || !$parts) return 'Unknown';

  $name = array();
  foreach ($parts as $part) {
    $name[] = strtoupper(substr($part, 0, 1)) . substr($part, 1);
  }

  return implode(' ', $name);
}

/**
 * The Unsubscribe button target. public/api/unsubscribe.php answers it on PHP
 * hosting, api/unsubscribe.js on Vercel.
 */
function unsubscribe_link(string $email): string {
  return rtrim(cfg('unsubscribeUrl'), '/') . '?email=' . rawurlencode($email);
}

/**
 * Same markup the Node handler builds, so a message sent from this host is
 * indistinguishable from one sent by the Vercel function.
 */
function email_image_slot(string $url, string $label, int $height = 150, string $className = ''): string {
  if ($url !== '') {
    $safeUrl = htmlspecialchars($url, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
    return '<img class="fluid-img ' . $className . '" src="' . $safeUrl . '" alt="' . $label . '" style="display:block;width:100%;max-width:100%;height:auto;object-fit:contain;" />';
  }

  return '<div class="image-placeholder ' . $className . '" style="box-sizing:border-box;width:100%;height:' . $height . 'px;min-height:' . $height . 'px;background:#e8e8e5;border:1px dashed #aeb5b1;color:#62716b;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:' . $height . 'px;text-align:center;">' . $label . '</div>';
}

function inspiration_card(string $image, string $label, string $date, string $title, string $copy): string {
  return '<tr><td class="story-card" style="padding:0 0 38px;">'
    . $image
    . '<p style="margin:22px 0 4px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:18px;letter-spacing:2px;color:#c6ded6;">' . $date . '</p>'
    . '<h3 style="margin:0 0 12px;font-family:Arial,Helvetica,sans-serif;font-size:18px;line-height:1.4;letter-spacing:3px;text-transform:uppercase;color:#ffffff;">' . $title . '</h3>'
    . '<p style="margin:0 0 22px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.8;color:#e0ece8;">' . $copy . '</p>'
    . '<a href="https://mariotstore.com/en/shop-by-brands" style="display:inline-block;background:#35dfb3;color:#183e37;padding:14px 24px;font-family:Arial,Helvetica,sans-serif;font-size:14px;text-decoration:none;">EXPLORE MORE&nbsp; &#8250;</a>'
    . '</td></tr>';
}

function hotspot_card(string $image, string $label, string $date, string $title, string $copy): string {
  return '<td class="hotspot-col" width="50%" valign="top" style="width:50%;padding:0 10px;">'
    . $image
    . '<p style="margin:20px 0 4px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:18px;letter-spacing:2px;color:#bcbcbc;">' . $date . '</p>'
    . '<h3 style="margin:0 0 12px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.45;letter-spacing:2px;text-transform:uppercase;color:#ffffff;">' . $title . '</h3>'
    . '<p style="margin:0 0 20px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.75;color:#dedede;">' . $copy . '</p>'
    . '<a href="https://mariotstore.com/en/shop" style="display:inline-block;border:1px solid #f1f1f1;color:#ffffff;padding:12px 20px;font-family:Arial,Helvetica,sans-serif;font-size:14px;text-decoration:none;">Shop Now&nbsp; &#8250;</a>'
    . '</td>';
}

function build_html(array $mail): string {
  $fromName    = sender_name($mail);
  $logoUrl     = cfg('logoUrl');
  $headline    = htmlspecialchars(
    isset($mail['headline']) && $mail['headline'] !== '' ? (string) $mail['headline'] : 'The essentials of a better kitchen',
    ENT_QUOTES | ENT_SUBSTITUTE,
    'UTF-8'
  );
  $htmlMessage = isset($mail['html']) ? (string) $mail['html'] : '';
  $heroImage   = email_image_slot(isset($mail['heroImage']) ? (string) $mail['heroImage'] : '', 'Upload the lead kitchen image', 260, 'lead-image');
  $image1      = email_image_slot(isset($mail['image1']) ? (string) $mail['image1'] : '', 'Popular product image 1', 122, 'popular-image');
  $image2      = email_image_slot(isset($mail['image2']) ? (string) $mail['image2'] : '', 'Popular product image 2', 122, 'popular-image');
  $image3      = email_image_slot(isset($mail['image3']) ? (string) $mail['image3'] : '', 'Popular product image 3', 122, 'popular-image');
  $image4      = email_image_slot(isset($mail['image4']) ? (string) $mail['image4'] : '', 'Inspiration kitchen image 1', 240, 'inspiration-image');
  $image5      = email_image_slot(isset($mail['image5']) ? (string) $mail['image5'] : '', 'Inspiration kitchen image 2', 240, 'inspiration-image');
  $image6      = email_image_slot(isset($mail['image6']) ? (string) $mail['image6'] : '', 'Hotspot product image 1', 165, 'hotspot-image');
  $image7      = email_image_slot(isset($mail['image7']) ? (string) $mail['image7'] : '', 'Hotspot product image 2', 165, 'hotspot-image');
  $message2    = isset($mail['message2']) ? (string) $mail['message2'] : '';
  $intro       = isset($mail['html']) && $mail['html'] !== ''
    ? (string) $mail['html']
    : '<p>Thoughtful equipment makes every service run more smoothly. Discover reliable tools and professional solutions, selected for the kitchens that count on them every day.</p>';
  $popularCopy = $message2 !== ''
    ? $message2
    : 'From first prep to final plate, the right equipment helps your team do its best work. Explore some of the Mariot Store favourites chosen for performance, quality and lasting value.';
  $inspiration1 = inspiration_card($image4, 'Inspiration kitchen image 1', 'MARIOT KITCHEN NOTES', 'Made for the rhythm of service', 'Discover dependable professional equipment designed to keep busy kitchens moving, shift after shift.');
  $inspiration2 = inspiration_card($image5, 'Inspiration kitchen image 2', 'THE DETAILS THAT MATTER', 'Thoughtful tools. Better results.', 'From careful preparation to confident presentation, find the equipment that brings your kitchen together.');
  $hotspot1 = hotspot_card($image6, 'Hotspot product image 1', 'PREP&nbsp; / &nbsp;PERFORMANCE', 'A sharper start to every service', 'Reliable prep essentials help your team work efficiently from the first order to the last.');
  $hotspot2 = hotspot_card($image7, 'Hotspot product image 2', 'SERVICE&nbsp; / &nbsp;STYLE', 'Bring your best to the pass', 'Explore practical, favourites selected for the demands of modern kitchens.');
  $socialLinks = social_links_html();
  $unsubscribe = unsubscribe_link(isset($mail['to']) ? (string) $mail['to'] : '');

  return <<<HTML
<!DOCTYPE html>
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

      /* Stack other image rows, leaving the Popular gallery in two columns */
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
              <img src="{$logoUrl}" width="190" alt="{$fromName}" style="display:block;width:190px;height:auto;max-width:100%;border:0;outline:none;text-decoration:none;" />
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
    <h1 style="margin:0;font-family:Georgia,'Times New Roman',serif;font-size:46px;line-height:1.08;font-weight:700;letter-spacing:-1.2px;color:#122c25;">{$headline}</h1>
  </td>
</tr>

<tr>
  <td>{$heroImage}</td>
</tr>

<tr>
  <td class="px-content content-text" style="padding:34px 38px 42px;background:#f6f8f4;">
    <p style="margin:0 0 8px;font-family:Arial,Helvetica,sans-serif;font-size:12px;letter-spacing:3px;color:#263d35;">MARIOT STORE&nbsp; / &nbsp;THE KITCHEN JOURNAL</p>
    <h2 style="margin:0 0 16px;font-family:Arial,Helvetica,sans-serif;font-size:21px;line-height:1.5;letter-spacing:3px;text-transform:uppercase;color:#172c27;">Notes from the kitchen</h2>
    <div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.85;color:#454b48;">{$intro}</div>
  </td>
</tr>

<tr>
  <td class="px-images" style="padding:35px 34px 38px;background:#eeeeec;">
    <h2 style="margin:0 0 24px;font-family:Georgia,'Times New Roman',serif;font-size:34px;line-height:1.2;color:#242725;">Popular</h2>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;">
      <tr>

        <td class="popular-col" width="33%" style="width:33%;padding-right:10px;">
          {$image1}
        </td>

        <td class="popular-col" width="34%" style="width:34%;padding:0 5px;">
          {$image2}
        </td>

        <td class="popular-col popular-third" width="33%" style="width:33%;padding-left:10px;">
          {$image3}
        </td>

      </tr>
    </table>
    <div class="content-text" style="padding:22px 4px 0;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.8;color:#414744;">{$popularCopy}</div>
  </td>
</tr>

<tr>
  <td style="padding:36px 34px 6px;background:#1b4b42;">
    <h2 style="margin:0 0 28px;font-family:Georgia,'Times New Roman',serif;font-size:36px;line-height:1.2;color:#fff;">Inspirations</h2>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      {$inspiration1}
      {$inspiration2}
    </table>
  </td>
</tr>

<tr>
  <td style="padding:34px 24px 42px;background:#292929;">
    <h2 style="margin:0 10px 26px;font-family:Georgia,'Times New Roman',serif;font-size:36px;line-height:1.2;color:#fff;">Hotspots</h2>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      {$hotspot1}
      {$hotspot2}
    </tr></table>
  </td>
</tr>

  <tr>
    <td align="center" style="padding:24px 24px 8px;background:#f6f8f4;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.8;color:#555;">
      <a href="{$unsubscribe}" style="color:#555;text-decoration:underline;">Unsubscribe</a> &nbsp;|&nbsp;
      <a href="https://mariotstore.com/" style="color:#555;text-decoration:underline;">View online</a><br/>
      You’re receiving this email from Mariot Store.
    </td>
  </tr>

  <tr>
    <td class="px-social" align="center" style="padding:24px 25px 16px;background:#f6f8f4;border-top:1px solid #9cb9ad;">
        {$socialLinks}
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
</html>
HTML;
}

/** Plain-text fallback, derived the same way the Node handler derives it. */
function html_to_text(string $html): string {
  $text = preg_replace('/<br\s*\/?>/i', "\n", $html);
  $text = preg_replace('/<\/p>/i', "\n", $text);
  $text = preg_replace('/<[^>]+>/', '', $text);
  $text = str_replace(
    array('&nbsp;', '&amp;', '&lt;', '&gt;'),
    array(' ', '&', '<', '>'),
    $text
  );

  return trim((string) $text);
}

// ---------------------------------------------------------------- senders --

/**
 * Brevo accepts a send request even when the sender is not validated, then
 * rejects it asynchronously, so the tool would report "sent" for mail that was
 * dropped. Verify the sender up front and fail loudly instead.
 */
function assert_brevo_sender_valid(): void {
  static $checked = false;
  static $senders = array();
  static $domains = array();

  if (!$checked) {
    $checked = true;
    $headers = array('api-key: ' . cfg('brevoKey'), 'accept: application/json');

    $sendersOk = true;
    $domainsOk = true;

    try {
      $response = http_json('GET', 'https://api.brevo.com/v3/senders', $headers);
      $sendersOk = is_ok($response);
      if ($sendersOk) {
        foreach ((array) ($response['body']['senders'] ?? array()) as $sender) {
          $senders[] = strtolower((string) ($sender['email'] ?? ''));
        }
      }
    } catch (Throwable $err) {
      $sendersOk = false;
    }

    try {
      $response = http_json('GET', 'https://api.brevo.com/v3/senders/domains', $headers);
      $domainsOk = is_ok($response);
      if ($domainsOk) {
        foreach ((array) ($response['body']['domains'] ?? array()) as $domain) {
          if (empty($domain['authenticated']) || empty($domain['domain_name'])) continue;
          $domains[] = strtolower((string) $domain['domain_name']);
        }
      }
    } catch (Throwable $err) {
      $domainsOk = false;
    }

    // Brevo unreachable - do not block sending, let Brevo decide.
    if (!$sendersOk && !$domainsOk) return;
  }

  $address = strtolower(cfg('fromEmail'));
  $parts   = explode('@', $address, 2);
  $domain  = isset($parts[1]) ? $parts[1] : '';

  if (in_array($address, $senders, true) || in_array($domain, $domains, true)) return;

  throw new RuntimeException(
    cfg('fromEmail') . ' is not a validated Brevo sender and "' . $domain . '" is not an authenticated ' .
    'Brevo domain, so Brevo drops every message it accepts. Add the sender or authenticate the domain ' .
    'under Senders & IP in Brevo, or select a different provider.'
  );
}

function send_via_brevo(string $email, array $mail): array {
  if (cfg('brevoKey') === '') throw new RuntimeException('BREVO_API_KEY is not set');

  assert_brevo_sender_valid();

  $response = http_json('POST', 'https://api.brevo.com/v3/smtp/email', array(
    'api-key: ' . cfg('brevoKey'),
    'accept: application/json',
    'content-type: application/json',
  ), array(
    'sender'      => array('email' => cfg('fromEmail'), 'name' => sender_name($mail)),
    'to'          => array(array('email' => $email)),
    'subject'     => $mail['subject'],
    'textContent' => $mail['text'],
    'headers'     => unsubscribe_headers(),
    'htmlContent' => build_html($mail),
  ));

  if (!is_ok($response)) throw new RuntimeException(provider_error($response));

  return array(
    'status' => 'sent',
    'id'     => isset($response['body']['messageId']) ? (string) $response['body']['messageId'] : '',
  );
}

function send_via_resend(string $email, array $mail): array {
  if (cfg('resendKey') === '') throw new RuntimeException('RESEND_API_KEY is not set');

  $response = http_json('POST', 'https://api.resend.com/emails', array(
    'Authorization: Bearer ' . cfg('resendKey'),
    'Content-Type: application/json',
  ), array(
    'from'    => sender_name($mail) . ' <' . cfg('fromEmail') . '>',
    'to'      => array($email),
    'subject' => $mail['subject'],
    'text'    => $mail['text'],
    'html'    => build_html($mail),
    'headers' => unsubscribe_headers(),
  ));

  if (!is_ok($response)) throw new RuntimeException(provider_error($response));

  return array(
    'status' => 'sent',
    'id'     => isset($response['body']['id']) ? (string) $response['body']['id'] : '',
  );
}

function send_via_mailersend(string $email, array $mail): array {
  if (cfg('mailerSendKey') === '') throw new RuntimeException('MAILERSEND_API_KEY is not set');

  $headers = array();
  foreach (unsubscribe_headers() as $name => $value) {
    $headers[] = array('name' => $name, 'value' => $value);
  }

  $response = http_json('POST', 'https://api.mailersend.com/v1/email', array(
    'Authorization: Bearer ' . cfg('mailerSendKey'),
    'Content-Type: application/json',
  ), array(
    'from'    => array('email' => cfg('fromEmail'), 'name' => sender_name($mail)),
    'to'      => array(array('email' => $email)),
    'subject' => $mail['subject'],
    'text'    => $mail['text'],
    'html'    => build_html($mail),
    'headers' => $headers,
  ));

  if (!is_ok($response)) throw new RuntimeException(provider_error($response));

  $messageId = isset($response['headers']['x-message-id']) ? $response['headers']['x-message-id'] : '';
  if ($messageId === '' && isset($response['body']['message_id'])) {
    $messageId = (string) $response['body']['message_id'];
  }

  return array('status' => 'sent', 'id' => $messageId);
}

function email_octopus_request(string $path, array $body, bool $ignoreConflict = false): array {
  $response = http_json('POST', rtrim(cfg('eoBaseUrl'), '/') . $path, array(
    'Authorization: Bearer ' . cfg('eoKey'),
    'Content-Type: application/json',
  ), $body);

  if (is_ok($response)) return $response['body'];

  // Re-adding an existing contact is a no-op, not a failure.
  if ($ignoreConflict && $response['status'] === 409) return array();

  throw new RuntimeException(provider_error($response));
}

/**
 * EmailOctopus has no transactional send endpoint: it adds the recipient to a
 * list and, when an automation id is configured, queues them into that
 * automation. The email that actually goes out is the dashboard one.
 */
function send_via_emailoctopus(string $email, array $mail): array {
  if (cfg('eoKey') === '') throw new RuntimeException('EMAILOCTOPUS_API_KEY is not set');
  if (cfg('eoListId') === '') throw new RuntimeException('EMAILOCTOPUS_LIST_ID is not set');

  $contact = email_octopus_request(
    '/lists/' . rawurlencode(cfg('eoListId')) . '/contacts',
    array('email_address' => $email, 'status' => 'subscribed'),
    true
  );

  // The queue endpoint accepts the contact id or an MD5 hash of the lowercased
  // email address, so a reference always exists even for an existing contact.
  $contactId    = isset($contact['id']) ? (string) $contact['id'] : md5(strtolower(trim($email)));
  $automationId = cfg('eoAutomationId');

  if ($automationId === '') {
    return array(
      'status' => 'queued',
      'id'     => $contactId,
      'note'   => 'No automation is configured, so nothing was emailed - the recipient was only added to the list.',
    );
  }

  email_octopus_request(
    '/automations/' . rawurlencode($automationId) . '/queue',
    array('contact_id' => $contactId)
  );

  return array(
    'status' => 'queued',
    'id'     => $contactId,
    'note'   => 'Queued into the EmailOctopus automation; the delivered email is the one built in EmailOctopus.',
  );
}

// ------------------------------------------------------------------- main --

function send_campaign(array $body): void {
  $emails = isset($body['emails']) ? $body['emails'] : null;
  if (!is_array($emails)) {
    respond(500, array('error' => 'emails must be an array'));
  }

  // provider = "brevo" | "resend" | "mailersend" | "emailoctopus" | "auto"
  // "auto" tries Brevo, then Resend, then MailerSend, falling back on failure.
  $provider = isset($body['provider']) && $body['provider'] !== '' ? (string) $body['provider'] : 'auto';
  $message  = isset($body['message']) ? (string) $body['message'] : '';

  // `message` arrives as real HTML from the rich-text editor, so it is used
  // as-is for the email body; the plain-text part is derived by stripping tags.
  $mail = array(
    'subject'   => isset($body['subject']) ? (string) $body['subject'] : '',
    'headline'  => isset($body['headline']) ? (string) $body['headline'] : '',
    'html'      => $message,
    'text'      => (isset($body['headline']) && $body['headline'] !== '' ? (string) $body['headline'] : 'The essentials of a better kitchen')
      . "\n\n"
      . html_to_text($message),
    'fromName'  => isset($body['fromName']) ? (string) $body['fromName'] : '',
    'heroImage' => isset($body['heroImage']) ? (string) $body['heroImage'] : '',
    'image1'    => isset($body['image1']) ? (string) $body['image1'] : '',
    'image2'    => isset($body['image2']) ? (string) $body['image2'] : '',
    'image3'    => isset($body['image3']) ? (string) $body['image3'] : '',
    'image4'    => isset($body['image4']) ? (string) $body['image4'] : '',
    'image5'    => isset($body['image5']) ? (string) $body['image5'] : '',
    'image6'    => isset($body['image6']) ? (string) $body['image6'] : '',
    'image7'    => isset($body['image7']) ? (string) $body['image7'] : '',
    'message2'  => isset($body['message2']) ? (string) $body['message2'] : '',
  );

  $senders = array(
    'brevo'        => 'send_via_brevo',
    'resend'       => 'send_via_resend',
    'mailersend'   => 'send_via_mailersend',
    'emailoctopus' => 'send_via_emailoctopus',
  );

  // EmailOctopus is never used by "auto": it triggers a pre-built automation
  // rather than delivering the HTML composed in this tool.
  $autoOrder = array('brevo', 'resend', 'mailersend');

  $results = array();

  foreach ($emails as $candidate) {
    $email        = trim((string) $candidate);
    $usedProvider = $provider;
    $sent         = false;
    $failures     = array();
    $outcome      = array();

    // build_html() puts the recipient's own unsubscribe link in the footer, so
    // the address has to travel with the message.
    $mail['to'] = $email;

    try {
      if ($provider === 'auto') {
        foreach ($autoOrder as $name) {
          try {
            $outcome      = call_user_func($senders[$name], $email, $mail);
            $usedProvider = $name;
            $sent         = true;
            break;
          } catch (Throwable $err) {
            $failures[] = $name . ': ' . $err->getMessage();
            error_log('[send-email] ' . $name . ' failed for ' . $email . ': ' . $err->getMessage());
          }
        }

        // Report every provider's reason - the last one alone is misleading,
        // since the primary provider's failure is usually the real problem.
        if (!$sent) {
          throw new RuntimeException(
            $failures
              ? 'All providers failed - ' . implode(' | ', $failures)
              : 'All providers failed'
          );
        }
      } else {
        if (!isset($senders[$provider])) {
          throw new RuntimeException('Unknown provider: ' . $provider);
        }

        $outcome      = call_user_func($senders[$provider], $email, $mail);
        $usedProvider = $provider;
        $sent         = true;
      }

      // Providers return a reference for the message they accepted, so a "sent"
      // can be looked up in the provider dashboard instead of taken on trust.
      $entry = array(
        'email'    => $email,
        'status'   => isset($outcome['status']) ? $outcome['status'] : 'sent',
        'provider' => $usedProvider,
      );
      if (isset($outcome['id']) && $outcome['id'] !== '') $entry['id'] = $outcome['id'];
      if (isset($outcome['note']) && $outcome['note'] !== '') $entry['note'] = $outcome['note'];

      error_log(
        '[send-email] ' . $entry['status'] . ' [' . $usedProvider . ']: ' . $email .
        (isset($entry['id']) ? ' id=' . $entry['id'] : '')
      );

      $results[] = $entry;
    } catch (Throwable $err) {
      error_log('[send-email] Failed [' . $usedProvider . ']: ' . $email . ' - ' . $err->getMessage());
      $results[] = array(
        'email'    => $email,
        'status'   => 'failed',
        'error'    => $err->getMessage(),
        'provider' => $usedProvider,
      );
    }
  }

  respond(200, array('success' => true, 'results' => $results));
}

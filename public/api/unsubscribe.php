<?php
/**
 * GET /api/unsubscribe - PHP twin of api/unsubscribe.js.
 *
 * The production site is uploaded as a static build to PHP shared hosting
 * (Hostinger), which cannot run the Node serverless function in api/, so that
 * endpoint 404s there. This file serves the same route: a click on the
 * Unsubscribe button in the email footer lands here with the recipient's
 * address, the admin address is told who asked to be removed, and the recipient
 * is shown a confirmation page.
 *
 * Reads the same .env keys as the Node handler:
 *   MAIL_UNSUBSCRIBE_EMAIL, MAIL_FROM_EMAIL, MAIL_FROM_NAME,
 *   BREVO_API_KEY, RESEND_API_KEY, MAILERSEND_API_KEY
 *
 * The .env is looked for outside the web root first (../.env, one level above
 * public_html on Hostinger), then next to this file. Never commit it.
 */

declare(strict_types=1);

header('Cache-Control: no-store');

load_env_file(dirname(__DIR__, 2) . '/.env'); // ../.env relative to the web root
load_env_file(__DIR__ . '/.env');

// --------------------------------------------------------------- settings --

function env_value(string $key, string $default = ''): string {
  $value = isset($_ENV[$key]) ? $_ENV[$key] : getenv($key);
  if ($value === false || $value === null) return $default;
  $value = trim((string) $value);
  return $value === '' ? $default : $value;
}

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

// ------------------------------------------------------------------ values --

function admin_email(): string {
  return env_value('MAIL_UNSUBSCRIBE_EMAIL', 'admin@mariotkitchen.com');
}

function e(string $value): string {
  return htmlspecialchars($value, ENT_QUOTES, 'UTF-8');
}

function is_email(string $value): bool {
  return (bool) preg_match('/^[^\s@]+@[^\s@]+\.[^\s@]+$/', $value);
}

/**
 * This tool addresses campaigns by email and stores no names, so derive a
 * readable one from the address ("john.doe@example.com" -> "John Doe") to give
 * the admin something human to read next to the address.
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

// -------------------------------------------------------------------- http --

/** @return array{status:int, body:array, raw:string} */
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

  curl_setopt_array($handle, $options);

  $raw    = curl_exec($handle);
  $failed = $raw === false;
  $error  = $failed ? curl_error($handle) : '';
  $status = (int) curl_getinfo($handle, CURLINFO_RESPONSE_CODE);
  curl_close($handle);

  if ($failed) throw new RuntimeException('Could not reach ' . $url . ': ' . $error);

  $decoded = json_decode((string) $raw, true);

  return array(
    'status' => $status,
    'body'   => is_array($decoded) ? $decoded : array(),
    'raw'    => (string) $raw,
  );
}

function is_ok(array $response): bool {
  return $response['status'] >= 200 && $response['status'] < 300;
}

/** Provider APIs report failures in a handful of shapes; normalise them. */
function provider_error(array $response): string {
  $body = $response['body'];

  foreach (array('message', 'detail', 'title', 'error') as $key) {
    if (isset($body[$key]) && is_string($body[$key]) && trim($body[$key]) !== '') {
      return trim($body[$key]);
    }
  }

  $raw = trim($response['raw']);
  if ($raw !== '') {
    $short = strlen($raw) > 300 ? substr($raw, 0, 300) . '...' : $raw;
    return 'HTTP ' . $response['status'] . ': ' . $short;
  }

  return 'HTTP ' . $response['status'];
}

// ----------------------------------------------------------------- senders --

/**
 * Sends the notification through the same providers `auto` uses in
 * send-email.php, in the same order, so the endpoint works with whichever key is
 * configured. The message is plain, not the composed campaign template.
 */
function send_notification(string $subject, string $html, string $text): string {
  $sender = env_value('MAIL_FROM_EMAIL', 'marketing@mariotstore.com');
  $name   = env_value('MAIL_FROM_NAME', 'Mariot Store');
  $admin  = admin_email();

  $attempts = array(
    'brevo' => function () use ($sender, $name, $admin, $subject, $html, $text) {
      $key = env_value('BREVO_API_KEY');
      if ($key === '') throw new RuntimeException('BREVO_API_KEY is not set');

      $response = http_json('POST', 'https://api.brevo.com/v3/smtp/email', array(
        'api-key: ' . $key,
        'accept: application/json',
        'content-type: application/json',
      ), array(
        'sender'      => array('email' => $sender, 'name' => $name),
        'to'          => array(array('email' => $admin)),
        'subject'     => $subject,
        'htmlContent' => $html,
        'textContent' => $text,
      ));

      if (!is_ok($response)) throw new RuntimeException(provider_error($response));
    },

    'resend' => function () use ($sender, $name, $admin, $subject, $html, $text) {
      $key = env_value('RESEND_API_KEY');
      if ($key === '') throw new RuntimeException('RESEND_API_KEY is not set');

      $response = http_json('POST', 'https://api.resend.com/emails', array(
        'Authorization: Bearer ' . $key,
        'Content-Type: application/json',
      ), array(
        'from'    => $name . ' <' . $sender . '>',
        'to'      => array($admin),
        'subject' => $subject,
        'html'    => $html,
        'text'    => $text,
      ));

      if (!is_ok($response)) throw new RuntimeException(provider_error($response));
    },

    'mailersend' => function () use ($sender, $name, $admin, $subject, $html, $text) {
      $key = env_value('MAILERSEND_API_KEY');
      if ($key === '') throw new RuntimeException('MAILERSEND_API_KEY is not set');

      $response = http_json('POST', 'https://api.mailersend.com/v1/email', array(
        'Authorization: Bearer ' . $key,
        'Content-Type: application/json',
      ), array(
        'from'    => array('email' => $sender, 'name' => $name),
        'to'      => array(array('email' => $admin)),
        'subject' => $subject,
        'html'    => $html,
        'text'    => $text,
      ));

      if (!is_ok($response)) throw new RuntimeException(provider_error($response));
    },
  );

  $failures = array();

  foreach ($attempts as $provider => $send) {
    try {
      $send();
      return $provider;
    } catch (Throwable $err) {
      $failures[] = $provider . ': ' . $err->getMessage();
    }
  }

  throw new RuntimeException($failures ? implode(' | ', $failures) : 'No provider is configured');
}

// ----------------------------------------------------------------- the page --

function unsubscribe_page(string $title, string $heading, string $body): string {
  $safeTitle   = e($title);
  $safeHeading = e($heading);

  return <<<HTML
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<meta name="robots" content="noindex,nofollow"/>
<title>{$safeTitle}</title>
</head>
<body style="margin:0;padding:40px 16px;background:#f5f5f5;font-family:Arial,Helvetica,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;">
<tr>
<td align="center">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:520px;background:#ffffff;border-radius:12px;">
    <tr>
      <td style="padding:34px 32px;color:#333333;font-size:14px;line-height:24px;">
        <h1 style="margin:0 0 14px;font-size:20px;line-height:28px;">{$safeHeading}</h1>
        {$body}
      </td>
    </tr>
  </table>
</td>
</tr>
</table>
</body>
</html>
HTML;
}

function show_page(int $status, string $title, string $heading, string $body): void {
  http_response_code($status);
  header('Content-Type: text/html; charset=utf-8');
  echo unsubscribe_page($title, $heading, $body);
  exit;
}

// -------------------------------------------------------------------- main --

$method = isset($_SERVER['REQUEST_METHOD']) ? (string) $_SERVER['REQUEST_METHOD'] : '';

if ($method === 'OPTIONS') {
  http_response_code(200);
  exit;
}

if ($method !== 'GET') {
  http_response_code(405);
  header('Content-Type: application/json; charset=utf-8');
  echo json_encode(array('error' => 'Method not allowed'));
  exit;
}

$email = isset($_GET['email']) ? trim((string) $_GET['email']) : '';
$admin = admin_email();
$adminLink = '<a href="mailto:' . e($admin) . '" style="color:#0a66c2;">' . e($admin) . '</a>';

if (!is_email($email)) {
  show_page(
    400,
    'Unsubscribe',
    'We could not tell which address to unsubscribe',
    '<p style="margin:0;">Open the unsubscribe link from the email you received, or write to '
    . $adminLink . ' and we will remove you by hand.</p>'
  );
}

$name        = recipient_name($email);
$requestedAt = gmdate('Y-m-d H:i') . ' UTC';
$subject     = 'Unsubscribe request: ' . $email;

$html = '<p style="margin:0 0 16px;">Someone used the unsubscribe button in a Mariot Store email.</p>'
  . '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="font-size:14px;line-height:24px;">'
  . '<tr><td style="padding:2px 14px 2px 0;color:#8a8a8a;">Name</td><td><strong>' . e($name) . '</strong></td></tr>'
  . '<tr><td style="padding:2px 14px 2px 0;color:#8a8a8a;">Email</td><td><strong>' . e($email) . '</strong></td></tr>'
  . '<tr><td style="padding:2px 14px 2px 0;color:#8a8a8a;">Requested</td><td>' . e($requestedAt) . '</td></tr>'
  . '</table>'
  . '<p style="margin:16px 0 0;color:#8a8a8a;font-size:13px;">'
  . 'This tool addresses campaigns by email and stores no names, so the name above is derived from the address. '
  . 'If this request looks unexpected, an email link scanner may have opened the link - check the address before removing it.'
  . '</p>';

$text = implode("\n", array(
  'Someone used the unsubscribe button in a Mariot Store email.',
  '',
  'Name:      ' . $name,
  'Email:     ' . $email,
  'Requested: ' . $requestedAt,
  '',
  'This tool addresses campaigns by email and stores no names, so the name above is derived from the address.',
  'If this request looks unexpected, an email link scanner may have opened the link - check the address before removing it.',
));

try {
  $provider = send_notification($subject, $html, $text);
  error_log('[unsubscribe] notified ' . $admin . ' about ' . $email . ' via ' . $provider);
} catch (Throwable $err) {
  error_log('[unsubscribe] could not notify ' . $admin . ' about ' . $email . ': ' . $err->getMessage());

  show_page(
    200,
    'Unsubscribe',
    'We could not reach our server',
    '<p style="margin:0 0 14px;"><strong>' . e($email) . '</strong> could not be unsubscribed automatically.</p>'
    . '<p style="margin:0;">Please write to ' . $adminLink . ' and we will remove you by hand.</p>'
  );
}

show_page(
  200,
  'Unsubscribed',
  'You have been unsubscribed',
  '<p style="margin:0 0 14px;">We have told Mariot Store that <strong>' . e($email) . '</strong> '
  . 'should be removed from future campaigns.</p>'
  . '<p style="margin:0;color:#8a8a8a;font-size:13px;">If you keep receiving emails, write to ' . $adminLink . '.</p>'
);

<?php
/**
 * /api/email-records - UAE email scraper and email record store (PHP twin of
 * api/email-records.js).
 *
 *   GET  ?action=stats                         counts per status
 *   GET  ?action=export                        download all records as CSV (Excel)
 *   POST { action: "scrape", need, keywords }  one scrape step, see rec_scrape_step()
 *   POST { action: "load", mode, count, exclude }  recipients from the records
 *   POST { action: "filter", mode, emails }    drop unsubscribed / already emailed
 *   POST { action: "mark", email, status, error }  record a send result
 *
 * No keys are required. Optional .env keys: SCRAPER_DAILY_SEARCHES (per engine,
 * default 120), SERPER_API_KEY / SERPAPI_API_KEY, RECORDS_DIR,
 * SCRAPER_SMTP_CHECK=1, TOOL_API_KEY.
 */

declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST');
header('Access-Control-Allow-Headers: Content-Type, X-Tool-Key');

load_env_file(dirname(__DIR__, 2) . '/.env');
load_env_file(__DIR__ . '/.env');

require __DIR__ . '/_records-lib.php';

function respond(int $status, array $payload): void {
  http_response_code($status);
  echo json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
  exit;
}

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
      if (($quote === '"' || $quote === "'") && substr($value, -1) === $quote) $value = substr($value, 1, -1);
    }
    $_ENV[$key] = $value;
    putenv($key . '=' . $value);
  }
}

$method = isset($_SERVER['REQUEST_METHOD']) ? (string) $_SERVER['REQUEST_METHOD'] : '';
if ($method === 'OPTIONS') { http_response_code(200); exit; }

// Optional shared key, so strangers cannot read the list or spend search credits.
$toolKey = env_value('TOOL_API_KEY');
if ($toolKey !== '') {
  $given = isset($_SERVER['HTTP_X_TOOL_KEY']) ? (string) $_SERVER['HTTP_X_TOOL_KEY'] : (string) ($_GET['key'] ?? '');
  if (!hash_equals($toolKey, $given)) respond(401, array('error' => 'Unauthorized'));
}

try {
  if ($method === 'GET') {
    $action = (string) ($_GET['action'] ?? 'stats');

    if ($action === 'export') {
      $path = rec_csv_path();
      header('Content-Type: text/csv; charset=utf-8');
      header('Content-Disposition: attachment; filename="uae-email-records-' . gmdate('Y-m-d') . '.csv"');
      if (is_file($path)) {
        rec_locked(function () use ($path) { readfile($path); });
      } else {
        echo "\xEF\xBB\xBF" . implode(',', REC_COLUMNS) . "\n";
      }
      exit;
    }

    respond(200, array(
      'stats'          => rec_stats(rec_load()),
      'searchProvider' => rec_search_provider(),
      'engines'        => rec_search_provider() === 'free' ? rec_engine_status() : null,
      'sites'          => rec_sites_status(),
      'businessTypes'  => array_map(function ($t) { return $t['label']; }, rec_business_types()),
    ));
  }

  if ($method !== 'POST') respond(405, array('error' => 'Method not allowed'));

  $raw  = file_get_contents('php://input');
  $body = is_string($raw) && $raw !== '' ? json_decode($raw, true) : null;
  if (!is_array($body)) respond(400, array('error' => 'Request body must be valid JSON'));

  $action = (string) ($body['action'] ?? '');
  $mode = in_array($body['mode'] ?? '', array('new', 'old', 'random'), true) ? $body['mode'] : 'new';

  switch ($action) {
    case 'prepare-sites':
      respond(200, rec_prepare_sites() + array('sites' => rec_sites_status()));

    case 'crawl':
      $result = rec_crawl_step($body);
      $result['stats'] = rec_stats(rec_load());
      $result['sites'] = rec_sites_status();
      respond(200, $result);

    case 'classify':
      $result = rec_classify_step();
      $result['stats'] = rec_stats(rec_load());
      respond(200, $result);

    case 'scrape':
      $result = rec_scrape_step($body);
      $result['stats'] = rec_stats(rec_load());
      respond(200, $result);

    case 'load':
      $count = max(0, min(5000, (int) ($body['count'] ?? 0)));
      $exclude = is_array($body['exclude'] ?? null) ? $body['exclude'] : array();
      respond(200, array('emails' => rec_pick($mode, $count, $exclude, rec_clean_types($body['types'] ?? null)),
                         'stats' => rec_stats(rec_load())));

    case 'filter':
      $emails = is_array($body['emails'] ?? null) ? $body['emails'] : array();
      respond(200, rec_filter($mode, $emails));

    case 'mark':
      $record = rec_mark((string) ($body['email'] ?? ''), (string) ($body['status'] ?? ''), (string) ($body['error'] ?? ''));
      respond(200, array('ok' => true, 'record' => $record));

    default:
      respond(400, array('error' => 'Unknown action'));
  }
} catch (InvalidArgumentException $err) {
  respond(400, array('error' => $err->getMessage()));
} catch (Throwable $err) {
  error_log('[email-records] ' . $err->getMessage());
  respond(500, array('error' => $err->getMessage()));
}

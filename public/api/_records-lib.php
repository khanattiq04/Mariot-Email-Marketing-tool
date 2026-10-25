<?php
/**
 * Shared code for the UAE email scraper and the email record store.
 *
 * Included by email-records.php (the API) and unsubscribe.php (to mark people
 * as unsubscribed). It is never an endpoint itself: a direct request gets 404.
 *
 * Records live in a CSV file that opens straight in Excel:
 *
 *   <RECORDS_DIR>/uae-email-records.csv
 *
 * RECORDS_DIR defaults to an "email-data" folder next to the .env, one level
 * above public_html, so the list is never downloadable from the web. When that
 * folder cannot be created, api/data/ is used and locked with an .htaccess.
 */

declare(strict_types=1);

if (isset($_SERVER['SCRIPT_FILENAME']) && realpath((string) $_SERVER['SCRIPT_FILENAME']) === __FILE__) {
  http_response_code(404);
  exit;
}

if (!function_exists('env_value')) {
  function env_value(string $key, string $default = ''): string {
    $value = isset($_ENV[$key]) ? $_ENV[$key] : getenv($key);
    if ($value === false || $value === null) return $default;
    $value = trim((string) $value);
    return $value === '' ? $default : $value;
  }
}

const REC_COLUMNS = array(
  'email', 'status', 'domain', 'city', 'category', 'source_url',
  'found_at', 'last_sent_at', 'send_count', 'last_error', 'business_type',
);

// Statuses: new (found, never emailed), sent, failed, unsubscribed, invalid.
const REC_BLOCKED_STATUSES = array('unsubscribed', 'invalid');

const REC_MAX_PAGES_PER_QUERY = 5;          // 5 x 10 Google results per query
const REC_RECRAWL_AFTER_SECONDS = 2592000;  // do not re-crawl a site for 30 days
const REC_STEP_BUDGET_SECONDS = 24;         // keep one request under host limits

const REC_UAE_CITIES = array(
  'Dubai', 'Abu Dhabi', 'Sharjah', 'Ajman', 'Al Ain',
  'Ras Al Khaimah', 'Fujairah', 'Umm Al Quwain',
);

const REC_DEFAULT_CATEGORIES = array(
  'restaurants', 'cafes', 'hotels', 'catering companies', 'bakeries',
  'cloud kitchens', 'coffee shops', 'supermarkets', 'food trading companies',
  'hotel apartments', 'resorts', 'juice bars', 'sweets shops', 'butcher shops',
  'hospitals', 'clinics', 'dental clinics', 'pharmacies', 'schools',
  'nurseries', 'training institutes', 'universities', 'real estate companies',
  'construction companies', 'contracting companies', 'interior design companies',
  'fit out companies', 'facility management companies', 'general trading companies',
  'logistics companies', 'freight forwarders', 'travel agencies', 'car rental companies',
  'car dealers', 'auto repair garages', 'beauty salons', 'spas', 'gyms',
  'IT companies', 'software companies', 'digital marketing agencies',
  'advertising agencies', 'event management companies', 'law firms',
  'accounting firms', 'audit firms', 'business setup consultants',
  'insurance companies', 'recruitment agencies', 'manpower supply companies',
  'cleaning companies', 'pest control companies', 'laundry services',
  'printing companies', 'furniture stores', 'electronics stores',
  'jewellery shops', 'perfume shops', 'fashion boutiques', 'security services',
  'AC maintenance companies', 'electrical contractors', 'steel fabrication companies',
  'packaging companies', 'food manufacturers', 'industrial suppliers',
);

// Sites that need a login or never print addresses; their search snippets are
// still read, the pages themselves are not fetched.
const REC_SKIP_HOSTS = array(
  'facebook.com', 'instagram.com', 'linkedin.com', 'twitter.com', 'x.com',
  'youtube.com', 'tiktok.com', 'pinterest.com', 'wikipedia.org', 'google.com',
  'tripadvisor.com', 'booking.com', 'amazon.ae', 'amazon.com', 'noon.com',
  'talabat.com', 'deliveroo.ae', 'careem.com', 'reddit.com', 'quora.com',
);

const REC_JUNK_DOMAINS = array(
  'example.com', 'example.org', 'example.net', 'domain.com', 'email.com',
  'yourdomain.com', 'yoursite.com', 'yourcompany.com', 'company.com', 'mysite.com',
  'website.com', 'test.com', 'sentry.io', 'wixpress.com', 'sentry.wixpress.com',
  'sentry-next.wixpress.com', 'w3.org', 'schema.org', 'placeholder.com',
  'godaddy.com', 'gmail.co', 'gmial.com', 'gamil.com', 'gmai.com', 'hotmial.com',
  'yaho.com', 'mailinator.com', 'guerrillamail.com', '10minutemail.com',
  'tempmail.com', 'temp-mail.org', 'yopmail.com', 'trashmail.com',
  'sharklasers.com', 'getnada.com', 'dispostable.com', 'maildrop.cc',
  'throwawaymail.com', 'fakeinbox.com',
);

const REC_JUNK_LOCALS = array(
  'noreply', 'no-reply', 'no_reply', 'donotreply', 'do-not-reply', 'mailer-daemon',
  'postmaster', 'abuse', 'hostmaster', 'example', 'test', 'user', 'username',
  'name', 'email', 'youremail', 'your.email', 'yourname', 'your-email', 'john.doe',
  'johndoe', 'jane.doe', 'firstname.lastname', 'firstname', 'someone', 'xxx', 'xyz', 'abc', 'demo', 'sample',
);

const REC_FILE_EXTENSIONS = array(
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'css', 'js', 'ico', 'bmp', 'tif',
  'tiff', 'mp4', 'pdf', 'avif', 'woff', 'woff2', 'ttf', 'eot', 'json', 'xml',
  'php', 'html', 'htm', 'asp', 'aspx', 'zip',
);

// Two-letter TLDs that are used generically rather than as a country.
const REC_GENERIC_CC = array('ae', 'co', 'io', 'me', 'tv', 'ai', 'cc', 'ws', 'fm');

const REC_BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const REC_UAE_MARKER = '/(?:\+|00)\s?971|\bU\.?A\.?E\.?\b|United Arab Emirates|Emirates\b|Dubai|Abu\s?Dhabi|Sharjah|Ajman|Al\s?Ain|Ras\s?Al\s?Khaimah|\bRAK\b|Fujairah|Umm\s?Al\s?Quwain|Jebel\s?Ali|Musaffah|Mussafah|Deira|Bur\s?Dubai/i';

// ------------------------------------------------------------------ utils --

function rec_ends_with(string $haystack, string $needle): bool {
  $len = strlen($needle);
  return $len === 0 || ($len <= strlen($haystack) && substr($haystack, -$len) === $needle);
}

function rec_now(): string {
  return gmdate('Y-m-d H:i:s');
}

function rec_host(string $url): string {
  $host = strtolower((string) parse_url($url, PHP_URL_HOST));
  return preg_replace('/^www\./', '', $host);
}

function rec_host_matches(string $host, array $list): bool {
  foreach ($list as $entry) {
    if ($host === $entry || rec_ends_with($host, '.' . $entry)) return true;
  }
  return false;
}

// ---------------------------------------------------------------- storage --

function rec_dir(): string {
  static $dir = null;
  if ($dir !== null) return $dir;

  $custom = env_value('RECORDS_DIR');
  $candidates = $custom !== ''
    ? array($custom)
    : array(dirname(__DIR__, 2) . '/email-data', __DIR__ . '/data');

  foreach ($candidates as $candidate) {
    if (!is_dir($candidate)) @mkdir($candidate, 0750, true);
    if (!is_dir($candidate) || !is_writable($candidate)) continue;

    // A folder inside the web root must never be served.
    $real = (string) realpath($candidate);
    if (strpos($real, (string) realpath(__DIR__)) === 0 && !is_file($real . '/.htaccess')) {
      @file_put_contents($real . '/.htaccess', "Require all denied\nDeny from all\n");
    }
    return $dir = $real;
  }

  throw new RuntimeException('No writable folder for the email records. Set RECORDS_DIR in .env.');
}

function rec_csv_path(): string   { return rec_dir() . '/uae-email-records.csv'; }
function rec_state_path(): string { return rec_dir() . '/scrape-state.json'; }

/** Runs $fn while holding an exclusive lock, so concurrent requests never clobber the file. */
function rec_locked(callable $fn) {
  $handle = fopen(rec_dir() . '/records.lock', 'c');
  if ($handle === false) throw new RuntimeException('Cannot open the records lock file.');
  flock($handle, LOCK_EX);
  try {
    return $fn();
  } finally {
    flock($handle, LOCK_UN);
    fclose($handle);
  }
}

/** @return array<string, array<string, string>> keyed by lower-case email */
function rec_load(): array {
  $path = rec_csv_path();
  if (!is_file($path)) return array();

  $handle = fopen($path, 'r');
  if ($handle === false) return array();

  $records = array();
  $header = null;
  while (($row = fgetcsv($handle, 0, ',', '"', '\\')) !== false) {
    if ($header === null) {
      $row[0] = preg_replace('/^\xEF\xBB\xBF/', '', (string) $row[0]);
      $header = $row;
      continue;
    }
    if (count($row) < 2) continue;
    $record = array();
    foreach (REC_COLUMNS as $i => $column) {
      $index = array_search($column, $header, true);
      $record[$column] = $index === false ? '' : (string) ($row[$index] ?? '');
    }
    $email = strtolower(trim($record['email']));
    if ($email === '') continue;
    $record['email'] = $email;
    $records[$email] = $record;
  }
  fclose($handle);
  return $records;
}

function rec_save(array $records): void {
  $path = rec_csv_path();
  $tmp = $path . '.tmp';
  $handle = fopen($tmp, 'w');
  if ($handle === false) throw new RuntimeException('Cannot write the email records file.');

  fwrite($handle, "\xEF\xBB\xBF"); // BOM so Excel reads UTF-8 correctly
  fputcsv($handle, REC_COLUMNS, ',', '"', '\\');
  foreach ($records as $record) {
    $row = array();
    foreach (REC_COLUMNS as $column) $row[] = isset($record[$column]) ? (string) $record[$column] : '';
    fputcsv($handle, $row, ',', '"', '\\');
  }
  fclose($handle);
  if (!rename($tmp, $path)) throw new RuntimeException('Cannot replace the email records file.');
}

function rec_blank(string $email): array {
  $record = array_fill_keys(REC_COLUMNS, '');
  $record['email'] = strtolower($email);
  $record['domain'] = substr((string) strrchr($record['email'], '@'), 1);
  $record['status'] = 'new';
  $record['send_count'] = '0';
  $record['found_at'] = rec_now();
  return $record;
}

function rec_load_state(): array {
  $path = rec_state_path();
  $state = is_file($path) ? json_decode((string) file_get_contents($path), true) : null;
  if (!is_array($state)) $state = array();
  $state += array('ptr' => 0, 'pages' => array(), 'crawled' => array());
  return $state;
}

function rec_save_state(array $state): void {
  // Keep the crawl memory bounded.
  if (count($state['crawled']) > 20000) {
    arsort($state['crawled']);
    $state['crawled'] = array_slice($state['crawled'], 0, 15000, true);
  }
  file_put_contents(rec_state_path(), json_encode($state, JSON_UNESCAPED_SLASHES), LOCK_EX);
}

function rec_stats(array $records): array {
  $stats = array('total' => count($records), 'new' => 0, 'sent' => 0, 'failed' => 0, 'unsubscribed' => 0, 'invalid' => 0,
                 'types' => array(), 'unsorted' => 0);
  foreach (array_keys(rec_business_types()) as $key) $stats['types'][$key] = array('total' => 0, 'new' => 0);
  foreach ($records as $record) {
    $status = $record['status'];
    if (isset($stats[$status])) $stats[$status]++;
    $type = rec_record_type($record);
    if ($type === '') {
      $stats['unsorted']++;
    } else {
      $stats['types'][$type]['total']++;
      if ($status === 'new') $stats['types'][$type]['new']++;
    }
  }
  return $stats;
}

// ------------------------------------------------------- business types --
//
// Every email is filed under the kind of business whose website it came from,
// so a campaign can go to restaurants only, or schools only.

function rec_business_types(): array {
  static $types = null;
  if ($types !== null) return $types;
  $types = array(
    'restaurant' => array(
      'label' => 'Restaurants & cafés',
      'keywords' => array('restaurants', 'cafes', 'coffee shops', 'bakeries', 'cloud kitchens', 'juice bars', 'sweets shops',
                          'fast food restaurants', 'shawarma restaurants'),
      'rules' => array(array('/\\brestaurants?\\b/u', 1), array('/\\bcaf(?:e|é)s?\\b/u', 1), array('/\\bcoffee\\b/', 0.8),
                       array('/\\bbistro/', 1), array('/\\bgrill\\b/', 0.8), array('/\\beatery\\b/', 1), array('/\\bcuisine\\b/', 0.8),
                       array('/\\bmenu\\b/', 0.6), array('/\\bbaker(?:y|ies)\\b/', 1), array('/\\bpizza/', 1), array('/\\bburgers?\\b/', 1),
                       array('/\\bshawarma/', 1), array('/\\bsweets\\b/', 0.8), array('/\\bjuices?\\b/', 0.6),
                       array('/\\bdin(?:e|ing)\\b/', 0.6), array('/\\bdelivery\\b/', 0.3), array('/\\bfood\\b/', 0.3)),
    ),
    'hotel' => array(
      'label' => 'Hotels',
      'keywords' => array('hotels', 'hotel apartments', 'resorts', 'serviced apartments'),
      'rules' => array(array('/\\bhotels?\\b/', 1), array('/\\bresorts?\\b/', 1), array('/\\bhotel apartments?\\b/', 1.5),
                       array('/\\bsuites?\\b/', 0.5), array('/\\bhostels?\\b/', 1), array('/\\baccommodation/', 0.8),
                       array('/\\bbook (?:your|a) (?:room|stay)\\b/', 1), array('/\\bcheck-?in\\b/', 0.4)),
    ),
    'catering' => array(
      'label' => 'Catering',
      'keywords' => array('catering companies', 'event catering', 'food catering services', 'corporate catering'),
      'rules' => array(array('/\\bcater(?:ing|er|ers)\\b/', 1.6), array('/\\bbanquets?\\b/', 0.8),
                       array('/\\bmeal (?:plans?|boxes)\\b/', 0.8), array('/\\bcanteen/', 0.8), array('/\\bfood services?\\b/', 0.8)),
    ),
    'services' => array(
      'label' => 'Services',
      'keywords' => array('facility management companies', 'cleaning companies', 'maintenance companies', 'logistics companies',
                          'law firms', 'accounting firms', 'digital marketing agencies', 'IT companies', 'real estate companies',
                          'contracting companies', 'recruitment agencies', 'pest control companies', 'car rental companies',
                          'travel agencies', 'business setup consultants', 'event management companies', 'insurance companies'),
      'rules' => array(array('/\\bconsult(?:ing|ancy|ants?)\\b/', 1), array('/\\bmaintenance\\b/', 1), array('/\\bcleaning\\b/', 1),
                       array('/\\bcontracting\\b/', 1), array('/\\blogistics\\b/', 1), array('/\\bfreight\\b/', 1),
                       array('/\\bshipping\\b/', 0.6), array('/\\blaw firm|\\badvocates\\b|\\blegal consult/', 1.2),
                       array('/\\baccounting\\b|\\bauditing\\b|\\bbookkeeping\\b/', 1),
                       array('/\\bmarketing agency|\\bdigital marketing\\b|\\badvertising\\b/', 1),
                       array('/\\bit solutions\\b|\\bsoftware\\b|\\bweb development\\b/', 1), array('/\\breal estate\\b|\\bproperties\\b/', 1),
                       array('/\\bconstruction\\b/', 0.8), array('/\\bengineering\\b/', 0.6), array('/\\binsurance\\b/', 1),
                       array('/\\brecruitment\\b|\\bmanpower\\b/', 1), array('/\\bfacility management\\b/', 1.2),
                       array('/\\bpest control\\b/', 1.2), array('/\\blaundry\\b/', 1), array('/\\bcar rental\\b|\\brent a car\\b/', 1.2),
                       array('/\\btravel\\b|\\btourism\\b/', 0.8), array('/\\bsecurity services\\b/', 1), array('/\\bprinting\\b/', 0.8),
                       array('/\\bbusiness setup\\b/', 1.2), array('/\\bevent management\\b/', 1), array('/\\bservices\\b/', 0.25)),
    ),
    'school' => array(
      'label' => 'Schools & education',
      'keywords' => array('schools', 'nurseries', 'training institutes', 'universities', 'academies', 'kindergartens'),
      'rules' => array(array('/\\bschools?\\b/', 1.2), array('/\\bacadem(?:y|ies)\\b/', 1), array('/\\bnurser(?:y|ies)\\b/', 1),
                       array('/\\bkindergarten/', 1.2), array('/\\buniversity\\b/', 1.2), array('/\\bcollege\\b/', 1),
                       array('/\\binstitute\\b/', 0.8), array('/\\btraining (?:centre|center|institute)/', 1.2),
                       array('/\\bcurriculum\\b/', 1), array('/\\badmissions?\\b/', 1), array('/\\bstudents?\\b/', 0.5),
                       array('/\\beducation(?:al)?\\b/', 0.8)),
    ),
    'other' => array(
      'label' => 'Others',
      'keywords' => array('supermarkets', 'general trading companies', 'hospitals', 'clinics', 'pharmacies', 'furniture stores',
                          'electronics stores', 'jewellery shops', 'perfume shops', 'fashion boutiques', 'car dealers',
                          'auto repair garages', 'beauty salons', 'gyms', 'food trading companies', 'industrial suppliers',
                          'packaging companies', 'food manufacturers'),
      'rules' => array(),
    ),
  );
  return $types;
}

/** Selected types, or null for "every type". */
function rec_clean_types($value): ?array {
  if (!is_array($value)) return null;
  $keys = array_keys(rec_business_types());
  $wanted = array_values(array_intersect($keys, array_map('strval', $value)));
  return $wanted && count($wanted) < count($keys) ? $wanted : null;
}

/** Which kind of business a web page belongs to. */
function rec_classify_page(string $html, string $host): string {
  $pick = function (string $re) use ($html): string {
    return preg_match($re, $html, $m) ? html_entity_decode(strip_tags($m[1]), ENT_QUOTES | ENT_HTML5, 'UTF-8') : '';
  };
  $title = $pick('#<title[^>]*>(.*?)</title>#is');
  $desc = $pick('#<meta[^>]+name=["\']description["\'][^>]+content=["\']([^"\']*)#i') . ' '
        . $pick('#<meta[^>]+property=["\']og:(?:site_name|title|description)["\'][^>]+content=["\']([^"\']*)#i');
  $heads = '';
  if (preg_match_all('#<h[12][^>]*>(.*?)</h[12]>#is', $html, $hm)) {
    $heads = implode(' ', array_map('strip_tags', array_slice($hm[1], 0, 12)));
  }
  $domain = preg_replace('/^www\./', '', strtolower($host));
  $domain = preg_replace('/\.(?:co|com|net|org)?\.?ae$|\.[a-z]+$/', '', $domain);
  $domain = str_replace(array('-', '_', '.'), ' ', $domain);
  $body = mb_substr(rec_page_text($html), 0, 15000);
  $parts = array(array($title, 4), array($desc, 3), array($heads, 2), array($domain, 3), array($body, 1));
  foreach ($parts as $i => $part) $parts[$i][0] = mb_strtolower($part[0]);

  $scores = array();
  foreach (rec_business_types() as $type => $def) {
    $score = 0.0;
    foreach ($def['rules'] as $rule) {
      foreach ($parts as $part) {
        $hits = preg_match_all($rule[0], $part[0]);
        $score += min((int) $hits, $part[1] === 1 ? 5 : 2) * $part[1] * $rule[1];
      }
    }
    $scores[$type] = $score;
  }
  arsort($scores);
  $best = key($scores);
  if ($scores[$best] < 4) return 'other';
  // A caterer's site also talks about food and menus: catering wins when it is prominent.
  if ($best === 'restaurant' && $scores['catering'] >= 4 && $scores['catering'] >= 0.5 * $scores['restaurant']) return 'catering';
  return $best;
}

/** Type of a search keyword ("restaurants" -> restaurant). */
function rec_type_of_keyword(string $keyword): string {
  $k = strtolower(trim($keyword));
  if ($k === '') return '';
  foreach (rec_business_types() as $type => $def) {
    foreach ($def['keywords'] as $w) if (strtolower($w) === $k) return $type;
  }
  foreach (rec_business_types() as $type => $def) {
    foreach ($def['rules'] as $rule) if (preg_match($rule[0], $k)) return $type;
  }
  return 'other';
}

/** A record's business type ('' = not sorted yet). */
function rec_record_type(array $record): string {
  $type = (string) ($record['business_type'] ?? '');
  if ($type !== '' && isset(rec_business_types()[$type])) return $type;
  $category = trim((string) ($record['category'] ?? ''));
  if ($category !== '' && $category !== 'UAE website' && $category !== 'manual') return rec_type_of_keyword($category);
  return '';
}

/** Marks one address after a send attempt, creating the record for hand-pasted addresses. */
function rec_mark(string $email, string $status, string $error = ''): array {
  $email = strtolower(trim($email));
  if (!rec_is_valid_syntax($email)) throw new InvalidArgumentException('Invalid email address.');

  return rec_locked(function () use ($email, $status, $error) {
    $records = rec_load();
    $record = isset($records[$email]) ? $records[$email] : rec_blank($email);
    if ($record['source_url'] === '' && !isset($records[$email])) $record['source_url'] = 'manual';

    if ($status === 'sent') {
      $record['status'] = 'sent';
      $record['send_count'] = (string) ((int) $record['send_count'] + 1);
      $record['last_sent_at'] = rec_now();
      $record['last_error'] = '';
    } elseif ($status === 'failed') {
      if ($record['status'] !== 'unsubscribed') $record['status'] = 'failed';
      $record['last_error'] = substr($error, 0, 300);
    } elseif ($status === 'unsubscribed' || $status === 'invalid' || $status === 'new') {
      $record['status'] = $status;
    } else {
      throw new InvalidArgumentException('Unknown status: ' . $status);
    }

    $records[$email] = $record;
    rec_save($records);
    return $record;
  });
}

// ------------------------------------------------------------- validation --

function rec_is_valid_syntax(string $email): bool {
  if (strlen($email) > 254 || substr_count($email, '@') !== 1) return false;
  if (!filter_var($email, FILTER_VALIDATE_EMAIL)) return false;
  list($local, $domain) = explode('@', $email);
  if (strlen($local) > 64 || strpos($email, '..') !== false) return false;
  return (bool) preg_match('/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,24}$/', $domain);
}

/** Placeholders, image names, tracking ids, disposable and typo domains. */
function rec_is_junk(string $email): bool {
  list($local, $domain) = explode('@', $email);
  $tld = substr((string) strrchr($domain, '.'), 1);

  if (in_array($tld, REC_FILE_EXTENSIONS, true)) return true;
  if (rec_host_matches($domain, REC_JUNK_DOMAINS)) return true;
  if (strpos($domain, 'example') !== false || strpos($domain, 'sentry') !== false) return true;
  if (in_array($local, REC_JUNK_LOCALS, true)) return true;
  if (preg_match('/^[a-f0-9]{20,}$/', $local)) return true;          // hashes / tracking ids
  if (preg_match('/\d+x\d*$|@\dx/', $local)) return true;              // retina image names
  if (preg_match('/^(?:your|my|enter)[._-]?(?:mail|email|name)/', $local)) return true;
  return false;
}

/**
 * True when the address belongs to the UAE market: a .ae domain, or a generic
 * domain (gmail, .com, ...) printed next to a UAE phone number, emirate or city.
 */
function rec_is_uae(string $email, string $text, string $pageHost): bool {
  $domain = substr((string) strrchr($email, '@'), 1);
  if (rec_ends_with($domain, '.ae')) return true;

  $tld = substr((string) strrchr($domain, '.'), 1);
  if (strlen($tld) === 2 && !in_array($tld, REC_GENERIC_CC, true)) return false; // another country

  $position = stripos($text, $email);
  if ($position !== false) {
    $start = max(0, $position - 600);
    $window = substr($text, $start, 1200 + strlen($email));
    return (bool) preg_match(REC_UAE_MARKER, $window);
  }

  // Only found in a mailto link or obfuscated markup: judge the whole page.
  return (rec_ends_with($pageHost, '.ae') || preg_match('/(?:\+|00)\s?971/', $text))
    && (bool) preg_match(REC_UAE_MARKER, $text);
}

/** @return string[] MX hosts, best first; empty when the domain cannot receive mail */
function rec_mx_hosts(string $domain): array {
  static $cache = array();
  if (isset($cache[$domain])) return $cache[$domain];

  $hosts = array();
  $weights = array();
  if (@getmxrr($domain, $hosts, $weights) && $hosts) {
    array_multisort($weights, SORT_ASC, SORT_NUMERIC, $hosts);
    // A "null MX" (RFC 7505) means the domain accepts no mail.
    if (count($hosts) === 1 && ($hosts[0] === '' || $hosts[0] === '.')) $hosts = array();
  } else {
    $hosts = array();
  }
  return $cache[$domain] = $hosts;
}

/**
 * Optional mailbox check over SMTP (SCRAPER_SMTP_CHECK=1). Most shared hosts
 * block outbound port 25; when the connection fails the result is "unknown"
 * and the address is kept, so turning this on never loses good addresses.
 */
function rec_smtp_probe(string $email, array $mxHosts): string {
  $mx = $mxHosts[0] ?? '';
  if ($mx === '') return 'unknown';

  $socket = @fsockopen($mx, 25, $errno, $errstr, 5);
  if (!$socket) return 'unknown';
  stream_set_timeout($socket, 6);

  $read = function () use ($socket): string {
    $data = '';
    while (($line = fgets($socket, 515)) !== false) {
      $data .= $line;
      if (strlen($line) < 4 || $line[3] !== '-') break;
    }
    return $data;
  };
  $say = function (string $command) use ($socket, $read): int {
    fwrite($socket, $command . "\r\n");
    return (int) substr($read(), 0, 3);
  };

  $result = 'unknown';
  $banner = (int) substr($read(), 0, 3);
  $from = env_value('MAIL_FROM_EMAIL', 'marketing@mariotstore.com');
  $heloHost = substr((string) strrchr($from, '@'), 1) ?: 'localhost';

  if ($banner === 220 && $say('EHLO ' . $heloHost) === 250 && $say('MAIL FROM:<' . $from . '>') === 250) {
    $code = $say('RCPT TO:<' . $email . '>');
    if ($code === 250 || $code === 251) $result = 'valid';
    elseif ($code >= 550 && $code <= 553) $result = 'invalid';
  }
  @fwrite($socket, "QUIT\r\n");
  fclose($socket);
  return $result;
}

// ------------------------------------------------------------- extraction --

function rec_page_text(string $html): string {
  $html = preg_replace('#<(script|style|noscript|svg)\b[^>]*>.*?</\1>#is', ' ', $html);
  $html = preg_replace('#<br\s*/?>|</(p|div|li|tr|td|h\d|span|a)>#i', "\n", (string) $html);
  $text = html_entity_decode(strip_tags((string) $html), ENT_QUOTES | ENT_HTML5, 'UTF-8');
  return (string) preg_replace('/[ \t\x{00A0}]+/u', ' ', $text);
}

/** "info [at] company [dot] ae" style obfuscation. */
function rec_deobfuscate(string $text): string {
  return (string) preg_replace(
    array('/\s*[\[\(\{]\s*at\s*[\]\)\}]\s*/i', '/\s*[\[\(\{]\s*dot\s*[\]\)\}]\s*/i'),
    array('@', '.'),
    $text
  );
}

function rec_cf_decode(string $hex): string {
  if (strlen($hex) < 4 || !ctype_xdigit($hex)) return '';
  $key = hexdec(substr($hex, 0, 2));
  $out = '';
  for ($i = 2; $i < strlen($hex); $i += 2) $out .= chr(hexdec(substr($hex, $i, 2)) ^ $key);
  return $out;
}

/** @return string[] lower-case candidate addresses found in the markup or text */
function rec_extract(string $html, string $text): array {
  $found = array();
  $pattern = '/[a-z0-9][a-z0-9._%+\-]{0,63}@[a-z0-9](?:[a-z0-9\-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9\-]{0,61}[a-z0-9])?)*\.[a-z]{2,24}/i';

  // Cloudflare "email protection", very common on UAE business sites.
  if (preg_match_all('/data-cfemail="([0-9a-f]+)"|\/cdn-cgi\/l\/email-protection#([0-9a-f]+)/i', $html, $cf, PREG_SET_ORDER)) {
    foreach ($cf as $match) {
      $decoded = rec_cf_decode($match[1] !== '' ? $match[1] : ($match[2] ?? ''));
      if ($decoded !== '') $found[] = $decoded;
    }
  }

  if (preg_match_all('/mailto:([^"\'?>\s]+)/i', $html, $mailto)) {
    foreach ($mailto[1] as $address) $found[] = rawurldecode($address);
  }

  foreach (array($text, rec_deobfuscate($text), html_entity_decode($html, ENT_QUOTES | ENT_HTML5, 'UTF-8')) as $haystack) {
    if (preg_match_all($pattern, $haystack, $matches)) {
      foreach ($matches[0] as $address) $found[] = $address;
    }
  }

  $clean = array();
  foreach ($found as $address) {
    $address = strtolower(trim($address, " \t\n\r\0\x0B.,;:'\"<>()[]"));
    if ($address !== '') $clean[$address] = true;
  }
  return array_keys($clean);
}

// ---------------------------------------------------------------- network --

function rec_search_provider(): string {
  if (env_value('SERPER_API_KEY') !== '') return 'serper';
  if (env_value('SERPAPI_API_KEY') !== '') return 'serpapi';
  return 'free';
}

// ------------------------------------------------- free search (no API key) --

const REC_FREE_ENGINES = array('bing', 'yahoo', 'duckduckgo');

// Anti-block pacing. Engines block traffic that is fast, regular and heavy, so
// each engine gets a random 25-50 s gap between searches, a daily cap, and a
// growing rest after any captcha/429 (30 min, 1 h, 2 h ... up to 24 h).
const REC_ENGINE_GAP_MIN = 25;
const REC_ENGINE_GAP_MAX = 50;
const REC_ENGINE_DAILY_DEFAULT = 120;     // SCRAPER_DAILY_SEARCHES overrides
const REC_ENGINE_COOLDOWN_SECONDS = 1800; // first rest; doubles per strike
const REC_ENGINE_COOLDOWN_MAX = 86400;
const REC_MAX_WAIT_SECONDS = 120;         // longer than this => report "busy"

// Business directories list many companies per page; when a result is one of
// these (or a page shows several addresses) its company pages are followed.
const REC_DIRECTORY_HOSTS = array(
  'yellowpages-uae.com', 'yellowpages.ae', 'yello.ae', 'uaecontact.com', 'connect.ae',
  'uaeplusplus.com', 'dubaibizdirectory.com', 'uae-business-directory.com', 'emiratesyellowpages.com',
);

// Search engines' own hosts: never treated as results, never crawled.
const REC_ENGINE_HOSTS = array(
  'bing.com', 'bing.net', 'bingj.com', 'microsoft.com', 'msn.com', 'live.com',
  'yahoo.com', 'yahoo.net', 'yimg.com', 'aol.com', 'duckduckgo.com',
  'google.com', 'google.ae', 'googleusercontent.com', 'gstatic.com',
  'w3.org', 'schema.org',
);

function rec_engine_url(string $engine, string $query, int $page): string {
  if ($engine === 'bing') {
    return 'https://www.bing.com/search?' . http_build_query(array(
      'q' => $query, 'first' => ($page - 1) * 10 + 1, 'cc' => 'AE', 'setlang' => 'en',
    ));
  }
  if ($engine === 'yahoo') {
    return 'https://search.yahoo.com/search?' . http_build_query(array('p' => $query, 'b' => ($page - 1) * 10 + 1));
  }
  return 'https://html.duckduckgo.com/html/?' . http_build_query(array(
    'q' => $query, 'kl' => 'ae-en', 's' => ($page - 1) * 30,
  ));
}

/** Unwraps the click-tracking links engines use (Bing /ck/a, Yahoo RU=, DuckDuckGo uddg=, Google /url). */
function rec_unwrap_link(string $href): string {
  $href = html_entity_decode(trim($href), ENT_QUOTES | ENT_HTML5, 'UTF-8');
  if (strpos($href, '//') === 0) $href = 'https:' . $href;

  if (preg_match('#/RU=([^/]+)/R[KS]=#', $href, $m)) return rawurldecode($m[1]);

  $query = array();
  parse_str((string) parse_url($href, PHP_URL_QUERY), $query);
  $host = rec_host($href);
  if (rec_ends_with($host, 'bing.com') && isset($query['u'])) {
    $u = (string) $query['u'];
    if (strpos($u, 'a1') === 0) {
      $decoded = base64_decode(strtr(substr($u, 2), '-_', '+/'), true);
      if ($decoded !== false) return $decoded;
    }
  }
  if (rec_ends_with($host, 'duckduckgo.com') && isset($query['uddg'])) return (string) $query['uddg'];
  if (($host === '' || strpos($host, 'google.') !== false) && isset($query['q']) && strpos((string) $query['q'], 'http') === 0) {
    return (string) $query['q'];
  }
  return $href;
}

/** @return string[] external result links in page order, one per site */
function rec_result_links(string $html): array {
  preg_match_all('/<a\b[^>]*?\bhref\s*=\s*["\']([^"\']+)["\']/i', $html, $matches);
  $links = array();
  foreach ($matches[1] as $href) {
    $url = rec_unwrap_link($href);
    if (!preg_match('#^https?://#i', $url)) continue;
    $host = rec_host($url);
    if ($host === '' || isset($links[$host]) || rec_host_matches($host, REC_ENGINE_HOSTS)) continue;
    $links[$host] = $url;
    if (count($links) >= 12) break;
  }
  return array_values($links);
}

function rec_engine_blocked(int $status, string $html, int $linkCount): bool {
  if (in_array($status, array(202, 403, 429, 503), true)) return true;
  // Only a page without results counts: normal pages can mention "captcha" in scripts.
  return $linkCount === 0 && (bool) preg_match('/captcha|unusual traffic|anomaly-modal|are you a robot|challenge-form|detected unusual/i', $html);
}

/** Keeps the last odd engine reply, so a failing engine can be diagnosed. */
function rec_save_debug_page(string $engine, int $status, string $html): void {
  @file_put_contents(
    rec_dir() . '/last-search-' . $engine . '.html',
    '<!-- HTTP ' . $status . ' at ' . gmdate('c') . " -->\n" . substr($html, 0, 500000)
  );
}

function rec_daily_searches(): int {
  $value = (int) env_value('SCRAPER_DAILY_SEARCHES', (string) REC_ENGINE_DAILY_DEFAULT);
  return max(10, min(1000, $value));
}

/** Seconds until $engine may search again (0 = now). */
function rec_engine_wait(array $info, int $now): int {
  $today = gmdate('Y-m-d', $now);
  $wait = max(0, (int) ($info['next'] ?? 0) - $now, (int) ($info['until'] ?? 0) - $now);
  if (($info['day'] ?? '') === $today && (int) ($info['count'] ?? 0) >= rec_daily_searches()) {
    $wait = max($wait, strtotime('tomorrow', $now) - $now);
  }
  return $wait;
}

/** Records how a search went, so pacing, caps and rests survive between requests. */
function rec_engine_record(string $engine, string $outcome): void {
  rec_locked(function () use ($engine, $outcome) {
    $state = rec_load_state();
    $now = time();
    $today = gmdate('Y-m-d', $now);
    $info = isset($state['engines'][$engine]) && is_array($state['engines'][$engine]) ? $state['engines'][$engine] : array();
    if (($info['day'] ?? '') !== $today) { $info['day'] = $today; $info['count'] = 0; }

    $info['count'] = (int) ($info['count'] ?? 0) + 1;
    $info['last'] = $now;
    $info['next'] = $now + random_int(REC_ENGINE_GAP_MIN, REC_ENGINE_GAP_MAX);

    if ($outcome === 'blocked') {
      $info['strikes'] = (int) ($info['strikes'] ?? 0) + 1;
      $rest = min(REC_ENGINE_COOLDOWN_MAX, REC_ENGINE_COOLDOWN_SECONDS * (2 ** ($info['strikes'] - 1)));
      $info['until'] = $now + $rest;
    } elseif ($outcome === 'ok') {
      $info['strikes'] = 0;
      $info['until'] = 0;
    }
    $state['engines'][$engine] = $info;
    rec_save_state($state);
  });
}

/** Per-engine status for the UI. */
function rec_engine_status(): array {
  $state = rec_load_state();
  $now = time();
  $out = array();
  foreach (REC_FREE_ENGINES as $engine) {
    $info = isset($state['engines'][$engine]) ? $state['engines'][$engine] : array();
    $out[$engine] = array(
      'today'   => ($info['day'] ?? '') === gmdate('Y-m-d', $now) ? (int) ($info['count'] ?? 0) : 0,
      'limit'   => rec_daily_searches(),
      'restingFor' => max(0, (int) ($info['until'] ?? 0) - $now),
      'waitFor' => rec_engine_wait($info, $now),
    );
  }
  return $out;
}

/**
 * Searches without any API key by reading the normal results page of Bing,
 * Yahoo or DuckDuckGo, paced so the engines do not block this server:
 * random gaps, a daily cap and growing rests (see the constants above).
 *
 * @return array{engine?: string, results?: array, wait?: int}
 *   "wait" means every engine is pacing; ask again after that many seconds.
 */
function rec_free_search(string $query, int $page): array {
  $state = rec_locked(function () { return rec_load_state(); });
  $now = time();
  $offset = ((int) ($state['ptr'] ?? 0)) % count(REC_FREE_ENGINES);
  $engines = array_merge(array_slice(REC_FREE_ENGINES, $offset), array_slice(REC_FREE_ENGINES, 0, $offset));

  $ready = array();
  $soonest = PHP_INT_MAX;
  foreach ($engines as $engine) {
    $wait = rec_engine_wait(isset($state['engines'][$engine]) ? $state['engines'][$engine] : array(), $now);
    if ($wait === 0) $ready[] = $engine;
    $soonest = min($soonest, $wait);
  }

  if (!$ready) {
    if ($soonest <= REC_MAX_WAIT_SECONDS) return array('wait' => max(1, $soonest));
    throw new RuntimeException(
      'All search engines are resting to avoid being blocked (next one free in about '
      . (int) ceil($soonest / 60) . ' min). Progress is saved - click Find again later.'
    );
  }

  $tried = array();
  foreach ($ready as $engine) {
    $url = rec_engine_url($engine, $query, $page);
    try {
      $response = rec_http('GET', $url, array(
        'User-Agent: ' . REC_BROWSER_UA,
        'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language: en-US,en;q=0.9',
        'Upgrade-Insecure-Requests: 1',
      ), null);
    } catch (Throwable $err) {
      rec_engine_record($engine, 'error');
      $tried[] = $engine . ' (' . $err->getMessage() . ')';
      continue;
    }

    $links = rec_result_links($response['body']);
    if (rec_engine_blocked($response['status'], $response['body'], count($links))) {
      rec_save_debug_page($engine, $response['status'], $response['body']);
      rec_engine_record($engine, 'blocked');
      $tried[] = $engine . ' (asked for a captcha - resting it)';
      continue;
    }
    rec_engine_record($engine, $links ? 'ok' : 'empty');
    if (!$links) {
      rec_save_debug_page($engine, $response['status'], $response['body']);
      $tried[] = $engine . ' (HTTP ' . $response['status'] . ', no results read from the page)';
      continue;
    }

    $results = array();
    foreach ($links as $link) $results[] = array('link' => $link, 'text' => '');
    // The results page itself: snippets often print the address.
    $results[] = array('link' => $url, 'text' => rec_page_text($response['body']));
    return array('engine' => $engine, 'results' => $results);
  }

  // Every ready engine failed this time; the others may still be pacing.
  // Every ready engine failed this time. If another engine is only pacing,
  // wait for it instead of failing the run.
  $after = rec_locked(function () { return rec_load_state(); });
  $now = time();
  $soonest = PHP_INT_MAX;
  foreach (REC_FREE_ENGINES as $engine) {
    $info = isset($after['engines'][$engine]) ? $after['engines'][$engine] : array();
    if ((int) ($info['until'] ?? 0) > $now) continue; // resting after a captcha
    $soonest = min($soonest, rec_engine_wait($info, $now));
  }
  if ($soonest <= REC_MAX_WAIT_SECONDS) {
    return array('wait' => max(1, $soonest), 'note' => 'Skipped ' . implode(', ', $tried) . ' - trying another engine.');
  }
  throw new RuntimeException('Search failed: ' . implode(', ', $tried) . '.');
}

// ------------------------------------------------------ smarter crawling --

function rec_abs_url(string $href, string $base): string {
  $href = html_entity_decode(trim($href), ENT_QUOTES | ENT_HTML5, 'UTF-8');
  if ($href === '' || $href[0] === '#' || preg_match('/^(mailto|tel|javascript|data|whatsapp):/i', $href)) return '';
  if (preg_match('#^https?://#i', $href)) return $href;
  $parts = parse_url($base);
  if (empty($parts['host'])) return '';
  $scheme = $parts['scheme'] ?? 'https';
  if (strpos($href, '//') === 0) return $scheme . ':' . $href;
  $origin = $scheme . '://' . $parts['host'];
  if ($href[0] === '/') return $origin . $href;
  $dir = isset($parts['path']) ? preg_replace('#/[^/]*$#', '/', $parts['path']) : '/';
  return $origin . $dir . $href;
}

/** @return array<int, array{0: string, 1: string}> [absolute same-site url, link text] */
function rec_internal_links(string $html, string $base): array {
  $host = rec_host($base);
  preg_match_all('#<a\b[^>]*?\bhref\s*=\s*["\']([^"\']+)["\'][^>]*>(.*?)</a>#is', $html, $matches, PREG_SET_ORDER);
  $links = array();
  foreach ($matches as $m) {
    $url = rec_abs_url($m[1], $base);
    if ($url === '' || rec_host($url) !== $host) continue;
    $url = preg_replace('/#.*$/', '', $url);
    if (preg_match('/\.(pdf|jpe?g|png|gif|webp|zip|docx?|xlsx?)(\?|$)/i', $url)) continue;
    $links[$url] = array($url, trim(strip_tags($m[2])));
  }
  return array_values($links);
}

/** The site's real contact/about pages, found from its own menu. */
function rec_contact_links(string $html, string $base, int $max = 2): array {
  $out = array();
  foreach (rec_internal_links($html, $base) as $link) {
    if (preg_match('/contact|about|reach|get-in-touch|enquir|inquir|location|our-office|تواصل|اتصل/iu', $link[0] . ' ' . $link[1])) {
      $out[] = $link[0];
      if (count($out) >= $max) break;
    }
  }
  return $out;
}

/** Company pages inside a business directory. */
function rec_listing_links(string $html, string $base, int $max = 8): array {
  $out = array();
  foreach (rec_internal_links($html, $base) as $link) {
    $path = (string) parse_url($link[0], PHP_URL_PATH);
    if (preg_match('#/(company|companies|listing|listings|business|businesses|profile|detail|details|firm|biz|supplier|store)s?(/|-|$)#i', $path)
        && !preg_match('#/(login|register|signup|add|category|categories|search|page)/?#i', $path)) {
      $out[] = $link[0];
      if (count($out) >= $max) break;
    }
  }
  return $out;
}

/** @return array{engine: string, results: array} */
function rec_search(string $query, int $page): array {
  $serper = env_value('SERPER_API_KEY');
  $serpapi = env_value('SERPAPI_API_KEY');

  if ($serper === '' && $serpapi === '') return rec_free_search($query, $page);

  if ($serper !== '') {
    $response = rec_http('POST', 'https://google.serper.dev/search',
      array('X-API-KEY: ' . $serper, 'Content-Type: application/json'),
      json_encode(array('q' => $query, 'gl' => 'ae', 'hl' => 'en', 'num' => 10, 'page' => $page)));
    $data = json_decode($response['body'], true);
    if ($response['status'] !== 200 || !is_array($data)) {
      throw new RuntimeException('Serper search failed (HTTP ' . $response['status'] . '): ' . substr($response['body'], 0, 200));
    }
    $items = isset($data['organic']) && is_array($data['organic']) ? $data['organic'] : array();
  } elseif ($serpapi !== '') {
    $url = 'https://serpapi.com/search.json?' . http_build_query(array(
      'engine' => 'google', 'q' => $query, 'gl' => 'ae', 'hl' => 'en',
      'google_domain' => 'google.ae', 'num' => 10, 'start' => ($page - 1) * 10, 'api_key' => $serpapi,
    ));
    $response = rec_http('GET', $url, array(), null);
    $data = json_decode($response['body'], true);
    if ($response['status'] !== 200 || !is_array($data)) {
      throw new RuntimeException('SerpAPI search failed (HTTP ' . $response['status'] . '): ' . substr($response['body'], 0, 200));
    }
    $items = isset($data['organic_results']) && is_array($data['organic_results']) ? $data['organic_results'] : array();
  }

  $results = array();
  foreach ($items as $item) {
    $link = isset($item['link']) ? (string) $item['link'] : '';
    if ($link === '') continue;
    $results[] = array(
      'link' => $link,
      'text' => trim((isset($item['title']) ? $item['title'] : '') . "\n" . (isset($item['snippet']) ? $item['snippet'] : '')),
    );
  }
  return array('engine' => $serper !== '' ? 'serper' : 'serpapi', 'results' => $results);
}

function rec_http(string $method, string $url, array $headers, ?string $body, int $timeout = 15): array {
  $handle = curl_init($url);
  curl_setopt_array($handle, array(
    CURLOPT_CUSTOMREQUEST  => $method,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HTTPHEADER     => $headers,
    CURLOPT_TIMEOUT        => $timeout,
    CURLOPT_CONNECTTIMEOUT => 6,
    CURLOPT_FOLLOWLOCATION => true,
    CURLOPT_MAXREDIRS      => 5,
    CURLOPT_ENCODING       => '',
    CURLOPT_COOKIEFILE     => '', // keep cookies across redirects (consent pages)
  ));
  if ($body !== null) curl_setopt($handle, CURLOPT_POSTFIELDS, $body);
  $responseBody = curl_exec($handle);
  $status = (int) curl_getinfo($handle, CURLINFO_RESPONSE_CODE);
  $error = curl_error($handle);
  curl_close($handle);
  if ($responseBody === false) throw new RuntimeException('Request to ' . rec_host($url) . ' failed: ' . $error);
  return array('status' => $status, 'body' => (string) $responseBody);
}

/** Fetches pages in parallel. @return array<string, string> url => html */
function rec_fetch_pages(array $urls, int $timeout = 8): array {
  if (!$urls) return array();
  $multi = curl_multi_init();
  $handles = array();
  $buffers = array();
  $limit = 1500000; // 1.5 MB per page is plenty for contact details

  foreach (array_values(array_unique($urls)) as $i => $url) {
    $buffers[$i] = '';
    $handle = curl_init($url);
    curl_setopt_array($handle, array(
      CURLOPT_FOLLOWLOCATION => true,
      CURLOPT_MAXREDIRS      => 4,
      CURLOPT_TIMEOUT        => $timeout,
      CURLOPT_CONNECTTIMEOUT => 5,
      CURLOPT_ENCODING       => '',
      CURLOPT_SSL_VERIFYPEER => false, // many small business sites have broken certificates
      CURLOPT_USERAGENT      => REC_BROWSER_UA,
      CURLOPT_HTTPHEADER     => array('Accept: text/html,application/xhtml+xml', 'Accept-Language: en-US,en;q=0.8'),
      CURLOPT_WRITEFUNCTION  => function ($ch, $chunk) use (&$buffers, $i, $limit) {
        $buffers[$i] .= $chunk;
        return strlen($buffers[$i]) > $limit ? 0 : strlen($chunk);
      },
    ));
    curl_multi_add_handle($multi, $handle);
    $handles[$i] = array($handle, $url);
  }

  do {
    $status = curl_multi_exec($multi, $running);
    if ($running) curl_multi_select($multi, 1.0);
  } while ($running && $status === CURLM_OK);

  $pages = array();
  foreach ($handles as $i => $pair) {
    list($handle, $url) = $pair;
    $type = (string) curl_getinfo($handle, CURLINFO_CONTENT_TYPE);
    $code = (int) curl_getinfo($handle, CURLINFO_RESPONSE_CODE);
    if ($code >= 200 && $code < 400 && ($type === '' || stripos($type, 'html') !== false || stripos($type, 'text') !== false)) {
      $pages[$url] = $buffers[$i];
    }
    curl_multi_remove_handle($multi, $handle);
    curl_close($handle);
  }
  curl_multi_close($multi);
  return $pages;
}

// ---------------------------------------------------------------- queries --

function rec_queries(array $keywords, array $cities): array {
  $keywords = $keywords ?: REC_DEFAULT_CATEGORIES;
  $cities = $cities ?: REC_UAE_CITIES;
  $queries = array();
  // Cities vary fastest so the first runs already cover every emirate.
  foreach ($keywords as $keyword) {
    foreach ($cities as $city) {
      $queries[] = array(
        'q'        => $keyword . ' ' . $city . ' UAE contact email',
        'category' => $keyword,
        'city'     => $city,
      );
    }
  }
  return $queries;
}

function rec_clean_list($value, int $max): array {
  if (is_string($value)) $value = preg_split('/[\n,;]+/', $value);
  if (!is_array($value)) return array();
  $out = array();
  foreach ($value as $item) {
    $item = trim(preg_replace('/[^\p{L}\p{N} &\'\.\-]/u', '', (string) $item));
    if ($item !== '' && strlen($item) <= 60) $out[strtolower($item)] = $item;
  }
  return array_slice(array_values($out), 0, $max);
}

// ----------------------------------------------------------------- scrape --

/**
 * One scrape step: one Google query (10 results), their pages and contact
 * pages, then validation. Every verified UAE address is saved as "new"; at most
 * $need are returned to fill the recipient box. The caller repeats steps until
 * it has enough. Progress is remembered, so the next run continues with fresh
 * queries and pages instead of repeating old ones.
 */
function rec_scrape_step(array $body): array {
  $started = microtime(true);
  @set_time_limit(90);


  $need = max(1, min(2500, (int) ($body['need'] ?? 50)));
  $types = rec_clean_types($body['types'] ?? null);
  $keywords = rec_clean_list($body['keywords'] ?? array(), 200);
  if (!$keywords && $types) {
    foreach ($types as $type) $keywords = array_merge($keywords, rec_business_types()[$type]['keywords']);
  }
  $cities = rec_clean_list($body['cities'] ?? array(), 20);
  $queries = rec_queries($keywords, $cities);

  // Pick the next query that still has unread result pages.
  $pick = rec_locked(function () use ($queries) {
    $state = rec_load_state();
    $count = count($queries);
    for ($n = 0; $n < $count; $n++) {
      $index = ($state['ptr'] + $n) % $count;
      $q = $queries[$index]['q'];
      $page = (int) ($state['pages'][$q] ?? 0) + 1;
      if ($page <= REC_MAX_PAGES_PER_QUERY) {
        $state['ptr'] = $index + 1;
        $state['pages'][$q] = $page; // reserve it, so a failed page is not retried forever
        rec_save_state($state);
        return array('query' => $queries[$index], 'page' => $page, 'crawled' => $state['crawled']);
      }
    }
    return null;
  });

  if ($pick === null) {
    return array('exhausted' => true, 'emails' => array(), 'added' => 0, 'log' => array(
      'Every query for these keywords and cities has been searched. Add new keywords to find more.',
    ));
  }

  $query = $pick['query'];
  $log = array();
  // Give the page back, so it is searched again next time.
  $release = function () use ($query) {
    rec_locked(function () use ($query) {
      $state = rec_load_state();
      $state['pages'][$query['q']] = max(0, (int) ($state['pages'][$query['q']] ?? 1) - 1);
      $state['ptr'] = max(0, (int) $state['ptr'] - 1);
      rec_save_state($state);
    });
  };
  try {
    $search = rec_search($query['q'], $pick['page']);
  } catch (Throwable $err) {
    $release();
    throw $err;
  }
  if (isset($search['wait'])) {
    $release();
    return array('exhausted' => false, 'wait' => $search['wait'], 'emails' => array(), 'added' => 0,
      'log' => isset($search['note']) ? array($search['note']) : array());
  }
  $results = $search['results'];
  $log[] = 'Searched "' . $query['q'] . '" page ' . $pick['page'] . ' on ' . $search['engine'] . ': ' . count($results) . ' results';

  // candidate email => [context text, page host, source url]
  $candidates = array();
  $consider = function (string $html, string $text, string $url) use (&$candidates) {
    $host = rec_host($url);
    $text = rec_deobfuscate($text);
    foreach (rec_extract($html, $text) as $email) {
      if (isset($candidates[$email])) continue;
      if (!rec_is_valid_syntax($email) || rec_is_junk($email)) continue;
      if (!rec_is_uae($email, $text, $host)) continue;
      $candidates[$email] = $url;
    }
  };

  $fetch = array();
  $now = time();
  foreach ($results as $result) {
    $consider('', $result['text'], $result['link']); // snippets often show the address
    $host = rec_host($result['link']);
    if ($host === '' || rec_host_matches($host, REC_SKIP_HOSTS) || rec_host_matches($host, REC_ENGINE_HOSTS)) continue;
    if (isset($pick['crawled'][$host]) && $now - (int) $pick['crawled'][$host] < REC_RECRAWL_AFTER_SECONDS) continue;
    $fetch[$host] = $result['link'];
  }

  $pages = rec_fetch_pages(array_values($fetch));
  $pageTypes = array();     // host => business type of its home/result page
  foreach ($pages as $url => $html) $pageTypes[rec_host($url)] = rec_classify_page($html, rec_host($url));
  $followUps = array();
  $directoryPages = 0;
  foreach ($pages as $url => $html) {
    $before = count($candidates);
    $consider($html, rec_page_text($html), $url);
    $foundHere = count($candidates) - $before;
    $host = rec_host($url);

    // More emails per search = fewer searches = less chance of a block.
    if (rec_host_matches($host, REC_DIRECTORY_HOSTS) || $foundHere >= 3) {
      $listing = rec_listing_links($html, $url, 8);
      if ($listing) $directoryPages++;
      foreach ($listing as $link) $followUps[] = $link;
    }
    if ($foundHere === 0) {
      $contact = rec_contact_links($html, $url);
      if (!$contact) {
        $origin = (parse_url($url, PHP_URL_SCHEME) ?: 'https') . '://' . parse_url($url, PHP_URL_HOST);
        $contact = array($origin . '/contact-us', $origin . '/contact');
      }
      foreach ($contact as $link) $followUps[] = $link;
    }
  }
  // Results that did not load at all: try their usual contact paths.
  foreach ($fetch as $host => $url) {
    if (isset($pages[$url])) continue;
    $origin = (parse_url($url, PHP_URL_SCHEME) ?: 'https') . '://' . parse_url($url, PHP_URL_HOST);
    $followUps[] = $origin . '/contact-us';
  }

  if ($followUps && microtime(true) - $started < REC_STEP_BUDGET_SECONDS - 10) {
    $followUps = array_slice(array_values(array_unique($followUps)), 0, 24);
    foreach (rec_fetch_pages($followUps, 7) as $url => $html) {
      $consider($html, rec_page_text($html), $url);
    }
    if ($directoryPages) $log[] = 'Followed company pages on ' . $directoryPages . ' business director' . ($directoryPages === 1 ? 'y' : 'ies');
  }

  // Drop addresses already on record, whatever their status.
  $known = rec_locked(function () { return rec_load(); });
  $fresh = array_diff_key($candidates, $known);
  $log[] = count($candidates) . ' UAE addresses found, ' . count($fresh) . ' not yet on record';

  // Verify the domain can receive mail, and optionally the mailbox itself.
  $smtp = env_value('SCRAPER_SMTP_CHECK') === '1';
  $verified = array();
  $rejected = 0;
  foreach ($fresh as $email => $source) {
    $domain = substr((string) strrchr($email, '@'), 1);
    $mx = rec_mx_hosts($domain);
    if (!$mx) { $rejected++; continue; }
    if ($smtp && microtime(true) - $started < REC_STEP_BUDGET_SECONDS && rec_smtp_probe($email, $mx) === 'invalid') {
      $rejected++;
      continue;
    }
    $verified[$email] = $source;
  }
  if ($rejected) $log[] = $rejected . ' rejected: domain has no working mail server' . ($smtp ? ' or mailbox does not exist' : '');

  $typeOf = array();
  $added = rec_locked(function () use ($verified, $query, $fetch, $pageTypes, &$typeOf) {
    $records = rec_load();
    $added = array();
    foreach ($verified as $email => $source) {
      if (isset($records[$email])) continue;
      $record = rec_blank($email);
      $record['city'] = $query['city'];
      $record['category'] = $query['category'];
      $record['source_url'] = $source;
      // A directory page lists many kinds of business: trust the search keyword there.
      $host = rec_host($source);
      $siteType = $pageTypes[$host] ?? '';
      $record['business_type'] = ($siteType !== '' && $siteType !== 'other' && !rec_host_matches($host, REC_DIRECTORY_HOSTS))
        ? $siteType : rec_type_of_keyword($query['category']);
      $records[$email] = $record;
      $added[] = $email;
      $typeOf[$email] = $record['business_type'];
    }
    if ($added) rec_save($records);

    $state = rec_load_state();
    $stamp = time();
    foreach (array_keys($fetch) as $host) $state['crawled'][$host] = $stamp;
    rec_save_state($state);
    return $added;
  });

  $log[] = count($added) . ' verified new UAE emails saved to records';
  $wanted = $types ? array_values(array_filter($added, function ($e) use ($types, $typeOf) {
    return in_array($typeOf[$e] ?? '', $types, true);
  })) : $added;
  if ($types && count($wanted) < count($added)) {
    $log[] = (count($added) - count($wanted)) . ' of them are other kinds of business - kept in records for later';
  }

  return array(
    'exhausted' => false,
    'query'     => $query['q'],
    'page'      => $pick['page'],
    'added'     => count($wanted),
    'emails'    => array_slice($wanted, 0, $need),
    'log'       => $log,
  );
}

// ------------------------------------------------------------ recipients --

/** Picks recipients from the records. mode: new | old | random */
function rec_pick(string $mode, int $count, array $exclude, ?array $types = null): array {
  $records = rec_load();
  $skip = array();
  foreach ($exclude as $email) $skip[strtolower(trim((string) $email))] = true;

  $pool = array();
  foreach ($records as $email => $record) {
    if (isset($skip[$email])) continue;
    if ($types && !in_array(rec_record_type($record), $types, true)) continue;
    $status = $record['status'];
    if ($mode === 'new' && $status === 'new') $pool[] = $record;
    elseif ($mode === 'old' && $status === 'sent') $pool[] = $record;
    elseif ($mode === 'random' && ($status === 'new' || $status === 'sent')) $pool[] = $record;
  }

  if ($mode === 'random') {
    shuffle($pool);
  } elseif ($mode === 'old') {
    usort($pool, function ($a, $b) { return strcmp($a['last_sent_at'], $b['last_sent_at']); });
  } else {
    usort($pool, function ($a, $b) { return strcmp($a['found_at'], $b['found_at']); });
  }

  return array_map(function ($record) { return $record['email']; }, array_slice($pool, 0, max(0, $count)));
}

/**
 * Removes addresses that must not be emailed: unsubscribed and invalid always,
 * and in "new" mode also everyone who was already emailed.
 */
function rec_filter(string $mode, array $emails): array {
  $records = rec_load();
  $allowed = array();
  $skipped = array();
  foreach ($emails as $email) {
    $key = strtolower(trim((string) $email));
    if ($key === '') continue;
    $status = isset($records[$key]) ? $records[$key]['status'] : '';
    if (in_array($status, REC_BLOCKED_STATUSES, true)) {
      $skipped[] = array('email' => $key, 'reason' => $status);
    } elseif ($mode === 'new' && ($status === 'sent' || $status === 'failed')) {
      $skipped[] = array('email' => $key, 'reason' => 'already ' . $status . ' before');
    } else {
      $allowed[] = (string) $email;
    }
  }
  return array('allowed' => $allowed, 'skipped' => $skipped);
}


// =========================================================================
// Website-list mode: no search engines, so no waiting, rests or captchas.
//
// UAE business websites (.ae domains) are taken from public "top 1 million
// websites" research lists (Tranco and Cisco Umbrella), downloaded once and
// refreshed monthly. Each step then visits the next batch of websites
// directly - their home and contact pages - many at a time.
// =========================================================================

const REC_SITE_SOURCES = array(
  'tranco'   => 'https://tranco-list.eu/top-1m.csv.zip',
  'umbrella' => 'https://s3-us-west-1.amazonaws.com/umbrella-static/top-1m.csv.zip',
);
const REC_SITE_BATCH = 40;                 // websites visited per step, in parallel
const REC_SITE_LIST_MAX_AGE = 2592000;     // rebuild the list after 30 days
const REC_AE_SECOND_LEVEL = array('co', 'com', 'net', 'org', 'gov', 'ac', 'sch', 'mil', 'pro', 'name');
const REC_AE_EXCLUDED = array('gov', 'mil'); // no government or military addresses

/** Website-list sources; SCRAPER_SITE_LISTS="name=url,name=url" replaces them. */
function rec_site_sources(): array {
  $custom = env_value('SCRAPER_SITE_LISTS');
  if ($custom === '') return REC_SITE_SOURCES;
  $out = array();
  foreach (explode(',', $custom) as $pair) {
    $parts = explode('=', trim($pair), 2);
    if (count($parts) === 2 && preg_match('#^https?://#', $parts[1])) $out[trim($parts[0])] = trim($parts[1]);
  }
  return $out ?: REC_SITE_SOURCES;
}

function rec_sites_path(): string { return rec_dir() . '/uae-websites.json'; }

function rec_load_sites(): array {
  $path = rec_sites_path();
  $data = is_file($path) ? json_decode((string) file_get_contents($path), true) : null;
  if (!is_array($data)) $data = array();
  return $data + array('built_at' => 0, 'pending' => array(), 'domains' => array(), 'list' => array(), 'cursor' => 0, 'failed' => array());
}

function rec_save_sites(array $sites): void {
  file_put_contents(rec_sites_path(), json_encode($sites, JSON_UNESCAPED_SLASHES), LOCK_EX);
}

/** "mail.shop.co.ae" -> "shop.co.ae"; null for non-.ae or excluded hosts. */
function rec_ae_domain(string $host): ?string {
  $host = strtolower(trim($host, " .\t\r\n"));
  if (!preg_match('/^[a-z0-9.-]+\.ae$/', $host)) return null;
  $labels = explode('.', $host);
  $n = count($labels);
  if ($n >= 3 && in_array($labels[$n - 2], REC_AE_SECOND_LEVEL, true)) {
    if (in_array($labels[$n - 2], REC_AE_EXCLUDED, true)) return null;
    return implode('.', array_slice($labels, -3));
  }
  return $n >= 2 ? implode('.', array_slice($labels, -2)) : null;
}

/** Extracts the first file of a zip archive (no ZipArchive extension needed). */
function rec_unzip_first(string $zip): string {
  $eocd = strrpos($zip, "PK\x05\x06");
  if ($eocd === false) throw new RuntimeException('not a zip file');
  $cdOffset = unpack('V', substr($zip, $eocd + 16, 4))[1];
  if (substr($zip, $cdOffset, 4) !== "PK\x01\x02") throw new RuntimeException('broken zip directory');
  $method = unpack('v', substr($zip, $cdOffset + 10, 2))[1];
  $size = unpack('V', substr($zip, $cdOffset + 20, 4))[1];
  $local = unpack('V', substr($zip, $cdOffset + 42, 4))[1];
  $nameLen = unpack('v', substr($zip, $local + 26, 2))[1];
  $extraLen = unpack('v', substr($zip, $local + 28, 2))[1];
  $data = substr($zip, $local + 30 + $nameLen + $extraLen, $size);
  if ($method === 0) return $data;
  if ($method === 8) {
    $out = @gzinflate($data);
    if ($out === false) throw new RuntimeException('could not unpack the zip');
    return $out;
  }
  throw new RuntimeException('unsupported zip compression');
}

/** Status of the website list, for the UI. */
function rec_sites_status(): array {
  $sites = rec_load_sites();
  $total = count($sites['list']);
  return array(
    'ready'   => rec_sites_ready($sites),
    'total'   => $total,
    'left'    => max(0, $total - (int) $sites['cursor']),
    'builtAt' => $sites['built_at'] ? gmdate('Y-m-d', (int) $sites['built_at']) : null,
  );
}

function rec_sites_ready(array $sites): bool {
  return $sites['built_at'] && time() - (int) $sites['built_at'] < REC_SITE_LIST_MAX_AGE && !$sites['pending'];
}

/**
 * Builds the website list one source per call (each is a ~10 MB download), so
 * no single request runs long. Returns { ready, log }.
 */
function rec_prepare_sites(): array {
  @set_time_limit(180);
  $sites = rec_locked(function () { return rec_load_sites(); });
  if (rec_sites_ready($sites)) return array('ready' => true, 'log' => array());

  // Starting a (re)build: queue every source; keep the domains already known.
  if (!$sites['pending']) {
    $sites['pending'] = array_keys(rec_site_sources());
    $sites['failed'] = array();
  }

  $source = array_shift($sites['pending']);
  $log = array();
  try {
    $sources = rec_site_sources();
    if (!isset($sources[$source])) throw new RuntimeException('unknown source');
    $response = rec_http('GET', $sources[$source], array('User-Agent: ' . REC_BROWSER_UA), null, 150);
    if ($response['status'] !== 200) throw new RuntimeException('HTTP ' . $response['status']);
    $csv = rec_unzip_first($response['body']);
    unset($response);

    $found = 0;
    foreach (preg_split('/\r?\n/', $csv) as $line) {
      if (strpos($line, '.ae') === false) continue;
      $parts = explode(',', $line);
      if (count($parts) < 2) continue;
      $domain = rec_ae_domain($parts[1]);
      if ($domain === null) continue;
      $rank = (int) $parts[0];
      if (!isset($sites['domains'][$domain]) || $rank < $sites['domains'][$domain]) {
        if (!isset($sites['domains'][$domain])) $found++;
        $sites['domains'][$domain] = $rank;
      }
    }
    $log[] = 'Downloaded the ' . $source . ' website list: ' . $found . ' new UAE (.ae) websites';
  } catch (Throwable $err) {
    $sites['failed'][] = $source;
    $log[] = 'Could not download the ' . $source . ' list (' . $err->getMessage() . ')';
  }

  if (!$sites['pending']) {
    if (!$sites['domains']) {
      rec_locked(function () use ($sites) { $sites['pending'] = array(); rec_save_sites($sites); });
      throw new RuntimeException('Could not download any UAE website list. Check the internet connection and try again.');
    }
    // Final list: most visited websites first, minus those already visited.
    $state = rec_load_state();
    asort($sites['domains']);
    $old = array_flip($sites['list']);
    $done = array_slice($sites['list'], 0, (int) $sites['cursor']);
    $doneSet = array_flip($done);
    $list = $done;
    foreach (array_keys($sites['domains']) as $domain) {
      if (isset($doneSet[$domain])) continue;
      if (isset($state['crawled'][$domain]) || isset($state['crawled']['www.' . $domain])) continue;
      $list[] = $domain;
    }
    $sites['list'] = $list;
    $sites['built_at'] = time();
    $log[] = 'UAE website list ready: ' . (count($list) - count($done)) . ' websites to visit';
    unset($old);
  }

  rec_locked(function () use ($sites) { rec_save_sites($sites); });
  return array('ready' => rec_sites_ready($sites), 'log' => $log);
}

/** .ae websites a page links to (other than itself). */
function rec_discover_ae_sites(string $html, string $pageHost): array {
  $own = rec_ae_domain($pageHost);
  $out = array();
  if (preg_match_all('#https?://([a-z0-9.-]+\.ae)(?=[/:"\'?\s#]|$)#i', $html, $m)) {
    foreach ($m[1] as $host) {
      $domain = rec_ae_domain($host);
      if ($domain !== null && $domain !== $own) $out[$domain] = true;
      if (count($out) >= 40) break;
    }
  }
  return array_keys($out);
}

/** Appends never-seen domains to the website list. @return int how many were added */
function rec_add_sites(array $domains): int {
  if (!$domains) return 0;
  return rec_locked(function () use ($domains) {
    $sites = rec_load_sites();
    $state = rec_load_state();
    $added = 0;
    foreach ($domains as $domain) {
      if (isset($sites['domains'][$domain]) || isset($state['crawled'][$domain]) || isset($state['crawled']['www.' . $domain])) continue;
      $sites['domains'][$domain] = 900000000 + $added; // after the ranked sites
      $sites['list'][] = $domain;
      $added++;
    }
    if ($added) rec_save_sites($sites);
    return $added;
  });
}

function rec_detect_city(string $text): string {
  foreach (REC_UAE_CITIES as $city) {
    if (stripos($text, $city) !== false) return $city;
  }
  return '';
}

/**
 * One website-list step: visits the next REC_SITE_BATCH websites and their
 * contact pages in parallel. No search engine is involved.
 */
function rec_crawl_step(array $body): array {
  $started = microtime(true);
  @set_time_limit(90);
  $need = max(1, min(2500, (int) ($body['need'] ?? 50)));
  $types = rec_clean_types($body['types'] ?? null);

  $batch = rec_locked(function () {
    $sites = rec_load_sites();
    if (!rec_sites_ready($sites)) return null;
    $cursor = (int) $sites['cursor'];
    $batch = array_slice($sites['list'], $cursor, REC_SITE_BATCH);
    $sites['cursor'] = $cursor + count($batch);
    rec_save_sites($sites);
    return array('domains' => $batch, 'left' => count($sites['list']) - $sites['cursor']);
  });

  if ($batch === null) return array('needsPrepare' => true, 'emails' => array(), 'added' => 0, 'log' => array());
  if (!$batch['domains']) {
    // Every listed website was visited: look at visited websites again only
    // for links to UAE websites not seen yet, which refills the list.
    $again = rec_locked(function () {
      $sites = rec_load_sites();
      $from = (int) ($sites['discover_cursor'] ?? 0);
      $domains = array_slice($sites['list'], $from, REC_SITE_BATCH);
      $sites['discover_cursor'] = $from + count($domains);
      rec_save_sites($sites);
      return $domains;
    });
    if ($again) {
      $found = array();
      $urls = array_map(function ($d) { return 'https://' . $d . '/'; }, $again);
      foreach (rec_fetch_pages($urls, 8) as $url => $html) {
        foreach (rec_discover_ae_sites($html, rec_host($url)) as $domain) $found[$domain] = true;
      }
      $grown = rec_add_sites(array_keys($found));
      return array('exhausted' => false, 'emails' => array(), 'added' => 0, 'log' => array(
        'All listed websites visited - checked ' . count($again) . ' of them for links to more UAE websites: ' . $grown . ' new websites added',
      ));
    }
    return array('exhausted' => true, 'emails' => array(), 'added' => 0, 'log' => array(
      'Every website in the UAE list has been visited. The list refreshes monthly; meanwhile use "Search engines" mode.',
    ));
  }

  $candidates = array(); // email => [source url, city, business type]
  $discovered = array(); // new .ae websites linked from the pages visited
  $siteTypes = array();  // site => business type, from its home page
  $consider = function (string $html, string $url) use (&$candidates, &$discovered, &$siteTypes) {
    $host = rec_host($url);
    $site = rec_ae_domain($host) ?? $host;
    if (!isset($siteTypes[$site])) $siteTypes[$site] = rec_classify_page($html, $host);
    foreach (rec_discover_ae_sites($html, $host) as $domain) $discovered[$domain] = true;
    $text = rec_deobfuscate(rec_page_text($html));
    $city = rec_detect_city($text);
    foreach (rec_extract($html, $text) as $email) {
      if (isset($candidates[$email]) || !rec_is_valid_syntax($email) || rec_is_junk($email)) continue;
      // On a .ae website every address belongs to the UAE business, unless it
      // is on another country's domain.
      $tld = substr((string) strrchr($email, '.'), 1);
      $uae = rec_ends_with($host, '.ae')
        ? (strlen($tld) !== 2 || in_array($tld, REC_GENERIC_CC, true))
        : rec_is_uae($email, $text, $host);
      if ($uae) $candidates[$email] = array($url, $city, $siteTypes[$site]);
    }
  };

  $urls = array();
  foreach ($batch['domains'] as $domain) $urls[] = 'https://' . $domain . '/';
  $pages = rec_fetch_pages($urls, 8);

  $followUps = array();
  foreach ($pages as $url => $html) {
    $before = count($candidates);
    $consider($html, $url);
    if (count($candidates) === $before) {
      $contact = rec_contact_links($html, $url);
      if (!$contact) $contact = array(rtrim($url, '/') . '/contact-us', rtrim($url, '/') . '/contact');
      foreach ($contact as $link) $followUps[] = $link;
    }
  }
  // Websites that did not answer over https: try plain http with www.
  foreach ($urls as $url) {
    if (!isset($pages[$url])) $followUps[] = 'http://www.' . rec_host($url) . '/';
  }

  if ($followUps && microtime(true) - $started < REC_STEP_BUDGET_SECONDS - 9) {
    foreach (rec_fetch_pages(array_slice(array_values(array_unique($followUps)), 0, 90), 7) as $url => $html) {
      $consider($html, $url);
    }
  }

  $log = array('Visited ' . count($batch['domains']) . ' UAE websites (' . count($pages) . ' answered, ' . $batch['left'] . ' left in the list)');
  // Websites the visited pages link to, and .ae email domains, join the list,
  // so it keeps growing and every run reaches websites never visited before.
  foreach (array_keys($candidates) as $email) {
    $domain = rec_ae_domain(substr((string) strrchr($email, '@'), 1));
    if ($domain !== null) $discovered[$domain] = true;
  }
  $grown = rec_add_sites(array_keys($discovered));
  if ($grown) $log[] = $grown . ' new UAE websites discovered and added to the list';

  $added = rec_verify_and_save($candidates, 'UAE website', $batch['domains'], $started, $log);
  $wanted = $types ? array_values(array_filter($added, function ($e) use ($types, $candidates) {
    return in_array($candidates[$e][2], $types, true);
  })) : $added;
  if ($types && $added) {
    $counts = array();
    foreach ($added as $e) $counts[$candidates[$e][2]] = ($counts[$candidates[$e][2]] ?? 0) + 1;
    $parts = array();
    foreach ($counts as $t => $n) $parts[] = $n . ' ' . strtolower(rec_business_types()[$t]['label']);
    $log[] = 'By type: ' . implode(', ', $parts) . ' - ' . count($wanted) . ' match your selection, the rest are kept in records';
  }

  return array(
    'exhausted' => false,
    'added'     => count($wanted),
    'emails'    => array_slice($wanted, 0, $need),
    'log'       => $log,
  );
}

/** Drops known addresses, checks mail servers, saves the rest as "new". */
function rec_verify_and_save(array $candidates, string $category, array $hosts, float $started, array &$log): array {
  $known = rec_locked(function () { return rec_load(); });
  $fresh = array_diff_key($candidates, $known);
  $log[] = count($candidates) . ' UAE addresses found, ' . count($fresh) . ' not yet on record';

  $smtp = env_value('SCRAPER_SMTP_CHECK') === '1';
  $verified = array();
  $rejected = 0;
  foreach ($fresh as $email => $meta) {
    $mx = rec_mx_hosts(substr((string) strrchr($email, '@'), 1));
    if (!$mx) { $rejected++; continue; }
    if ($smtp && microtime(true) - $started < REC_STEP_BUDGET_SECONDS && rec_smtp_probe($email, $mx) === 'invalid') {
      $rejected++;
      continue;
    }
    $verified[$email] = $meta;
  }
  if ($rejected) $log[] = $rejected . ' rejected: no working mail server' . ($smtp ? ' or mailbox does not exist' : '');

  $added = rec_locked(function () use ($verified, $category, $hosts) {
    $records = rec_load();
    $added = array();
    foreach ($verified as $email => $meta) {
      if (isset($records[$email])) continue;
      $record = rec_blank($email);
      $record['city'] = $meta[1];
      $record['category'] = $category;
      $record['source_url'] = $meta[0];
      $record['business_type'] = (string) ($meta[2] ?? '');
      $records[$email] = $record;
      $added[] = $email;
    }
    if ($added) rec_save($records);
    $state = rec_load_state();
    foreach ($hosts as $host) $state['crawled'][$host] = time();
    rec_save_state($state);
    return $added;
  });
  $log[] = count($added) . ' verified new UAE emails saved to records';
  return $added;
}


/**
 * Sorts emails saved before business types existed: visits the websites they
 * came from (40 at a time) and files every email from that site under its type.
 */
function rec_classify_step(): array {
  @set_time_limit(90);
  $records = rec_locked(function () { return rec_load(); });
  $bySite = array();
  foreach ($records as $email => $record) {
    if (rec_record_type($record) !== '') continue;
    $source = preg_match('#^https?:#', $record['source_url']) ? $record['source_url'] : 'https://' . $record['domain'] . '/';
    $site = rec_host($source);
    if ($site === '') continue;
    $bySite[$site][] = $email;
  }
  $sites = array_slice(array_keys($bySite), 0, REC_SITE_BATCH);
  if (!$sites) return array('done' => true, 'sorted' => 0, 'left' => 0, 'log' => array('Every saved email is sorted by business type.'));
  $urls = array_map(function ($s) { return 'https://' . $s . '/'; }, $sites);
  $types = array();
  foreach (rec_fetch_pages($urls, 8) as $url => $html) $types[rec_host($url)] = rec_classify_page($html, rec_host($url));
  $sorted = rec_locked(function () use ($sites, $bySite, $types) {
    $fresh = rec_load();
    $sorted = 0;
    foreach ($sites as $site) {
      $type = $types[$site] ?? 'other';     // a site that no longer answers is filed under Others
      foreach ($bySite[$site] as $email) {
        if (isset($fresh[$email]) && rec_record_type($fresh[$email]) === '') {
          $fresh[$email]['business_type'] = $type;
          $sorted++;
        }
      }
    }
    rec_save($fresh);
    return $sorted;
  });
  $left = count($bySite) - count($sites);
  return array('done' => $left === 0, 'sorted' => $sorted, 'left' => $left,
               'log' => array('Sorted ' . $sorted . ' saved emails from ' . count($sites) . ' websites (' . $left . ' websites left)'));
}

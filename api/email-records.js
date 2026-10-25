/**
 * /api/email-records - UAE email scraper and email record store.
 *
 * Node twin of public/api/email-records.php (used by `npm run dev` and Vercel);
 * both take the same requests and keep the same CSV, so behaviour matches.
 *
 *   GET  ?action=stats                             counts per status
 *   GET  ?action=export                            download all records as CSV (Excel)
 *   POST { action: "scrape", need, keywords }      one scrape step
 *   POST { action: "load", mode, count, exclude }  recipients from the records
 *   POST { action: "filter", mode, emails }        drop unsubscribed / already emailed
 *   POST { action: "mark", email, status, error }  record a send result
 *
 * No keys are required. Optional env: SCRAPER_DAILY_SEARCHES (per engine,
 * default 120), SERPER_API_KEY / SERPAPI_API_KEY, RECORDS_DIR,
 * SCRAPER_SMTP_CHECK=1, TOOL_API_KEY.
 *
 * Vercel's filesystem is not persistent, so on Vercel the records only live
 * until the function instance is recycled. Use the PHP hosting (or local dev)
 * for a lasting list.
 */
const fs = require("fs");
const path = require("path");
const dns = require("dns").promises;
const net = require("net");
const http = require("http");
const https = require("https");
const zlib = require("zlib");
const crypto = require("crypto");

const COLUMNS = [
  "email", "status", "domain", "city", "category", "source_url",
  "found_at", "last_sent_at", "send_count", "last_error", "business_type",
];
const BLOCKED_STATUSES = ["unsubscribed", "invalid"];
const MAX_PAGES_PER_QUERY = 5;
const RECRAWL_AFTER_MS = 30 * 24 * 60 * 60 * 1000;
const STEP_BUDGET_MS = 24000;

const UAE_CITIES = [
  "Dubai", "Abu Dhabi", "Sharjah", "Ajman", "Al Ain",
  "Ras Al Khaimah", "Fujairah", "Umm Al Quwain",
];

const DEFAULT_CATEGORIES = [
  "restaurants", "cafes", "hotels", "catering companies", "bakeries",
  "cloud kitchens", "coffee shops", "supermarkets", "food trading companies",
  "hotel apartments", "resorts", "juice bars", "sweets shops", "butcher shops",
  "hospitals", "clinics", "dental clinics", "pharmacies", "schools",
  "nurseries", "training institutes", "universities", "real estate companies",
  "construction companies", "contracting companies", "interior design companies",
  "fit out companies", "facility management companies", "general trading companies",
  "logistics companies", "freight forwarders", "travel agencies", "car rental companies",
  "car dealers", "auto repair garages", "beauty salons", "spas", "gyms",
  "IT companies", "software companies", "digital marketing agencies",
  "advertising agencies", "event management companies", "law firms",
  "accounting firms", "audit firms", "business setup consultants",
  "insurance companies", "recruitment agencies", "manpower supply companies",
  "cleaning companies", "pest control companies", "laundry services",
  "printing companies", "furniture stores", "electronics stores",
  "jewellery shops", "perfume shops", "fashion boutiques", "security services",
  "AC maintenance companies", "electrical contractors", "steel fabrication companies",
  "packaging companies", "food manufacturers", "industrial suppliers",
];

const SKIP_HOSTS = [
  "facebook.com", "instagram.com", "linkedin.com", "twitter.com", "x.com",
  "youtube.com", "tiktok.com", "pinterest.com", "wikipedia.org", "google.com",
  "tripadvisor.com", "booking.com", "amazon.ae", "amazon.com", "noon.com",
  "talabat.com", "deliveroo.ae", "careem.com", "reddit.com", "quora.com",
];

const JUNK_DOMAINS = [
  "example.com", "example.org", "example.net", "domain.com", "email.com",
  "yourdomain.com", "yoursite.com", "yourcompany.com", "company.com", "mysite.com",
  "website.com", "test.com", "sentry.io", "wixpress.com", "sentry.wixpress.com",
  "sentry-next.wixpress.com", "w3.org", "schema.org", "placeholder.com",
  "godaddy.com", "gmail.co", "gmial.com", "gamil.com", "gmai.com", "hotmial.com",
  "yaho.com", "mailinator.com", "guerrillamail.com", "10minutemail.com",
  "tempmail.com", "temp-mail.org", "yopmail.com", "trashmail.com",
  "sharklasers.com", "getnada.com", "dispostable.com", "maildrop.cc",
  "throwawaymail.com", "fakeinbox.com",
];

const JUNK_LOCALS = new Set([
  "noreply", "no-reply", "no_reply", "donotreply", "do-not-reply", "mailer-daemon",
  "postmaster", "abuse", "hostmaster", "example", "test", "user", "username",
  "name", "email", "youremail", "your.email", "yourname", "your-email", "john.doe",
  "johndoe", "jane.doe", "firstname.lastname", "firstname", "someone", "xxx", "xyz", "abc", "demo", "sample",
]);

const FILE_EXTENSIONS = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "svg", "css", "js", "ico", "bmp", "tif",
  "tiff", "mp4", "pdf", "avif", "woff", "woff2", "ttf", "eot", "json", "xml",
  "php", "html", "htm", "asp", "aspx", "zip",
]);

const GENERIC_CC = new Set(["ae", "co", "io", "me", "tv", "ai", "cc", "ws", "fm"]);

const UAE_MARKER = /(?:\+|00)\s?971|\bU\.?A\.?E\.?\b|United Arab Emirates|Emirates\b|Dubai|Abu\s?Dhabi|Sharjah|Ajman|Al\s?Ain|Ras\s?Al\s?Khaimah|\bRAK\b|Fujairah|Umm\s?Al\s?Quwain|Jebel\s?Ali|Musaffah|Mussafah|Deira|Bur\s?Dubai/i;

const EMAIL_PATTERN = /[a-z0-9][a-z0-9._%+-]{0,63}@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*\.[a-z]{2,24}/gi;

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

// ------------------------------------------------------------------ utils --

const env = (key, fallback = "") => String(process.env[key] || "").trim() || fallback;
const now = () => new Date().toISOString().slice(0, 19).replace("T", " ");

function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

const hostMatches = (host, list) => list.some((entry) => host === entry || host.endsWith("." + entry));

// ---------------------------------------------------------------- storage --

let resolvedDir = null;
function recordsDir() {
  if (resolvedDir) return resolvedDir;
  const candidates = env("RECORDS_DIR")
    ? [env("RECORDS_DIR")]
    : [process.env.VERCEL ? "/tmp/email-data" : path.resolve(__dirname, "..", "email-data")];
  for (const dir of candidates) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.accessSync(dir, fs.constants.W_OK);
      return (resolvedDir = dir);
    } catch {
      // try the next folder
    }
  }
  throw new Error("No writable folder for the email records. Set RECORDS_DIR.");
}

const csvPath = () => path.join(recordsDir(), "uae-email-records.csv");
const statePath = () => path.join(recordsDir(), "scrape-state.json");

// One Node process serves the local dev runner, so a promise chain is enough
// to serialise read-modify-write cycles.
let lockChain = Promise.resolve();
function locked(fn) {
  const run = lockChain.then(fn, fn);
  lockChain = run.catch(() => {});
  return run;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += ch;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const csvCell = (value) => {
  const s = String(value == null ? "" : value);
  return /[",\r\n\s]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

function loadRecords() {
  let text;
  try {
    text = fs.readFileSync(csvPath(), "utf8").replace(/^﻿/, "");
  } catch {
    return new Map();
  }
  const rows = parseCsv(text);
  const header = rows.shift() || [];
  const records = new Map();
  for (const row of rows) {
    if (row.length < 2) continue;
    const record = {};
    for (const column of COLUMNS) {
      const index = header.indexOf(column);
      record[column] = index === -1 ? "" : String(row[index] || "");
    }
    record.email = record.email.trim().toLowerCase();
    if (record.email) records.set(record.email, record);
  }
  return records;
}

function saveRecords(records) {
  const lines = [COLUMNS.join(",")];
  for (const record of records.values()) lines.push(COLUMNS.map((c) => csvCell(record[c])).join(","));
  const tmp = csvPath() + ".tmp";
  fs.writeFileSync(tmp, "﻿" + lines.join("\n") + "\n", "utf8");
  fs.renameSync(tmp, csvPath());
}

function blankRecord(email) {
  const lower = email.toLowerCase();
  return {
    email: lower, status: "new", domain: lower.split("@")[1] || "", city: "", category: "",
    source_url: "", found_at: now(), last_sent_at: "", send_count: "0", last_error: "", business_type: "",
  };
}

function loadState() {
  let state = {};
  try {
    state = JSON.parse(fs.readFileSync(statePath(), "utf8")) || {};
  } catch {
    state = {};
  }
  return { ptr: 0, pages: {}, crawled: {}, ...state };
}

function saveState(state) {
  const crawled = Object.entries(state.crawled || {});
  if (crawled.length > 20000) {
    crawled.sort((a, b) => b[1] - a[1]);
    state.crawled = Object.fromEntries(crawled.slice(0, 15000));
  }
  fs.writeFileSync(statePath(), JSON.stringify(state));
}

function stats(records) {
  const out = { total: records.size, new: 0, sent: 0, failed: 0, unsubscribed: 0, invalid: 0, types: {}, unsorted: 0 };
  for (const key of Object.keys(BUSINESS_TYPES)) out.types[key] = { total: 0, new: 0 };
  for (const record of records.values()) {
    if (record.status in out) out[record.status]++;
    const type = recordType(record);
    if (!type) out.unsorted++;
    else {
      out.types[type].total++;
      if (record.status === "new") out.types[type].new++;
    }
  }
  return out;
}

// ------------------------------------------------------- business types --
//
// Every email is filed under the kind of business whose website it came from,
// so a campaign can go to restaurants only, or schools only.

const BUSINESS_TYPES = {
  restaurant: {
    label: "Restaurants & cafés",
    keywords: ["restaurants", "cafes", "coffee shops", "bakeries", "cloud kitchens", "juice bars", "sweets shops",
      "fast food restaurants", "shawarma restaurants"],
    rules: [[/\brestaurants?\b/g, 1], [/\bcaf(?:e|é)s?\b/g, 1], [/\bcoffee\b/g, 0.8], [/\bbistro/g, 1],
      [/\bgrill\b/g, 0.8], [/\beatery\b/g, 1], [/\bcuisine\b/g, 0.8], [/\bmenu\b/g, 0.6], [/\bbaker(?:y|ies)\b/g, 1],
      [/\bpizza/g, 1], [/\bburgers?\b/g, 1], [/\bshawarma/g, 1], [/\bsweets\b/g, 0.8], [/\bjuices?\b/g, 0.6],
      [/\bdin(?:e|ing)\b/g, 0.6], [/\bdelivery\b/g, 0.3], [/\bfood\b/g, 0.3]],
  },
  hotel: {
    label: "Hotels",
    keywords: ["hotels", "hotel apartments", "resorts", "serviced apartments"],
    rules: [[/\bhotels?\b/g, 1], [/\bresorts?\b/g, 1], [/\bhotel apartments?\b/g, 1.5], [/\bsuites?\b/g, 0.5],
      [/\bhostels?\b/g, 1], [/\baccommodation/g, 0.8], [/\bbook (?:your|a) (?:room|stay)\b/g, 1], [/\bcheck-?in\b/g, 0.4]],
  },
  catering: {
    label: "Catering",
    keywords: ["catering companies", "event catering", "food catering services", "corporate catering"],
    rules: [[/\bcater(?:ing|er|ers)\b/g, 1.6], [/\bbanquets?\b/g, 0.8], [/\bmeal (?:plans?|boxes)\b/g, 0.8],
      [/\bcanteen/g, 0.8], [/\bfood services?\b/g, 0.8]],
  },
  services: {
    label: "Services",
    keywords: ["facility management companies", "cleaning companies", "maintenance companies", "logistics companies",
      "law firms", "accounting firms", "digital marketing agencies", "IT companies", "real estate companies",
      "contracting companies", "recruitment agencies", "pest control companies", "car rental companies",
      "travel agencies", "business setup consultants", "event management companies", "insurance companies"],
    rules: [[/\bconsult(?:ing|ancy|ants?)\b/g, 1], [/\bmaintenance\b/g, 1], [/\bcleaning\b/g, 1],
      [/\bcontracting\b/g, 1], [/\blogistics\b/g, 1], [/\bfreight\b/g, 1], [/\bshipping\b/g, 0.6],
      [/\blaw firm|\badvocates\b|\blegal consult/g, 1.2], [/\baccounting\b|\bauditing\b|\bbookkeeping\b/g, 1],
      [/\bmarketing agency|\bdigital marketing\b|\badvertising\b/g, 1], [/\bit solutions\b|\bsoftware\b|\bweb development\b/g, 1],
      [/\breal estate\b|\bproperties\b/g, 1], [/\bconstruction\b/g, 0.8], [/\bengineering\b/g, 0.6],
      [/\binsurance\b/g, 1], [/\brecruitment\b|\bmanpower\b/g, 1], [/\bfacility management\b/g, 1.2],
      [/\bpest control\b/g, 1.2], [/\blaundry\b/g, 1], [/\bcar rental\b|\brent a car\b/g, 1.2],
      [/\btravel\b|\btourism\b/g, 0.8], [/\bsecurity services\b/g, 1], [/\bprinting\b/g, 0.8],
      [/\bbusiness setup\b/g, 1.2], [/\bevent management\b/g, 1], [/\bservices\b/g, 0.25]],
  },
  school: {
    label: "Schools & education",
    keywords: ["schools", "nurseries", "training institutes", "universities", "academies", "kindergartens"],
    rules: [[/\bschools?\b/g, 1.2], [/\bacadem(?:y|ies)\b/g, 1], [/\bnurser(?:y|ies)\b/g, 1], [/\bkindergarten/g, 1.2],
      [/\buniversity\b/g, 1.2], [/\bcollege\b/g, 1], [/\binstitute\b/g, 0.8], [/\btraining (?:centre|center|institute)/g, 1.2],
      [/\bcurriculum\b/g, 1], [/\badmissions?\b/g, 1], [/\bstudents?\b/g, 0.5], [/\beducation(?:al)?\b/g, 0.8]],
  },
  other: {
    label: "Others",
    keywords: ["supermarkets", "general trading companies", "hospitals", "clinics", "pharmacies", "furniture stores",
      "electronics stores", "jewellery shops", "perfume shops", "fashion boutiques", "car dealers", "auto repair garages",
      "beauty salons", "gyms", "food trading companies", "industrial suppliers", "packaging companies", "food manufacturers"],
    rules: [],
  },
};
const TYPE_KEYS = Object.keys(BUSINESS_TYPES);

function cleanTypes(value) {
  const list = Array.isArray(value) ? value.map(String) : [];
  const wanted = list.filter((t) => TYPE_KEYS.includes(t));
  return wanted.length && wanted.length < TYPE_KEYS.length ? wanted : null;   // null = every type
}

/** Which kind of business a web page belongs to. */
function classifyPage(html, host) {
  const pick = (re) => { const m = html.match(re); return m ? decodeEntities(m[1].replace(/<[^>]+>/g, " ")) : ""; };
  const title = pick(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const desc = pick(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)/i) +
    " " + pick(/<meta[^>]+property=["']og:(?:site_name|title|description)["'][^>]+content=["']([^"']*)/i);
  const heads = [...html.matchAll(/<h[12][^>]*>([\s\S]*?)<\/h[12]>/gi)].slice(0, 12)
    .map((m) => m[1].replace(/<[^>]+>/g, " ")).join(" ");
  const domain = String(host || "").replace(/^www\./, "").replace(/\.(?:co|com|net|org)?\.?ae$|\.[a-z]+$/, "")
    .replace(/[-_.]/g, " ");
  const body = pageText(html).slice(0, 15000);
  const parts = [[title, 4], [desc, 3], [heads, 2], [domain, 3], [body, 1]].map(([t, w]) => [t.toLowerCase(), w]);
  let best = "other";
  let bestScore = 0;
  const scores = {};
  for (const [type, def] of Object.entries(BUSINESS_TYPES)) {
    let score = 0;
    for (const [re, weight] of def.rules) {
      for (const [text, w] of parts) {
        const hits = (text.match(re) || []).length;
        score += Math.min(hits, w === 1 ? 5 : 2) * w * weight;
      }
    }
    scores[type] = score;
    if (score > bestScore) { best = type; bestScore = score; }
  }
  if (bestScore < 4) return "other";
  // A caterer's site also talks about food and menus: catering wins when it is prominent.
  if (best === "restaurant" && scores.catering >= 4 && scores.catering >= 0.5 * scores.restaurant) return "catering";
  return best;
}

/** Type of a search keyword ("restaurants" -> restaurant). */
function typeOfKeyword(keyword) {
  const k = String(keyword || "").toLowerCase().trim();
  if (!k) return "";
  for (const [type, def] of Object.entries(BUSINESS_TYPES)) {
    if (def.keywords.some((w) => w.toLowerCase() === k)) return type;
  }
  for (const [type, def] of Object.entries(BUSINESS_TYPES)) {
    if (def.rules.some(([re]) => { re.lastIndex = 0; return new RegExp(re.source).test(k); })) return type;
  }
  return "other";
}

/** A record's business type ("" = not sorted yet). */
function recordType(record) {
  if (record.business_type && TYPE_KEYS.includes(record.business_type)) return record.business_type;
  const category = (record.category || "").trim();
  if (category && category !== "UAE website" && category !== "manual") return typeOfKeyword(category);
  return "";
}

function markRecord(email, status, error = "") {
  const key = String(email || "").trim().toLowerCase();
  if (!isValidSyntax(key)) {
    const err = new Error("Invalid email address.");
    err.statusCode = 400;
    throw err;
  }
  return locked(() => {
    const records = loadRecords();
    const existed = records.has(key);
    const record = existed ? records.get(key) : blankRecord(key);
    if (!existed) record.source_url = "manual";

    if (status === "sent") {
      record.status = "sent";
      record.send_count = String((parseInt(record.send_count, 10) || 0) + 1);
      record.last_sent_at = now();
      record.last_error = "";
    } else if (status === "failed") {
      if (record.status !== "unsubscribed") record.status = "failed";
      record.last_error = String(error || "").slice(0, 300);
    } else if (["unsubscribed", "invalid", "new"].includes(status)) {
      record.status = status;
    } else {
      const err = new Error("Unknown status: " + status);
      err.statusCode = 400;
      throw err;
    }
    records.set(key, record);
    saveRecords(records);
    return record;
  });
}

// ------------------------------------------------------------- validation --

function isValidSyntax(email) {
  if (!email || email.length > 254 || email.split("@").length !== 2) return false;
  const [local, domain] = email.split("@");
  if (!local || local.length > 64 || email.includes("..")) return false;
  if (!/^[a-z0-9!#$%&'*+/=?^_`{|}~.-]+$/i.test(local) || local.startsWith(".") || local.endsWith(".")) return false;
  return /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,24}$/.test(domain);
}

function isJunk(email) {
  const [local, domain] = email.split("@");
  const tld = domain.split(".").pop();
  if (FILE_EXTENSIONS.has(tld)) return true;
  if (hostMatches(domain, JUNK_DOMAINS)) return true;
  if (domain.includes("example") || domain.includes("sentry")) return true;
  if (JUNK_LOCALS.has(local)) return true;
  if (/^[a-f0-9]{20,}$/.test(local)) return true;
  if (/\d+x\d*$|@\dx/.test(local)) return true;
  if (/^(?:your|my|enter)[._-]?(?:mail|email|name)/.test(local)) return true;
  return false;
}

function isUae(email, text, pageHost) {
  const domain = email.split("@")[1];
  if (domain.endsWith(".ae")) return true;
  const tld = domain.split(".").pop();
  if (tld.length === 2 && !GENERIC_CC.has(tld)) return false;

  const position = text.toLowerCase().indexOf(email);
  if (position !== -1) {
    const window = text.slice(Math.max(0, position - 600), position + 600 + email.length);
    return UAE_MARKER.test(window);
  }
  return (pageHost.endsWith(".ae") || /(?:\+|00)\s?971/.test(text)) && UAE_MARKER.test(text);
}

const mxCache = new Map();
async function mxHosts(domain) {
  if (mxCache.has(domain)) return mxCache.get(domain);
  let hosts = [];
  try {
    const records = await dns.resolveMx(domain);
    hosts = records
      .filter((r) => r.exchange && r.exchange !== ".")
      .sort((a, b) => a.priority - b.priority)
      .map((r) => r.exchange);
  } catch {
    hosts = [];
  }
  mxCache.set(domain, hosts);
  return hosts;
}

/** Optional mailbox check (SCRAPER_SMTP_CHECK=1). Connection failure = "unknown", address kept. */
function smtpProbe(email, hosts) {
  return new Promise((resolve) => {
    if (!hosts[0]) return resolve("unknown");
    const from = env("MAIL_FROM_EMAIL", "marketing@mariotstore.com");
    const helo = from.split("@")[1] || "localhost";
    const steps = ["EHLO " + helo, "MAIL FROM:<" + from + ">", "RCPT TO:<" + email + ">"];
    let buffer = "";
    let step = -1;
    let done = false;
    const finish = (result) => {
      if (done) return;
      done = true;
      try { socket.end("QUIT\r\n"); } catch { /* closed */ }
      socket.destroy();
      resolve(result);
    };
    const socket = net.createConnection(25, hosts[0]);
    socket.setTimeout(6000, () => finish("unknown"));
    socket.on("error", () => finish("unknown"));
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      const lines = buffer.split(/\r?\n/).filter(Boolean);
      const last = lines[lines.length - 1] || "";
      if (!/^\d{3} /.test(last)) return; // multi-line reply still arriving
      buffer = "";
      const code = parseInt(last.slice(0, 3), 10);
      if (step === steps.length - 1) {
        if (code === 250 || code === 251) return finish("valid");
        if (code >= 550 && code <= 553) return finish("invalid");
        return finish("unknown");
      }
      const expected = step === -1 ? 220 : 250;
      if (code !== expected) return finish("unknown");
      step++;
      socket.write(steps[step] + "\r\n");
    });
  });
}

// ------------------------------------------------------------- extraction --

function decodeEntities(s) {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&nbsp;/g, " ").replace(/&commat;/g, "@").replace(/&period;/g, ".")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#039;|&apos;/g, "'");
}

function pageText(html) {
  const stripped = html
    .replace(/<(script|style|noscript|svg)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/(p|div|li|tr|td|h\d|span|a)>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  return decodeEntities(stripped).replace(/[ \t ]+/g, " ");
}

// "info [at] company [dot] ae" style obfuscation.
function deobfuscate(text) {
  return text
    .replace(/\s*[[({]\s*at\s*[\])}]\s*/gi, "@")
    .replace(/\s*[[({]\s*dot\s*[\])}]\s*/gi, ".");
}

function cfDecode(hex) {
  if (!hex || hex.length < 4 || !/^[0-9a-f]+$/i.test(hex)) return "";
  const key = parseInt(hex.slice(0, 2), 16);
  let out = "";
  for (let i = 2; i < hex.length; i += 2) out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ key);
  return out;
}

function extract(html, text) {
  const found = [];
  for (const m of html.matchAll(/data-cfemail="([0-9a-f]+)"|\/cdn-cgi\/l\/email-protection#([0-9a-f]+)/gi)) {
    const decoded = cfDecode(m[1] || m[2]);
    if (decoded) found.push(decoded);
  }
  for (const m of html.matchAll(/mailto:([^"'?>\s]+)/gi)) {
    try { found.push(decodeURIComponent(m[1])); } catch { found.push(m[1]); }
  }
  for (const haystack of [text, deobfuscate(text), decodeEntities(html)]) {
    for (const m of haystack.matchAll(EMAIL_PATTERN)) found.push(m[0]);
  }
  const clean = new Set();
  for (const address of found) {
    const a = address.trim().toLowerCase().replace(/^[\s.,;:'"<>()[\]]+|[\s.,;:'"<>()[\]]+$/g, "");
    if (a) clean.add(a);
  }
  return [...clean];
}

// ---------------------------------------------------------------- network --

const BROWSER_HEADERS = {
  "User-Agent": USER_AGENT,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br",
  "Upgrade-Insecure-Requests": "1",
};

/**
 * Small HTTP client on Node's own http/https modules, so it works on every
 * Node version (global fetch / AbortSignal.timeout need Node 18+). Follows
 * redirects, keeps cookies across them (search consent pages need that),
 * decompresses, and caps the body size.
 */
function httpRequest(url, { method = "GET", headers = {}, body = null, timeoutMs = 15000, maxBytes = 2000000, raw = false } = {}) {
  const deadline = Date.now() + timeoutMs;
  const cookies = new Map();

  const once = (target, redirectsLeft, verb, payload) =>
    new Promise((resolve, reject) => {
      let parsed;
      try {
        parsed = new URL(target);
      } catch {
        return reject(new Error("Bad URL " + target));
      }
      const lib = parsed.protocol === "http:" ? http : https;
      const cookieHeader = [...cookies].map(([k, v]) => k + "=" + v).join("; ");
      const req = lib.request(
        parsed,
        {
          method: verb,
          headers: { ...headers, ...(cookieHeader ? { Cookie: cookieHeader } : {}) },
          rejectUnauthorized: false, // many small business sites have broken certificates
        },
        (res) => {
          for (const line of [].concat(res.headers["set-cookie"] || [])) {
            const pair = line.split(";")[0];
            const eq = pair.indexOf("=");
            if (eq > 0) cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
          }
          const status = res.statusCode || 0;
          if ([301, 302, 303, 307, 308].includes(status) && res.headers.location && redirectsLeft > 0) {
            res.resume();
            const next = new URL(res.headers.location, target).href;
            const keep = status === 307 || status === 308;
            return resolve(once(next, redirectsLeft - 1, keep ? verb : "GET", keep ? payload : null));
          }

          let stream = res;
          const encoding = String(res.headers["content-encoding"] || "").toLowerCase();
          if (encoding.includes("br")) stream = res.pipe(zlib.createBrotliDecompress());
          else if (encoding.includes("gzip")) stream = res.pipe(zlib.createGunzip());
          else if (encoding.includes("deflate")) stream = res.pipe(zlib.createInflate());

          const chunks = [];
          let size = 0;
          let finished = false;
          const done = () => {
            if (finished) return;
            finished = true;
            const buffer = Buffer.concat(chunks);
            resolve({
              status,
              headers: res.headers,
              finalUrl: target,
              raw: buffer,
              body: raw ? "" : buffer.toString("utf8"),
            });
          };
          stream.on("data", (chunk) => {
            size += chunk.length;
            if (size <= maxBytes) chunks.push(chunk);
            else { done(); req.destroy(); }
          });
          stream.on("end", done);
          stream.on("error", (err) => (chunks.length ? done() : reject(err)));
        }
      );
      const left = Math.max(1000, deadline - Date.now());
      req.setTimeout(left, () => req.destroy(new Error("timed out")));
      req.on("error", reject);
      if (payload) req.write(payload);
      req.end();
    });

  return once(url, 5, method, body);
}

// Tests swap this out.
let transport = httpRequest;

/** Keeps the last odd engine reply, so a failing engine can be diagnosed. */
function saveDebugPage(engine, status, html) {
  try {
    fs.writeFileSync(
      path.join(recordsDir(), "last-search-" + engine + ".html"),
      "<!-- HTTP " + status + " at " + new Date().toISOString() + " -->\n" + html.slice(0, 500000)
    );
  } catch {
    // diagnostics only
  }
}

function searchProvider() {
  if (env("SERPER_API_KEY")) return "serper";
  if (env("SERPAPI_API_KEY")) return "serpapi";
  return "free";
}

// ------------------------------------------------- free search (no API key) --

const FREE_ENGINES = ["bing", "yahoo", "duckduckgo"];

// Anti-block pacing. Engines block traffic that is fast, regular and heavy, so
// each engine gets a random 25-50 s gap between searches, a daily cap, and a
// growing rest after any captcha/429 (30 min, 1 h, 2 h ... up to 24 h).
const ENGINE_GAP_MIN_S = 25;
const ENGINE_GAP_MAX_S = 50;
const ENGINE_DAILY_DEFAULT = 120;              // SCRAPER_DAILY_SEARCHES overrides
const ENGINE_COOLDOWN_MS = 30 * 60 * 1000;     // first rest; doubles per strike
const ENGINE_COOLDOWN_MAX_MS = 24 * 60 * 60 * 1000;
const MAX_WAIT_S = 120;                        // longer than this => report "resting"

const DIRECTORY_HOSTS = [
  "yellowpages-uae.com", "yellowpages.ae", "yello.ae", "uaecontact.com", "connect.ae",
  "uaeplusplus.com", "dubaibizdirectory.com", "uae-business-directory.com", "emiratesyellowpages.com",
];

// Search engines' own hosts: never treated as results, never crawled.
const ENGINE_HOSTS = [
  "bing.com", "bing.net", "bingj.com", "microsoft.com", "msn.com", "live.com",
  "yahoo.com", "yahoo.net", "yimg.com", "aol.com", "duckduckgo.com",
  "google.com", "google.ae", "googleusercontent.com", "gstatic.com",
  "w3.org", "schema.org",
];

function engineUrl(engine, query, page) {
  if (engine === "bing") {
    return "https://www.bing.com/search?" + new URLSearchParams({
      q: query, first: String((page - 1) * 10 + 1), cc: "AE", setlang: "en",
    });
  }
  if (engine === "yahoo") {
    return "https://search.yahoo.com/search?" + new URLSearchParams({ p: query, b: String((page - 1) * 10 + 1) });
  }
  return "https://html.duckduckgo.com/html/?" + new URLSearchParams({ q: query, kl: "ae-en", s: String((page - 1) * 30) });
}

/** Unwraps click-tracking links (Bing /ck/a, Yahoo RU=, DuckDuckGo uddg=, Google /url). */
function unwrapLink(href) {
  let url = decodeEntities(String(href).trim());
  if (url.startsWith("//")) url = "https:" + url;

  const ru = url.match(/\/RU=([^/]+)\/R[KS]=/);
  if (ru) {
    try { return decodeURIComponent(ru[1]); } catch { return url; }
  }
  let parsed;
  try {
    parsed = new URL(url, "https://www.google.com");
  } catch {
    return url;
  }
  const host = parsed.hostname;
  const u = parsed.searchParams.get("u");
  if (host.endsWith("bing.com") && u && u.startsWith("a1")) {
    try { return Buffer.from(u.slice(2), "base64url").toString("utf8"); } catch { return url; }
  }
  const uddg = parsed.searchParams.get("uddg");
  if (host.endsWith("duckduckgo.com") && uddg) return uddg;
  const q = parsed.searchParams.get("q");
  if (host.includes("google.") && q && q.startsWith("http")) return q;
  return url;
}

function resultLinks(html) {
  const links = new Map();
  for (const m of html.matchAll(/<a\b[^>]*?\bhref\s*=\s*["']([^"']+)["']/gi)) {
    const url = unwrapLink(m[1]);
    if (!/^https?:\/\//i.test(url)) continue;
    const host = hostOf(url);
    if (!host || links.has(host) || hostMatches(host, ENGINE_HOSTS)) continue;
    links.set(host, url);
    if (links.size >= 12) break;
  }
  return [...links.values()];
}

function engineBlocked(status, html, linkCount) {
  if ([202, 403, 429, 503].includes(status)) return true;
  // Only a page without results counts: normal pages can mention "captcha" in scripts.
  return linkCount === 0 && /captcha|unusual traffic|anomaly-modal|are you a robot|challenge-form|detected unusual/i.test(html);
}

const today = (ms = Date.now()) => new Date(ms).toISOString().slice(0, 10);

function dailySearches() {
  const value = parseInt(env("SCRAPER_DAILY_SEARCHES", String(ENGINE_DAILY_DEFAULT)), 10) || ENGINE_DAILY_DEFAULT;
  return Math.max(10, Math.min(1000, value));
}

/** Milliseconds until an engine may search again (0 = now). */
function engineWait(info = {}, now = Date.now()) {
  let wait = Math.max(0, (info.next || 0) - now, (info.until || 0) - now);
  if (info.day === today(now) && (info.count || 0) >= dailySearches()) {
    const tomorrow = new Date(today(now) + "T00:00:00Z").getTime() + 86400000;
    wait = Math.max(wait, tomorrow - now);
  }
  return wait;
}

function engineRecord(engine, outcome) {
  return locked(() => {
    const state = loadState();
    const now = Date.now();
    const info = { ...((state.engines || {})[engine] || {}) };
    if (info.day !== today(now)) { info.day = today(now); info.count = 0; }
    info.count = (info.count || 0) + 1;
    info.last = now;
    info.next = now + (ENGINE_GAP_MIN_S + crypto.randomInt(ENGINE_GAP_MAX_S - ENGINE_GAP_MIN_S + 1)) * 1000;
    if (outcome === "blocked") {
      info.strikes = (info.strikes || 0) + 1;
      info.until = now + Math.min(ENGINE_COOLDOWN_MAX_MS, ENGINE_COOLDOWN_MS * 2 ** (info.strikes - 1));
    } else if (outcome === "ok") {
      info.strikes = 0;
      info.until = 0;
    }
    state.engines = { ...(state.engines || {}), [engine]: info };
    saveState(state);
  });
}

function engineStatus() {
  const state = loadState();
  const now = Date.now();
  const out = {};
  for (const engine of FREE_ENGINES) {
    const info = (state.engines || {})[engine] || {};
    out[engine] = {
      today: info.day === today(now) ? info.count || 0 : 0,
      limit: dailySearches(),
      restingFor: Math.max(0, Math.round(((info.until || 0) - now) / 1000)),
      waitFor: Math.round(engineWait(info, now) / 1000),
    };
  }
  return out;
}

/**
 * Searches without any API key by reading the normal results page of Bing,
 * Yahoo or DuckDuckGo, paced so the engines do not block this server: random
 * gaps, a daily cap and growing rests. Returns { wait } when every engine is
 * pacing; ask again after that many seconds.
 */
async function freeSearch(query, page) {
  const state = await locked(() => loadState());
  const now = Date.now();
  const offset = (state.ptr || 0) % FREE_ENGINES.length;
  const engines = [...FREE_ENGINES.slice(offset), ...FREE_ENGINES.slice(0, offset)];

  const ready = [];
  let soonest = Infinity;
  for (const engine of engines) {
    const wait = engineWait((state.engines || {})[engine], now);
    if (wait === 0) ready.push(engine);
    soonest = Math.min(soonest, wait);
  }
  if (!ready.length) {
    const seconds = Math.ceil(soonest / 1000);
    if (seconds <= MAX_WAIT_S) return { wait: Math.max(1, seconds) };
    throw new Error(
      "All search engines are resting to avoid being blocked (next one free in about " +
        Math.ceil(seconds / 60) + " min). Progress is saved - click Find again later."
    );
  }

  const tried = [];
  for (const engine of ready) {
    const url = engineUrl(engine, query, page);
    let status = 0;
    let html = "";
    try {
      const response = await transport(url, { headers: BROWSER_HEADERS, timeoutMs: 15000 });
      status = response.status;
      html = response.body;
    } catch (err) {
      await engineRecord(engine, "error");
      tried.push(engine + " (" + err.message + ")");
      continue;
    }

    const links = resultLinks(html);
    if (engineBlocked(status, html, links.length)) {
      saveDebugPage(engine, status, html);
      await engineRecord(engine, "blocked");
      tried.push(engine + " (asked for a captcha - resting it)");
      continue;
    }
    await engineRecord(engine, links.length ? "ok" : "empty");
    if (!links.length) {
      saveDebugPage(engine, status, html);
      tried.push(engine + " (HTTP " + status + ", no results read from the page)");
      continue;
    }
    const results = links.map((link) => ({ link, text: "" }));
    // The results page itself: snippets often print the address.
    results.push({ link: url, text: pageText(html) });
    return { engine, results };
  }

  // Every ready engine failed this time. If another engine is only pacing,
  // wait for it instead of failing the run.
  const after = await locked(() => loadState());
  let nextFree = Infinity;
  for (const engine of FREE_ENGINES) {
    const info = (after.engines || {})[engine] || {};
    if ((info.until || 0) > Date.now()) continue; // resting after a captcha
    nextFree = Math.min(nextFree, engineWait(info));
  }
  const waitSeconds = Math.ceil(nextFree / 1000);
  if (waitSeconds <= MAX_WAIT_S) {
    return { wait: Math.max(1, waitSeconds), note: "Skipped " + tried.join(", ") + " - trying another engine." };
  }
  throw new Error("Search failed: " + tried.join(", ") + ".");
}

// ------------------------------------------------------ smarter crawling --

function absUrl(href, base) {
  const raw = decodeEntities(String(href).trim());
  if (!raw || raw.startsWith("#") || /^(mailto|tel|javascript|data|whatsapp):/i.test(raw)) return "";
  try {
    return new URL(raw, base).href.replace(/#.*$/, "");
  } catch {
    return "";
  }
}

function internalLinks(html, base) {
  const host = hostOf(base);
  const links = new Map();
  for (const m of html.matchAll(/<a\b[^>]*?\bhref\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const url = absUrl(m[1], base);
    if (!url || hostOf(url) !== host) continue;
    if (/\.(pdf|jpe?g|png|gif|webp|zip|docx?|xlsx?)(\?|$)/i.test(url)) continue;
    if (!links.has(url)) links.set(url, m[2].replace(/<[^>]+>/g, "").trim());
  }
  return [...links];
}

/** The site's real contact/about pages, found from its own menu. */
function contactLinks(html, base, max = 2) {
  return internalLinks(html, base)
    .filter(([url, text]) => /contact|about|reach|get-in-touch|enquir|inquir|location|our-office|تواصل|اتصل/iu.test(url + " " + text))
    .slice(0, max)
    .map(([url]) => url);
}

/** Company pages inside a business directory. */
function listingLinks(html, base, max = 8) {
  return internalLinks(html, base)
    .filter(([url]) => {
      const pathname = new URL(url).pathname;
      return /\/(company|companies|listing|listings|business|businesses|profile|detail|details|firm|biz|supplier|store)s?(\/|-|$)/i.test(pathname) &&
        !/\/(login|register|signup|add|category|categories|search|page)\/?/i.test(pathname);
    })
    .slice(0, max)
    .map(([url]) => url);
}

async function search(query, page) {
  if (!env("SERPER_API_KEY") && !env("SERPAPI_API_KEY")) return freeSearch(query, page);
  let items;
  if (env("SERPER_API_KEY")) {
    const response = await transport("https://google.serper.dev/search", {
      method: "POST",
      headers: { "X-API-KEY": env("SERPER_API_KEY"), "Content-Type": "application/json" },
      body: JSON.stringify({ q: query, gl: "ae", hl: "en", num: 10, page }),
    });
    const body = response.body;
    if (response.status !== 200) throw new Error("Serper search failed (HTTP " + response.status + "): " + body.slice(0, 200));
    items = JSON.parse(body).organic || [];
  } else if (env("SERPAPI_API_KEY")) {
    const params = new URLSearchParams({
      engine: "google", q: query, gl: "ae", hl: "en", google_domain: "google.ae",
      num: "10", start: String((page - 1) * 10), api_key: env("SERPAPI_API_KEY"),
    });
    const response = await transport("https://serpapi.com/search.json?" + params, {});
    const body = response.body;
    if (response.status !== 200) throw new Error("SerpAPI search failed (HTTP " + response.status + "): " + body.slice(0, 200));
    items = JSON.parse(body).organic_results || [];
  }
  const results = items
    .filter((item) => item && item.link)
    .map((item) => ({ link: item.link, text: (item.title || "") + "\n" + (item.snippet || "") }));
  return { engine: env("SERPER_API_KEY") ? "serper" : "serpapi", results };
}

async function fetchPage(url, timeoutMs) {
  try {
    const response = await transport(url, { headers: BROWSER_HEADERS, timeoutMs, maxBytes: 1500000 });
    const type = String(response.headers["content-type"] || "");
    if (response.status < 200 || response.status >= 400 || (type && !/html|text/i.test(type))) return null;
    return response.body;
  } catch {
    return null;
  }
}

async function fetchPages(urls, timeoutMs = 8000) {
  const unique = [...new Set(urls)];
  const pages = await Promise.all(unique.map((url) => fetchPage(url, timeoutMs)));
  const out = new Map();
  unique.forEach((url, i) => { if (pages[i] !== null) out.set(url, pages[i]); });
  return out;
}

// ---------------------------------------------------------------- queries --

function buildQueries(keywords, cities) {
  const kw = keywords.length ? keywords : DEFAULT_CATEGORIES;
  const ct = cities.length ? cities : UAE_CITIES;
  const queries = [];
  for (const category of kw) {
    for (const city of ct) queries.push({ q: category + " " + city + " UAE contact email", category, city });
  }
  return queries;
}

function cleanList(value, max) {
  const items = typeof value === "string" ? value.split(/[\n,;]+/) : Array.isArray(value) ? value : [];
  const out = new Map();
  for (const item of items) {
    const clean = String(item).replace(/[^\p{L}\p{N} &'.-]/gu, "").trim();
    if (clean && clean.length <= 60) out.set(clean.toLowerCase(), clean);
  }
  return [...out.values()].slice(0, max);
}

// ----------------------------------------------------------------- scrape --

async function scrapeStep(body) {
  const started = Date.now();
  const need = Math.max(1, Math.min(2500, parseInt(body.need, 10) || 50));
  const types = cleanTypes(body.types);
  let keywords = cleanList(body.keywords, 200);
  if (!keywords.length && types) keywords = types.flatMap((t) => BUSINESS_TYPES[t].keywords);
  const queries = buildQueries(keywords, cleanList(body.cities, 20));

  const pick = await locked(() => {
    const state = loadState();
    for (let n = 0; n < queries.length; n++) {
      const index = (state.ptr + n) % queries.length;
      const q = queries[index].q;
      const page = (state.pages[q] || 0) + 1;
      if (page <= MAX_PAGES_PER_QUERY) {
        state.ptr = index + 1;
        state.pages[q] = page;
        saveState(state);
        return { query: queries[index], page, crawled: state.crawled };
      }
    }
    return null;
  });

  if (!pick) {
    return {
      exhausted: true, emails: [], added: 0,
      log: ["Every query for these keywords and cities has been searched. Add new keywords to find more."],
    };
  }

  const { query } = pick;
  const log = [];
  // Give the page back, so it is searched again next time.
  const release = () =>
    locked(() => {
      const state = loadState();
      state.pages[query.q] = Math.max(0, (state.pages[query.q] || 1) - 1);
      state.ptr = Math.max(0, (state.ptr || 0) - 1);
      saveState(state);
    });
  let searched;
  try {
    searched = await search(query.q, pick.page);
  } catch (err) {
    await release();
    throw err;
  }
  if (searched.wait) {
    await release();
    return { exhausted: false, wait: searched.wait, emails: [], added: 0, log: searched.note ? [searched.note] : [] };
  }
  const results = searched.results;
  log.push('Searched "' + query.q + '" page ' + pick.page + " on " + searched.engine + ": " + results.length + " results");

  const candidates = new Map(); // email -> source url
  const consider = (html, rawText, url) => {
    const host = hostOf(url);
    const text = deobfuscate(rawText);
    for (const email of extract(html, text)) {
      if (candidates.has(email)) continue;
      if (!isValidSyntax(email) || isJunk(email)) continue;
      if (!isUae(email, text, host)) continue;
      candidates.set(email, url);
    }
  };

  const toFetch = new Map(); // host -> url
  for (const result of results) {
    consider("", result.text, result.link);
    const host = hostOf(result.link);
    if (!host || hostMatches(host, SKIP_HOSTS) || hostMatches(host, ENGINE_HOSTS)) continue;
    const seen = pick.crawled[host];
    if (seen && Date.now() - seen < RECRAWL_AFTER_MS) continue;
    toFetch.set(host, result.link);
  }

  const pages = await fetchPages([...toFetch.values()]);
  const followUps = [];
  let directoryPages = 0;
  const pageTypes = new Map();     // host -> business type of its home/result page
  for (const [url, html] of pages) pageTypes.set(hostOf(url), classifyPage(html, hostOf(url)));
  for (const [url, html] of pages) {
    const before = candidates.size;
    consider(html, pageText(html), url);
    const foundHere = candidates.size - before;

    // More emails per search = fewer searches = less chance of a block.
    if (hostMatches(hostOf(url), DIRECTORY_HOSTS) || foundHere >= 3) {
      const listing = listingLinks(html, url, 8);
      if (listing.length) directoryPages++;
      followUps.push(...listing);
    }
    if (foundHere === 0) {
      const contact = contactLinks(html, url);
      const origin = new URL(url).origin;
      followUps.push(...(contact.length ? contact : [origin + "/contact-us", origin + "/contact"]));
    }
  }
  // Results that did not load at all: try their usual contact path.
  for (const url of toFetch.values()) {
    if (!pages.has(url)) followUps.push(new URL(url).origin + "/contact-us");
  }

  if (followUps.length && Date.now() - started < STEP_BUDGET_MS - 10000) {
    const list = [...new Set(followUps)].slice(0, 24);
    for (const [url, html] of await fetchPages(list, 7000)) consider(html, pageText(html), url);
    if (directoryPages) log.push("Followed company pages on " + directoryPages + " business director" + (directoryPages === 1 ? "y" : "ies"));
  }

  const known = await locked(() => loadRecords());
  const fresh = [...candidates].filter(([email]) => !known.has(email));
  log.push(candidates.size + " UAE addresses found, " + fresh.length + " not yet on record");

  const smtp = env("SCRAPER_SMTP_CHECK") === "1";
  const verified = [];
  let rejected = 0;
  for (const [email, source] of fresh) {
    const hosts = await mxHosts(email.split("@")[1]);
    if (!hosts.length) { rejected++; continue; }
    if (smtp && Date.now() - started < STEP_BUDGET_MS && (await smtpProbe(email, hosts)) === "invalid") {
      rejected++;
      continue;
    }
    verified.push([email, source]);
  }
  if (rejected) log.push(rejected + " rejected: domain has no working mail server" + (smtp ? " or mailbox does not exist" : ""));

  const typeOf = new Map();
  const added = await locked(() => {
    const records = loadRecords();
    const out = [];
    for (const [email, source] of verified) {
      if (records.has(email)) continue;
      const record = blankRecord(email);
      record.city = query.city;
      record.category = query.category;
      record.source_url = source;
      // A directory page lists many kinds of business: trust the search keyword there.
      const siteType = pageTypes.get(hostOf(source));
      record.business_type = siteType && siteType !== "other" && !hostMatches(hostOf(source), DIRECTORY_HOSTS)
        ? siteType : typeOfKeyword(query.category);
      records.set(email, record);
      out.push(email);
      typeOf.set(email, record.business_type);
    }
    if (out.length) saveRecords(records);
    const state = loadState();
    for (const host of toFetch.keys()) state.crawled[host] = Date.now();
    saveState(state);
    return out;
  });
  log.push(added.length + " verified new UAE emails saved to records");

  const wanted = types ? added.filter((e) => types.includes(typeOf.get(e))) : added;
  if (types && wanted.length < added.length) {
    log.push((added.length - wanted.length) + " of them are other kinds of business - kept in records for later");
  }
  return { exhausted: false, query: query.q, page: pick.page, added: wanted.length, emails: wanted.slice(0, need), log };
}

// =========================================================================
// Website-list mode: no search engines, so no waiting, rests or captchas.
//
// UAE business websites (.ae domains) are taken from public "top 1 million
// websites" research lists (Tranco and Cisco Umbrella), downloaded once and
// refreshed monthly. Each step then visits the next batch of websites
// directly - their home and contact pages - many at a time.
// =========================================================================

const SITE_SOURCES = {
  tranco: "https://tranco-list.eu/top-1m.csv.zip",
  umbrella: "https://s3-us-west-1.amazonaws.com/umbrella-static/top-1m.csv.zip",
};
const SITE_BATCH = 40;
const SITE_LIST_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const AE_SECOND_LEVEL = new Set(["co", "com", "net", "org", "gov", "ac", "sch", "mil", "pro", "name"]);
const AE_EXCLUDED = new Set(["gov", "mil"]);

/** SCRAPER_SITE_LISTS="name=url,name=url" replaces the default sources. */
function siteSources() {
  const custom = env("SCRAPER_SITE_LISTS");
  if (!custom) return SITE_SOURCES;
  const out = {};
  for (const pair of custom.split(",")) {
    const i = pair.indexOf("=");
    const name = pair.slice(0, i).trim();
    const url = pair.slice(i + 1).trim();
    if (i > 0 && /^https?:\/\//.test(url)) out[name] = url;
  }
  return Object.keys(out).length ? out : SITE_SOURCES;
}

const sitesPath = () => path.join(recordsDir(), "uae-websites.json");

function loadSites() {
  let data = {};
  try {
    data = JSON.parse(fs.readFileSync(sitesPath(), "utf8")) || {};
  } catch {
    data = {};
  }
  return { built_at: 0, pending: [], domains: {}, list: [], cursor: 0, failed: [], ...data };
}

const saveSites = (sites) => fs.writeFileSync(sitesPath(), JSON.stringify(sites));

const sitesReady = (sites) =>
  Boolean(sites.built_at) && Date.now() - sites.built_at * 1000 < SITE_LIST_MAX_AGE_MS && !sites.pending.length;

/** "mail.shop.co.ae" -> "shop.co.ae"; null for non-.ae or excluded hosts. */
function aeDomain(host) {
  const h = String(host).trim().toLowerCase().replace(/^\.+|\.+$/g, "");
  if (!/^[a-z0-9.-]+\.ae$/.test(h)) return null;
  const labels = h.split(".");
  const n = labels.length;
  if (n >= 3 && AE_SECOND_LEVEL.has(labels[n - 2])) {
    if (AE_EXCLUDED.has(labels[n - 2])) return null;
    return labels.slice(-3).join(".");
  }
  return n >= 2 ? labels.slice(-2).join(".") : null;
}

/** Extracts the first file of a zip archive. */
function unzipFirst(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("not a zip file");
  const cd = buf.readUInt32LE(eocd + 16);
  if (buf.readUInt32LE(cd) !== 0x02014b50) throw new Error("broken zip directory");
  const method = buf.readUInt16LE(cd + 10);
  const size = buf.readUInt32LE(cd + 20);
  const local = buf.readUInt32LE(cd + 42);
  const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
  const data = buf.subarray(start, start + size);
  if (method === 0) return data;
  if (method === 8) return zlib.inflateRawSync(data);
  throw new Error("unsupported zip compression");
}

function sitesStatus() {
  const sites = loadSites();
  return {
    ready: sitesReady(sites),
    total: sites.list.length,
    left: Math.max(0, sites.list.length - sites.cursor),
    builtAt: sites.built_at ? new Date(sites.built_at * 1000).toISOString().slice(0, 10) : null,
  };
}

/** Builds the website list one source per call, so no request runs long. */
async function prepareSites() {
  const sites = await locked(() => loadSites());
  if (sitesReady(sites)) return { ready: true, log: [] };
  if (!sites.pending.length) {
    sites.pending = Object.keys(siteSources());
    sites.failed = [];
  }
  const source = sites.pending.shift();
  const log = [];
  try {
    const url = siteSources()[source];
    if (!url) throw new Error("unknown source");
    const response = await transport(url, { headers: { "User-Agent": USER_AGENT }, timeoutMs: 150000, maxBytes: 60000000, raw: true });
    if (response.status !== 200) throw new Error("HTTP " + response.status);
    const csv = unzipFirst(response.raw).toString("utf8");
    let found = 0;
    for (const line of csv.split(/\r?\n/)) {
      if (!line.includes(".ae")) continue;
      const [rankText, host] = line.split(",");
      const domain = aeDomain(host || "");
      if (!domain) continue;
      const rank = parseInt(rankText, 10) || 999999999;
      if (!(domain in sites.domains)) found++;
      if (!(domain in sites.domains) || rank < sites.domains[domain]) sites.domains[domain] = rank;
    }
    log.push("Downloaded the " + source + " website list: " + found + " new UAE (.ae) websites");
  } catch (err) {
    sites.failed.push(source);
    log.push("Could not download the " + source + " list (" + err.message + ")");
  }

  if (!sites.pending.length) {
    if (!Object.keys(sites.domains).length) {
      await locked(() => saveSites(sites));
      throw new Error("Could not download any UAE website list. Check the internet connection and try again.");
    }
    const state = loadState();
    const done = sites.list.slice(0, sites.cursor);
    const doneSet = new Set(done);
    const list = [...done];
    for (const [domain] of Object.entries(sites.domains).sort((a, b) => a[1] - b[1])) {
      if (doneSet.has(domain) || state.crawled[domain] || state.crawled["www." + domain]) continue;
      list.push(domain);
    }
    sites.list = list;
    sites.built_at = Math.floor(Date.now() / 1000);
    log.push("UAE website list ready: " + (list.length - done.length) + " websites to visit");
  }
  await locked(() => saveSites(sites));
  return { ready: sitesReady(sites), log };
}

/** .ae websites a page links to (other than itself). */
function discoverAeSites(html, pageHost) {
  const own = aeDomain(pageHost);
  const out = new Set();
  for (const m of html.matchAll(/https?:\/\/([a-z0-9.-]+\.ae)(?=[/:"'?\s#]|$)/gi)) {
    const domain = aeDomain(m[1]);
    if (domain && domain !== own) out.add(domain);
    if (out.size >= 40) break;
  }
  return [...out];
}

/** Appends never-seen domains to the website list; returns how many were added. */
function addSites(domains) {
  if (!domains.length) return Promise.resolve(0);
  return locked(() => {
    const sites = loadSites();
    const state = loadState();
    let added = 0;
    for (const domain of domains) {
      if (domain in sites.domains || state.crawled[domain] || state.crawled["www." + domain]) continue;
      sites.domains[domain] = 900000000 + added; // after the ranked sites
      sites.list.push(domain);
      added++;
    }
    if (added) saveSites(sites);
    return added;
  });
}

function detectCity(text) {
  const lower = text.toLowerCase();
  return UAE_CITIES.find((city) => lower.includes(city.toLowerCase())) || "";
}

/** One website-list step: the next SITE_BATCH websites and their contact pages, in parallel. */
async function crawlStep(body) {
  const started = Date.now();
  const need = Math.max(1, Math.min(2500, parseInt(body.need, 10) || 50));
  const types = cleanTypes(body.types);

  const batch = await locked(() => {
    const sites = loadSites();
    if (!sitesReady(sites)) return null;
    const domains = sites.list.slice(sites.cursor, sites.cursor + SITE_BATCH);
    sites.cursor += domains.length;
    saveSites(sites);
    return { domains, left: sites.list.length - sites.cursor };
  });
  if (!batch) return { needsPrepare: true, emails: [], added: 0, log: [] };
  if (!batch.domains.length) {
    // Every listed website was visited: look at visited websites again only
    // for links to UAE websites not seen yet, which refills the list.
    const again = await locked(() => {
      const sites = loadSites();
      const from = sites.discover_cursor || 0;
      const domains = sites.list.slice(from, from + SITE_BATCH);
      sites.discover_cursor = from + domains.length;
      saveSites(sites);
      return domains;
    });
    if (again.length) {
      const found = new Set();
      for (const [url, html] of await fetchPages(again.map((d) => "https://" + d + "/"), 8000)) {
        for (const domain of discoverAeSites(html, hostOf(url))) found.add(domain);
      }
      const grown = await addSites([...found]);
      return {
        exhausted: false, emails: [], added: 0,
        log: ["All listed websites visited - checked " + again.length + " of them for links to more UAE websites: " + grown + " new websites added"],
      };
    }
    return {
      exhausted: true, emails: [], added: 0,
      log: ['Every website in the UAE list has been visited. The list refreshes monthly; meanwhile use "Search engines" mode.'],
    };
  }

  const candidates = new Map(); // email -> [source url, city, business type]
  const discovered = new Set(); // new .ae websites linked from the pages visited
  const siteTypes = new Map();  // site -> business type, from its home page
  const consider = (html, url) => {
    const host = hostOf(url);
    const site = aeDomain(host) || host;
    if (!siteTypes.has(site)) siteTypes.set(site, classifyPage(html, host));
    for (const domain of discoverAeSites(html, host)) discovered.add(domain);
    const text = deobfuscate(pageText(html));
    const city = detectCity(text);
    for (const email of extract(html, text)) {
      if (candidates.has(email) || !isValidSyntax(email) || isJunk(email)) continue;
      const tld = email.split(".").pop();
      const uae = host.endsWith(".ae") ? tld.length !== 2 || GENERIC_CC.has(tld) : isUae(email, text, host);
      if (uae) candidates.set(email, [url, city, siteTypes.get(site)]);
    }
  };

  const urls = batch.domains.map((d) => "https://" + d + "/");
  const pages = await fetchPages(urls, 8000);
  const followUps = [];
  for (const [url, html] of pages) {
    const before = candidates.size;
    consider(html, url);
    if (candidates.size === before) {
      const contact = contactLinks(html, url);
      followUps.push(...(contact.length ? contact : [url + "contact-us", url + "contact"]));
    }
  }
  for (const url of urls) if (!pages.has(url)) followUps.push("http://www." + hostOf(url) + "/");

  if (followUps.length && Date.now() - started < STEP_BUDGET_MS - 9000) {
    for (const [url, html] of await fetchPages([...new Set(followUps)].slice(0, 90), 7000)) consider(html, url);
  }

  const log = ["Visited " + batch.domains.length + " UAE websites (" + pages.size + " answered, " + batch.left + " left in the list)"];
  // Websites the visited pages link to, and .ae email domains, join the list,
  // so it keeps growing and every run reaches websites never visited before.
  for (const email of candidates.keys()) {
    const domain = aeDomain(email.split("@")[1]);
    if (domain) discovered.add(domain);
  }
  const grown = await addSites([...discovered]);
  if (grown) log.push(grown + " new UAE websites discovered and added to the list");

  const added = await verifyAndSave(candidates, "UAE website", batch.domains, started, log);
  const wanted = types ? added.filter((e) => types.includes(candidates.get(e)[2])) : added;
  if (types) {
    const counts = {};
    for (const e of added) counts[candidates.get(e)[2]] = (counts[candidates.get(e)[2]] || 0) + 1;
    const summary = Object.entries(counts).map(([t, n]) => n + " " + BUSINESS_TYPES[t].label.toLowerCase()).join(", ");
    if (added.length) log.push("By type: " + summary + " - " + wanted.length + " match your selection, the rest are kept in records");
  }
  return { exhausted: false, added: wanted.length, emails: wanted.slice(0, need), log };
}

/** Drops known addresses, checks mail servers (in parallel), saves the rest as "new". */
async function verifyAndSave(candidates, category, hosts, started, log) {
  const known = await locked(() => loadRecords());
  const fresh = [...candidates].filter(([email]) => !known.has(email));
  log.push(candidates.size + " UAE addresses found, " + fresh.length + " not yet on record");

  const smtp = env("SCRAPER_SMTP_CHECK") === "1";
  const checks = await Promise.all(
    fresh.map(async ([email, meta]) => {
      const mx = await mxHosts(email.split("@")[1]);
      if (!mx.length) return null;
      if (smtp && Date.now() - started < STEP_BUDGET_MS && (await smtpProbe(email, mx)) === "invalid") return null;
      return [email, meta];
    })
  );
  const verified = checks.filter(Boolean);
  const rejected = fresh.length - verified.length;
  if (rejected) log.push(rejected + " rejected: no working mail server" + (smtp ? " or mailbox does not exist" : ""));

  const added = await locked(() => {
    const records = loadRecords();
    const out = [];
    for (const [email, [source, city, type]] of verified) {
      if (records.has(email)) continue;
      const record = blankRecord(email);
      record.city = city;
      record.category = category;
      record.source_url = source;
      record.business_type = type || "";
      records.set(email, record);
      out.push(email);
    }
    if (out.length) saveRecords(records);
    const state = loadState();
    for (const host of hosts) state.crawled[host] = Date.now();
    saveState(state);
    return out;
  });
  log.push(added.length + " verified new UAE emails saved to records");
  return added;
}

/**
 * Sorts emails saved before business types existed: visits the websites they
 * came from (40 at a time) and files every email from that site under its type.
 */
async function classifyStep() {
  const records = await locked(() => loadRecords());
  const bySite = new Map();
  for (const record of records.values()) {
    if (recordType(record)) continue;
    const source = /^https?:/.test(record.source_url) ? record.source_url : "https://" + record.domain + "/";
    const site = hostOf(source);
    if (!site) continue;
    if (!bySite.has(site)) bySite.set(site, []);
    bySite.get(site).push(record.email);
  }
  const sites = [...bySite.keys()].slice(0, SITE_BATCH);
  if (!sites.length) return { done: true, sorted: 0, left: 0, log: ["Every saved email is sorted by business type."] };
  const pages = await fetchPages(sites.map((s) => "https://" + s + "/"), 8000);
  const types = new Map();
  for (const [url, html] of pages) types.set(hostOf(url), classifyPage(html, hostOf(url)));
  let sorted = 0;
  await locked(() => {
    const fresh = loadRecords();
    for (const site of sites) {
      const type = types.get(site) || "other";    // a site that no longer answers is filed under Others
      for (const email of bySite.get(site)) {
        const record = fresh.get(email);
        if (record && !recordType(record)) { record.business_type = type; sorted++; }
      }
    }
    saveRecords(fresh);
  });
  const left = [...bySite.keys()].length - sites.length;
  return { done: left === 0, sorted, left, log: ["Sorted " + sorted + " saved emails from " + sites.length + " websites (" + left + " websites left)"] };
}

// ------------------------------------------------------------ recipients --

function pick(mode, count, exclude, types = null) {
  const records = loadRecords();
  const skip = new Set(exclude.map((e) => String(e).trim().toLowerCase()));
  let pool = [...records.values()].filter((r) => {
    if (skip.has(r.email)) return false;
    if (types && !types.includes(recordType(r))) return false;
    if (mode === "new") return r.status === "new";
    if (mode === "old") return r.status === "sent";
    return r.status === "new" || r.status === "sent";
  });
  if (mode === "random") {
    for (let i = pool.length - 1; i > 0; i--) {
      const j = crypto.randomInt(i + 1);
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
  } else if (mode === "old") {
    pool.sort((a, b) => a.last_sent_at.localeCompare(b.last_sent_at));
  } else {
    pool.sort((a, b) => a.found_at.localeCompare(b.found_at));
  }
  return pool.slice(0, Math.max(0, count)).map((r) => r.email);
}

function filter(mode, emails) {
  const records = loadRecords();
  const allowed = [];
  const skipped = [];
  for (const email of emails) {
    const key = String(email).trim().toLowerCase();
    if (!key) continue;
    const status = records.has(key) ? records.get(key).status : "";
    if (BLOCKED_STATUSES.includes(status)) skipped.push({ email: key, reason: status });
    else if (mode === "new" && (status === "sent" || status === "failed")) skipped.push({ email: key, reason: "already " + status + " before" });
    else allowed.push(String(email));
  }
  return { allowed, skipped };
}

// ---------------------------------------------------------------- handler --

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Tool-Key");
  if (req.method === "OPTIONS") return res.status(200).end();

  const url = new URL(req.url, "http://localhost");
  const toolKey = env("TOOL_API_KEY");
  if (toolKey && !safeEqual(toolKey, req.headers["x-tool-key"] || url.searchParams.get("key") || "")) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    if (req.method === "GET") {
      if (url.searchParams.get("action") === "export") {
        let csv;
        try {
          csv = fs.readFileSync(csvPath(), "utf8");
        } catch {
          csv = "﻿" + COLUMNS.join(",") + "\n";
        }
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader(
          "Content-Disposition",
          'attachment; filename="uae-email-records-' + new Date().toISOString().slice(0, 10) + '.csv"'
        );
        return res.status(200).send(csv);
      }
      return res.status(200).json({ stats: stats(loadRecords()), searchProvider: searchProvider(),
        businessTypes: Object.fromEntries(TYPE_KEYS.map((t) => [t, BUSINESS_TYPES[t].label])),
        engines: searchProvider() === "free" ? engineStatus() : null,
        sites: sitesStatus(),
      });
    }

    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    const body = req.body && typeof req.body === "object" ? req.body : {};
    const mode = ["new", "old", "random"].includes(body.mode) ? body.mode : "new";

    switch (body.action) {
      case "prepare-sites": {
        const result = await prepareSites();
        return res.status(200).json({ ...result, sites: sitesStatus() });
      }
      case "crawl": {
        const result = await crawlStep(body);
        return res.status(200).json({ ...result, stats: stats(loadRecords()), sites: sitesStatus() });
      }
      case "classify": {
        const result = await classifyStep();
        return res.status(200).json({ ...result, stats: stats(loadRecords()) });
      }
      case "scrape": {
        const result = await scrapeStep(body);
        return res.status(200).json({ ...result, stats: stats(loadRecords()) });
      }
      case "load": {
        const count = Math.max(0, Math.min(5000, parseInt(body.count, 10) || 0));
        const exclude = Array.isArray(body.exclude) ? body.exclude : [];
        return res.status(200).json({ emails: pick(mode, count, exclude, cleanTypes(body.types)), stats: stats(loadRecords()) });
      }
      case "filter":
        return res.status(200).json(filter(mode, Array.isArray(body.emails) ? body.emails : []));
      case "mark": {
        const record = await markRecord(body.email, String(body.status || ""), body.error);
        return res.status(200).json({ ok: true, record });
      }
      default:
        return res.status(400).json({ error: "Unknown action" });
    }
  } catch (err) {
    console.error("[email-records]", err);
    return res.status(err.statusCode || 500).json({ error: err.message });
  }
}

module.exports = handler;
// Used by api/unsubscribe.js to stop emailing people who opt out.
module.exports.markRecord = markRecord;
// Exposed for tests.
module.exports._setTransport = (fn) => { transport = fn || httpRequest; };
module.exports._internals = { classifyPage, typeOfKeyword, recordType, cleanTypes, aeDomain, unzipFirst, httpRequest, contactLinks, listingLinks, engineWait, resultLinks, unwrapLink, engineBlocked, extract, pageText, isUae, isJunk, isValidSyntax, buildQueries, filter, pick };

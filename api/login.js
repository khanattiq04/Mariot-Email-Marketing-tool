/**
 * Session endpoint for the marketing tool.
 *
 *   POST   /api/login   { email, password }  -> sets an HttpOnly session cookie
 *   GET    /api/login                        -> { authed, email }
 *   DELETE /api/login                        -> clears the session cookie
 *
 * Credentials are read from LOGIN_EMAIL / LOGIN_PASSWORD so they are never part
 * of the browser bundle, and sessions are signed with SESSION_SECRET.
 */
const crypto = require("crypto");

const COOKIE = "mm_session";
const TTL_MS = 12 * 60 * 60 * 1000;
const MAX_ATTEMPTS = 8;
const ATTEMPT_WINDOW_MS = 10 * 60 * 1000;

const LOGIN_EMAIL = (process.env.LOGIN_EMAIL || "").trim();
const LOGIN_PASSWORD = process.env.LOGIN_PASSWORD || "";
const SESSION_SECRET = process.env.SESSION_SECRET || LOGIN_PASSWORD;

// Best-effort brute force throttle. Each serverless instance keeps its own
// counters, so this slows an attacker down rather than stopping them outright.
const attempts = new Map();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function clientKey(req) {
  const forwarded = req.headers["x-forwarded-for"];
  const first = (Array.isArray(forwarded) ? forwarded[0] : String(forwarded || ""))
    .split(",")[0]
    .trim();
  return first || (req.socket && req.socket.remoteAddress) || "unknown";
}

function isThrottled(key) {
  const entry = attempts.get(key);
  if (!entry || Date.now() - entry.first > ATTEMPT_WINDOW_MS) return false;
  return entry.count >= MAX_ATTEMPTS;
}

function recordFailure(key) {
  const entry = attempts.get(key);
  if (!entry || Date.now() - entry.first > ATTEMPT_WINDOW_MS) {
    attempts.set(key, { first: Date.now(), count: 1 });
    return;
  }
  entry.count += 1;
}

function sign(value) {
  return crypto.createHmac("sha256", SESSION_SECRET).update(value).digest("base64url");
}

function createToken(email) {
  const payload = Buffer.from(
    JSON.stringify({ email, exp: Date.now() + TTL_MS })
  ).toString("base64url");
  return payload + "." + sign(payload);
}

function readToken(token) {
  if (typeof token !== "string" || !token.includes(".")) return null;

  const [payload, signature] = token.split(".");
  const given = Buffer.from(signature || "");
  const expected = Buffer.from(sign(payload));

  if (given.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(given, expected)) return null;

  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return data.exp > Date.now() ? data : null;
  } catch {
    return null;
  }
}

// Constant time compare, so a wrong password costs the same as a wrong email.
function sameSecret(given, expected) {
  const left = Buffer.from(String(given));
  const right = Buffer.from(String(expected));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function cookieValue(header, name) {
  for (const part of String(header || "").split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    if (part.slice(0, index).trim() === name) {
      return decodeURIComponent(part.slice(index + 1).trim());
    }
  }
  return "";
}

function sessionCookie(token) {
  const attrs = [
    COOKIE + "=" + token,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=" + Math.floor(TTL_MS / 1000),
  ];
  // Vercel serves over https; localhost does not, so Secure is production only.
  if (process.env.VERCEL || process.env.NODE_ENV === "production") attrs.push("Secure");
  return attrs.join("; ");
}

function expiryCookie() {
  return COOKIE + "=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0";
}

module.exports = async (req, res) => {
  if (!LOGIN_EMAIL || !LOGIN_PASSWORD || !SESSION_SECRET) {
    return res.status(500).json({
      error: "Login is not configured. Set LOGIN_EMAIL, LOGIN_PASSWORD and SESSION_SECRET.",
    });
  }

  if (req.method === "GET") {
    const session = readToken(cookieValue(req.headers.cookie, COOKIE));
    return res.status(200).json({
      authed: Boolean(session),
      email: session ? session.email : null,
    });
  }

  if (req.method === "DELETE") {
    res.setHeader("Set-Cookie", expiryCookie());
    return res.status(200).json({ ok: true });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST, DELETE");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const key = clientKey(req);
  if (isThrottled(key)) {
    return res.status(429).json({ error: "Too many attempts. Try again in a few minutes." });
  }

  const email = String((req.body && req.body.email) || "").trim();
  const password = String((req.body && req.body.password) || "");

  const emailOk = sameSecret(email.toLowerCase(), LOGIN_EMAIL.toLowerCase());
  const passwordOk = sameSecret(password, LOGIN_PASSWORD);

  if (!emailOk || !passwordOk) {
    recordFailure(key);
    await sleep(400);
    return res.status(401).json({ error: "Invalid email or password" });
  }

  attempts.delete(key);
  res.setHeader("Set-Cookie", sessionCookie(createToken(LOGIN_EMAIL)));
  return res.status(200).json({ ok: true, email: LOGIN_EMAIL });
};

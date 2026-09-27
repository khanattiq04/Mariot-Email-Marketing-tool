/**
 * Sign-in for a static deployment.
 *
 * The gate is checked in the browser against REACT_APP_LOGIN_EMAIL and
 * REACT_APP_LOGIN_PASSWORD, so no server function is needed. Both values are
 * inlined into the bundle at build time: changing them means rebuilding and
 * re-uploading, and environment variables set in a hosting panel are never read
 * by a static site.
 *
 * Because the password ships inside build/static/js/*.js, this hides the
 * interface without protecting it. Keep nothing sensitive behind it.
 */

const SESSION_KEY = "mm_session";
const TTL_MS = 12 * 60 * 60 * 1000;

const LOGIN_EMAIL = (process.env.REACT_APP_LOGIN_EMAIL || "").trim();
const LOGIN_PASSWORD = process.env.REACT_APP_LOGIN_PASSWORD || "";

function unreachable() {
  return { authed: false, email: null };
}

function readSession() {
  const raw = window.localStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  const data = JSON.parse(raw);
  return data && data.exp > Date.now() ? data : null;
}

export async function fetchSession() {
  try {
    const session = readSession();
    return {
      authed: Boolean(session),
      email: session ? session.email : null,
    };
  } catch {
    return unreachable();
  }
}

export async function login(email, password) {
  if (!LOGIN_EMAIL || !LOGIN_PASSWORD) {
    throw new Error(
      "Login is not configured. Set REACT_APP_LOGIN_EMAIL and REACT_APP_LOGIN_PASSWORD, then rebuild."
    );
  }

  const emailOk = String(email || "").trim().toLowerCase() === LOGIN_EMAIL.toLowerCase();
  const passwordOk = String(password || "") === LOGIN_PASSWORD;

  if (!emailOk || !passwordOk) {
    throw new Error("Invalid email or password");
  }

  try {
    window.localStorage.setItem(
      SESSION_KEY,
      JSON.stringify({ email: LOGIN_EMAIL, exp: Date.now() + TTL_MS })
    );
  } catch {
    // Storage can be refused in private browsing; sign-in still succeeds, it
    // just will not survive a reload.
  }

  return { ok: true, email: LOGIN_EMAIL };
}

export async function logout() {
  try {
    window.localStorage.removeItem(SESSION_KEY);
  } catch {
    // Nothing to clear when storage is unavailable.
  }
}

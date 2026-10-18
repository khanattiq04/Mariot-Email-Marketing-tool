/**
 * Client for /api/email-records (api/email-records.js on Vercel/local dev,
 * public/api/email-records.php on PHP hosting).
 *
 * REACT_APP_TOOL_API_KEY must match TOOL_API_KEY on the server when that is
 * set. Like the login values it is inlined at build time.
 */
const API_BASE = (process.env.REACT_APP_API_BASE || "").replace(/\/+$/, "");
const TOOL_KEY = process.env.REACT_APP_TOOL_API_KEY || "";
const ENDPOINT = API_BASE + "/api/email-records";

async function parse(response) {
  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  if (!response.ok) {
    throw new Error((data && data.error) || "Email records request failed (HTTP " + response.status + ")");
  }
  return data || {};
}

export async function recordsPost(action, payload = {}) {
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(TOOL_KEY ? { "X-Tool-Key": TOOL_KEY } : {}) },
    body: JSON.stringify({ action, ...payload }),
  });
  return parse(response);
}

export async function fetchRecordStats() {
  const response = await fetch(ENDPOINT + "?action=stats", {
    headers: TOOL_KEY ? { "X-Tool-Key": TOOL_KEY } : {},
  });
  return parse(response);
}

export function exportUrl() {
  return ENDPOINT + "?action=export" + (TOOL_KEY ? "&key=" + encodeURIComponent(TOOL_KEY) : "");
}

/** Records a send result. Never throws: a record failure must not stop a campaign. */
export function markRecord(email, status, error = "") {
  return recordsPost("mark", { email, status, error }).catch((err) => {
    console.warn("[records] could not mark", email, err.message);
  });
}

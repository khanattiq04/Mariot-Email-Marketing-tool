const ENDPOINT = "/api/login";

function unreachable() {
  return { authed: false, email: null };
}

export async function fetchSession() {
  try {
    const response = await fetch(ENDPOINT, { credentials: "same-origin" });
    if (!response.ok) return unreachable();
    return await response.json();
  } catch {
    return unreachable();
  }
}

export async function login(email, password) {
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ email, password }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "Could not sign in. Please try again.");
  }
  return data;
}

export async function logout() {
  try {
    await fetch(ENDPOINT, { method: "DELETE", credentials: "same-origin" });
  } catch {
    // The local session is dropped regardless of whether the call succeeds.
  }
}

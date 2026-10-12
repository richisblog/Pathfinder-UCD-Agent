export const API_BASE = location.protocol === "file:" ? "http://127.0.0.1:5050" : "";

export function apiUrl(path) {
  return `${API_BASE}${path}`;
}

export async function safeJson(res) {
  try {
    return await res.json();
  } catch {
    return {};
  }
}

export async function getMe() {
  const res = await fetch(apiUrl("/api/me"), { headers: { "Accept": "application/json" } });
  if (!res.ok) return { authenticated: false, user: null, profile: null, profile_complete: false };
  return res.json();
}

export async function requireAuthenticated({ profileRequired = false } = {}) {
  const state = await getMe();
  if (!state.authenticated) {
    location.href = "/login";
    return null;
  }
  if (profileRequired && !state.profile_complete) {
    location.href = "/onboarding";
    return null;
  }
  return state;
}

export async function logout() {
  try {
    await fetch(apiUrl("/auth/logout"), { method: "POST" });
  } finally {
    location.href = "/login";
  }
}

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[char]);
}

// Shared by the GitHub Actions jobs (tools/matchups, tools/live): fetch with retries and
// the bits of the Firestore REST API they use. Auth: if GOOGLE_SERVICE_ACCOUNT_JSON is set,
// calls use that service account; otherwise they are unauthenticated, which firestore.rules no
// longer allows for live_games writes (B22). The workflows fill GOOGLE_SERVICE_ACCOUNT_JSON from
// the FIRESTORE_SERVICE_ACCOUNT repo secret and set FIRESTORE_AUTH_REQUIRED=true, so a missing
// or bad secret fails the job with a clear message instead of falling back to anonymous writes.
import { createSign } from "node:crypto";

export const PROJECT = "football-pickem-46206";
export const FS = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;

// ---------- HTTP ----------
export async function fetchJson(url, opts = {}, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(20000) });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      if (i === tries - 1) throw new Error(`${url.slice(0, 140)}: ${e.message}`);
      await new Promise((r) => setTimeout(r, 800 * (i + 1)));
    }
  }
}

// ---------- Firestore REST ----------
let accessToken = null;
export async function initFirestoreAuth() {
  const required = process.env.FIRESTORE_AUTH_REQUIRED === "true";
  try {
    accessToken = await getAccessToken();
  } catch (e) {
    if (required) throw new Error(`Firestore service account auth failed: ${e.message}`);
    console.log("Service account auth failed:", e.message);
    accessToken = null;
  }
  if (required && !accessToken) {
    throw new Error("FIRESTORE_AUTH_REQUIRED is set but no service account credential was loaded. " +
      "Add the FIRESTORE_SERVICE_ACCOUNT repo secret (see BUGS.md B22).");
  }
  return !!accessToken;
}
async function getAccessToken() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  const sa = JSON.parse(raw);
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const unsigned = b64({ alg: "RS256", typ: "JWT" }) + "." + b64({
    iss: sa.client_email, scope: "https://www.googleapis.com/auth/datastore",
    aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600,
  });
  const sig = createSign("RSA-SHA256").update(unsigned).sign(sa.private_key, "base64url");
  const res = await fetchJson("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${unsigned}.${sig}`,
  });
  return res.access_token;
}
const authHeaders = () => (accessToken ? { Authorization: `Bearer ${accessToken}` } : {});

export function toFs(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === "string") return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toFs) } };
  const fields = {};
  for (const [k, x] of Object.entries(v)) if (x !== undefined) fields[k] = toFs(x);
  return { mapValue: { fields } };
}
export function fromFs(f) {
  if (!f || typeof f !== "object") return null;
  if ("nullValue" in f) return null;
  if ("booleanValue" in f) return f.booleanValue;
  if ("integerValue" in f) return parseInt(f.integerValue, 10);
  if ("doubleValue" in f) return f.doubleValue;
  if ("stringValue" in f) return f.stringValue;
  if ("timestampValue" in f) return f.timestampValue;
  if ("arrayValue" in f) return (f.arrayValue.values || []).map(fromFs);
  if ("mapValue" in f) {
    const o = {};
    for (const [k, x] of Object.entries(f.mapValue.fields || {})) o[k] = fromFs(x);
    return o;
  }
  return null;
}
export async function readDoc(path, fieldMask) {
  const q = fieldMask ? "?" + fieldMask.map((f) => "mask.fieldPaths=" + encodeURIComponent(f)).join("&") : "";
  const doc = await fetchJson(`${FS}/${path}${q}`, { headers: authHeaders() });
  return doc && doc.fields ? fromFs({ mapValue: { fields: doc.fields } }) : null;
}
export async function patchDoc(path, data) {
  const mask = Object.keys(data).map((k) => "updateMask.fieldPaths=" + encodeURIComponent(k)).join("&");
  const res = await fetch(`${FS}/${path}?${mask}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(toFs(data).mapValue),
  });
  if (!res.ok) throw new Error(`PATCH ${path} -> HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
}

